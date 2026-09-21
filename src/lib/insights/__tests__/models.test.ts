import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_MODEL, MODELS, resolveModel } from "@/lib/insights/models";

const original = process.env.WALTRA_MODEL;
afterEach(() => {
  if (original === undefined) delete process.env.WALTRA_MODEL;
  else process.env.WALTRA_MODEL = original;
});

describe("resolveModel", () => {
  it("acepta los modelos de la lista", () => {
    for (const model of MODELS) {
      expect(resolveModel(model.id)).toBe(model.id);
    }
  });

  it("ignora cualquier cosa que venga de afuera de la lista", () => {
    delete process.env.WALTRA_MODEL;
    // La eleccion viaja desde el navegador: aceptar cualquier cadena seria
    // dejar que un pedido cualquiera elija que se factura.
    expect(resolveModel("modelo-carisimo-inventado")).toBe(DEFAULT_MODEL);
    expect(resolveModel("")).toBe(DEFAULT_MODEL);
    expect(resolveModel(null)).toBe(DEFAULT_MODEL);
    expect(resolveModel(undefined)).toBe(DEFAULT_MODEL);
  });

  it("quien despliega puede fijar el modelo por entorno", () => {
    process.env.WALTRA_MODEL = "un-modelo-propio";
    expect(resolveModel(undefined)).toBe("un-modelo-propio");
    // Pero la eleccion valida del usuario sigue mandando.
    expect(resolveModel("claude-sonnet-5")).toBe("claude-sonnet-5");
  });

  it("el predeterminado es el más capaz, no el más barato", () => {
    expect(DEFAULT_MODEL).toBe("claude-opus-5");
  });
});
