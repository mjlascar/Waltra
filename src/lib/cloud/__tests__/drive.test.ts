import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@/lib/db";
import { DriveTransport, type CloudVersion } from "../drive";
import { encodeData, MAX_PAYLOAD_BYTES } from "../data";
import { googleRequest, readGoogleText } from "../google";

const payload = encodeData({ app: "waltra", version: 1, accounts: [], assets: [], transactions: [], settings: DEFAULT_SETTINGS, insights: [] });
const file = (id = "backup", etag = '"rev-1"') => ({ id, etag, modifiedDate: "2026-10-12T15:00:00Z", fileSize: String(new TextEncoder().encode(payload).length) });
const version = (id = "backup"): CloudVersion => ({ id, etag: '"rev-1"', at: "2026-10-12T15:00:00Z", payload });
afterEach(() => vi.unstubAllGlobals());

describe("protocolo de almacenamiento privado en Drive", () => {
  it("lee solo el espacio privado y comprueba que el contenido corresponde a la revision listada", async () => {
    const calls: URL[] = [];
    vi.stubGlobal("fetch", async (input: string) => {
      const url = new URL(input); calls.push(url);
      if (url.searchParams.get("alt") === "media") return new Response(payload);
      return Response.json(url.pathname.endsWith("/files") ? { items: [file()] } : file());
    });
    const result = await new DriveTransport("private-token").read();
    expect(result).toEqual([version()]);
    expect(calls[0].searchParams.get("spaces")).toBe("appDataFolder");
    expect(calls[0].searchParams.get("q")).toContain("visibility='PRIVATE'");
    expect(calls).toHaveLength(3);
  });

  it("no vuelve a bajar una revision que ya conoce", async () => {
    const calls: URL[] = [];
    vi.stubGlobal("fetch", async (input: string) => {
      const url = new URL(input); calls.push(url);
      if (url.searchParams.get("alt") === "media") return new Response(payload);
      return Response.json(url.pathname.endsWith("/files") ? { items: [file()] } : file());
    });
    expect(await new DriveTransport("token").read(version())).toEqual([version()]);
    expect(calls).toHaveLength(1);
    // Otra revision del mismo archivo si se baja.
    await new DriveTransport("token").read({ ...version(), etag: '"rev-0"' });
    expect(calls).toHaveLength(4);
  });

  it("sobrescribe el mismo archivo repetidamente sin nuevas copias ni revisiones", async () => {
    const writes: { url: URL; init: RequestInit }[] = [];
    let revision = 1;
    vi.stubGlobal("fetch", async (input: string, init: RequestInit) => {
      const url = new URL(input);
      if (init.method === "PUT") {
        writes.push({ url, init });
        return Response.json(file("backup", `"rev-${++revision}"`));
      }
      return Response.json({ items: [file("backup", `"rev-${revision}"`)] });
    });
    const drive = new DriveTransport("private-token");
    let current = version();
    for (let i = 0; i < 4; i++) current = await drive.write(payload, [current]);
    expect(writes).toHaveLength(4);
    for (const [i, { url, init }] of writes.entries()) {
      expect(url.pathname).toBe("/upload/drive/v2/files/backup");
      expect(url.searchParams.get("newRevision")).toBe("false");
      expect(url.searchParams.get("pinned")).toBe("false");
      expect(new Headers(init.headers).get("If-Match")).toBe(`"rev-${i + 1}"`);
      expect(new Headers(init.headers).get("Authorization")).toBe("Bearer private-token");
      expect(init.body).toBe(payload);
      expect(url.href).not.toContain("private-token");
    }
  });

  it("crea una sola copia privada al conectar por primera vez y luego confirma su existencia", async () => {
    let created = false;
    let body = "";
    let writes = 0;
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      if (init.method === "POST") { created = true; writes++; body = String(init.body); return Response.json(file()); }
      return Response.json({ items: created ? [file()] : [] });
    });
    await new DriveTransport("private-token").write(payload, []);
    expect(writes).toBe(1);
    expect(body).toContain('"parents":[{"id":"appDataFolder"}]');
    expect(body).toContain('"visibility":"PRIVATE"');
    expect(body).toContain(payload);
  });

  it("no sobrescribe ni elimina copias si Google rechaza una revision vencida", async () => {
    const mutations: string[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      if (init.method) { mutations.push(init.method); return new Response("sensitive-details", { status: 412 }); }
      return Response.json({ items: [file("a"), file("b")] });
    });
    await expect(new DriveTransport("token").write(payload, [version("a"), version("b")])).rejects.toMatchObject({ status: 412 });
    expect(mutations).toEqual(["PUT"]);
  });

  it("no empieza una subida si se desconecta durante la comprobacion previa", async () => {
    let active = true;
    const fetcher = vi.fn(async () => { active = false; return Response.json({ items: [file()] }); });
    vi.stubGlobal("fetch", fetcher);
    await expect(new DriveTransport("token", () => active).write(payload, [version()])).rejects.toMatchObject({ status: 412 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("consolida duplicados iniciales solo despues de guardar y sin borrar archivos modificados", async () => {
    const requests: { method: string; url: string; etag: string | null }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      if (!init.method) return Response.json({ items: [file("a"), file("b")] });
      requests.push({ method: init.method, url, etag: new Headers(init.headers).get("If-Match") });
      return init.method === "DELETE" ? new Response(null, { status: 204 }) : Response.json(file("a", '"rev-2"'));
    });
    await new DriveTransport("token").write(payload, [version("a"), version("b")]);
    expect(requests.map((r) => r.method)).toEqual(["PUT", "DELETE"]);
    expect(requests[1].url).toMatch(/\/files\/b$/);
    expect(requests[1].etag).toBe('"rev-1"');
  });

  it("detecta dos creaciones iniciales concurrentes y no borra ninguna sin resolver sus datos", async () => {
    let created = false;
    const mutations: string[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      if (init.method) { mutations.push(init.method); created = true; return Response.json(file("b")); }
      return Response.json({ items: created ? [file("a"), file("b")] : [] });
    });
    await expect(new DriveTransport("token").write(payload, [])).rejects.toMatchObject({ status: 412 });
    expect(mutations).toEqual(["POST"]);
  });

  it("rechaza subida, metadatos y descarga que exceden limites antes de modificar Drive", async () => {
    const fetcher = vi.fn(async () => Response.json({ items: [{ ...file(), fileSize: String(MAX_PAYLOAD_BYTES + 1) }] }));
    vi.stubGlobal("fetch", fetcher);
    const oversized = JSON.stringify({ ...JSON.parse(payload), settings: { ...DEFAULT_SETTINGS, goals: "é".repeat(MAX_PAYLOAD_BYTES / 2) } });
    await expect(new DriveTransport("token").write(oversized, [])).rejects.toThrow(/5 MiB/);
    expect(fetcher).not.toHaveBeenCalled();
    await expect(new DriveTransport("token").read()).rejects.toThrow(/5 MiB/);
    expect(fetcher).toHaveBeenCalledTimes(1);
    let cancelled = false;
    let delivered = 0;
    const stream = new ReadableStream({
      pull(controller) {
        if (delivered++ < 5) controller.enqueue(new Uint8Array(65));
        else controller.close();
      },
      cancel() { cancelled = true; },
    });
    await expect(readGoogleText(new Response(stream), 128)).rejects.toThrow(/límite/);
    expect(cancelled).toBe(true);
    await expect(readGoogleText(new Response("small", { headers: { "Content-Length": "129" } }), 128)).rejects.toThrow(/límite/);
  });

  it("limita la cantidad de copias examinadas y no crea otra cuando la lista es excesiva", async () => {
    const fetcher = vi.fn(async () => Response.json({ items: [file()], nextPageToken: "more" }));
    vi.stubGlobal("fetch", fetcher);
    await expect(new DriveTransport("token").write(payload, [])).rejects.toThrow(/demasiadas copias/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rechaza un destino externo antes de enviar el bearer y explica 401 sin filtrar datos", async () => {
    const fetcher = vi.fn(async () => new Response("sensitive-provider-details", { status: 401 }));
    vi.stubGlobal("fetch", fetcher);
    await expect(googleRequest("private-token", "https://www.googleapis.com.attacker.example/path")).rejects.toThrow(/no permitido/);
    expect(fetcher).not.toHaveBeenCalled();
    await expect(new DriveTransport("private-token").read()).rejects.toThrow(/sesión de Google venció/);
  });
});
