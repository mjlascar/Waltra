/**
 * Modelos habilitados para los insights.
 *
 * Es una lista blanca a proposito: la eleccion viaja desde el navegador, y
 * aceptar cualquier cadena seria dejar que un pedido cualquiera elija que se
 * factura en la cuenta del usuario.
 *
 * El predeterminado es el mas capaz. Bajar de modelo para ahorrar es una
 * decision del usuario, no algo que la app deba tomar por el.
 */
export const MODELS = [
  {
    id: "claude-opus-5",
    label: "Opus 5",
    detail: "El más capaz. Lo mejor para análisis con búsqueda.",
  },
  {
    id: "claude-sonnet-5",
    label: "Sonnet 5",
    detail: "Bastante más barato, buen resultado para el uso diario.",
  },
  {
    id: "claude-haiku-4-5",
    label: "Haiku 4.5",
    detail: "El más barato y rápido. Análisis más superficial.",
  },
] as const;

export const DEFAULT_MODEL = MODELS[0].id;

export function resolveModel(requested: string | undefined | null): string {
  if (requested && MODELS.some((m) => m.id === requested)) return requested;
  // La variable de entorno puede fijar cualquier modelo: la define quien
  // despliega, no quien usa la app.
  return process.env.WALTRA_MODEL || DEFAULT_MODEL;
}
