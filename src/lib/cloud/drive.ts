import { z } from "zod";
import { decodeData, encodeData, MAX_PAYLOAD_BYTES } from "./data";
import { GoogleError, googleRequest, readGoogleText } from "./google";

const API = "https://www.googleapis.com/drive/v2/files";
const UPLOAD = "https://www.googleapis.com/upload/drive/v2/files";
const KIND = "waltra-backup-v1";
const FIELDS = "id,etag,modifiedDate,fileSize";
const MAX_FILES = 3; // Solo para resolver una carrera durante la primera conexión.
const fileSchema = z.object({
  id: z.string().regex(/^[\w-]{1,200}$/),
  etag: z.string().regex(/^"[^"\r\n]+"$/),
  modifiedDate: z.string(), fileSize: z.string().regex(/^\d+$/),
});
type DriveFile = z.infer<typeof fileSchema>;
export interface CloudVersion { id: string; etag: string; payload: string; at: string }
export function versionToken(version: Pick<CloudVersion, "id" | "etag">): string {
  return JSON.stringify([version.id, version.etag]);
}
export interface CloudTransport {
  read(): Promise<CloudVersion[]>;
  write(payload: string, expected: CloudVersion[]): Promise<CloudVersion>;
}

function changed(): GoogleError {
  return new GoogleError("Drive cambió durante la sincronización. Volvé a revisar las versiones.", 412);
}

export class DriveTransport implements CloudTransport {
  constructor(private readonly token: string, private readonly active: () => boolean = () => true) {}

  private async metadata(url: string, init?: RequestInit): Promise<unknown> {
    const res = await googleRequest(this.token, url, init);
    return JSON.parse(await readGoogleText(res, 64 * 1024));
  }

  private async list(): Promise<DriveFile[]> {
    const query = new URLSearchParams({ spaces: "appDataFolder", maxResults: String(MAX_FILES + 1),
      q: `trashed = false and properties has { key='kind' and value='${KIND}' and visibility='PRIVATE' }`,
      fields: `nextPageToken,items(${FIELDS})` });
    const batch = z.object({ items: z.array(fileSchema).default([]), nextPageToken: z.string().optional() })
      .parse(await this.metadata(`${API}?${query}`));
    if (batch.nextPageToken || batch.items.length > MAX_FILES) {
      throw new Error("Hay demasiadas copias de Waltra en Drive. No se crearon archivos ni se modificaron tus datos.");
    }
    for (const file of batch.items) {
      if (BigInt(file.fileSize) > BigInt(MAX_PAYLOAD_BYTES)) throw new Error("La copia de Drive supera el límite de 5 MiB.");
    }
    return batch.items.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  }

  async read(): Promise<CloudVersion[]> {
    const versions: CloudVersion[] = [];
    for (const file of await this.list()) {
      const path = `${API}/${encodeURIComponent(file.id)}`;
      const res = await googleRequest(this.token, `${path}?alt=media`);
      const payload = encodeData(decodeData(await readGoogleText(res, MAX_PAYLOAD_BYTES)));
      const current = fileSchema.parse(await this.metadata(`${path}?fields=${FIELDS}`));
      if (current.etag !== file.etag) throw changed();
      versions.push({ id: file.id, etag: file.etag, at: file.modifiedDate, payload });
    }
    return versions;
  }

  async write(input: string, expected: CloudVersion[]): Promise<CloudVersion> {
    const payload = encodeData(decodeData(input));
    // Detecta también otro equipo que creó la primera copia mientras leíamos.
    const files = await this.list();
    if (!this.active()) throw changed();
    if (JSON.stringify(files.map(versionToken).sort()) !== JSON.stringify(expected.map(versionToken).sort())) throw changed();
    const target = files[0];
    let file: DriveFile;
    if (target) {
      // v2 reemplaza el blob SIN crear una revisión. If-Match rechaza una
      // escritura basada en una versión que otro equipo modificó.
      file = fileSchema.parse(await this.metadata(
        `${UPLOAD}/${encodeURIComponent(target.id)}?uploadType=media&newRevision=false&pinned=false&fields=${FIELDS}`, {
          method: "PUT", headers: { "Content-Type": "application/json; charset=UTF-8", "If-Match": target.etag }, body: payload,
        }));
    } else {
      const boundary = `waltra_${crypto.randomUUID()}`;
      const metadata = { title: "waltra.json", parents: [{ id: "appDataFolder" }], mimeType: "application/json",
        properties: [{ key: "kind", value: KIND, visibility: "PRIVATE" }] };
      const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${payload}\r\n--${boundary}--`;
      file = fileSchema.parse(await this.metadata(`${UPLOAD}?uploadType=multipart&pinned=false&fields=${FIELDS}`, {
        method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body,
      }));
      // Si dos instalaciones crearon a la vez, se resuelven sus contenidos
      // antes de borrar ninguna de ellas.
      const current = await this.list();
      if (current.length !== 1 || current[0].id !== file.id || current[0].etag !== file.etag) throw changed();
    }
    // Solo tras confirmar una versión se eliminan duplicados conocidos de la
    // primera conexión. No se borra un archivo modificado desde la lectura.
    for (const duplicate of files.slice(1)) {
      if (!this.active()) throw changed();
      await googleRequest(this.token, `${API}/${encodeURIComponent(duplicate.id)}`, {
        method: "DELETE", headers: { "If-Match": duplicate.etag },
      });
    }
    return { id: file.id, etag: file.etag, at: file.modifiedDate, payload };
  }
}
