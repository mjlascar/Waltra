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

describe("modelShape", () => {
  it("la familia Opus/Sonnet usa la búsqueda nueva y pensamiento adaptativo", async () => {
    const { modelShape } = await import("@/lib/insights/models");
    for (const id of ["claude-opus-5", "claude-sonnet-5"]) {
      expect(modelShape(id).webSearchType).toBe("web_search_20260209");
      expect(modelShape(id).adaptiveThinking).toBe(true);
    }
  });

  it("Haiku 4.5 usa la búsqueda básica y sin adaptativo", async () => {
    const { modelShape } = await import("@/lib/insights/models");
    // Mandarle la variante nueva devuelve 400 y el usuario solo ve "falló".
    expect(modelShape("claude-haiku-4-5").webSearchType).toBe("web_search_20250305");
    expect(modelShape("claude-haiku-4-5").adaptiveThinking).toBe(false);
  });

  it("todos los modelos de la lista tienen una forma definida", async () => {
    const { modelShape } = await import("@/lib/insights/models");
    for (const model of MODELS) {
      const shape = modelShape(model.id);
      expect(shape.webSearchType).toBeTruthy();
      expect(typeof shape.adaptiveThinking).toBe("boolean");
    }
  });
});
