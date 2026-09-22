/**
 * Los proveedores de modelo que la app sabe usar.
 *
 * Hay dos porque no todo el mundo paga una API. Un abono de claude.ai no sirve
 * para esto: no incluye acceso programatico, no hay clave que sacar de ahi. La
 * API de Gemini, en cambio, tiene un nivel gratuito con cupo diario, que para
 * un informe por semana sobra. Y para quien si quiere usar su abono, esta el
 * informe externo (ver `src/lib/insights/external.ts`).
 *
 * La lista de modelos es blanca a proposito: la eleccion viaja desde la
 * pantalla, y aceptar cualquier cadena seria dejar que un pedido cualquiera
 * elija que se factura en la cuenta del usuario.
 */
export type Provider = "anthropic" | "gemini";

export interface ModelChoice {
  id: string;
  label: string;
  detail: string;
}

export interface ProviderInfo {
  id: Provider;
  label: string;
  /** El primero es el predeterminado. */
  models: ModelChoice[];
  keyUrl: string;
  keyPlaceholder: string;
  /** Lo que conviene saber antes de elegirlo. */
  nota: string;
}

export const PROVIDERS: ProviderInfo[] = [
  {
    id: "anthropic",
    label: "Claude",
    keyUrl: "console.anthropic.com",
    keyPlaceholder: "sk-ant-…",
    nota: "Se paga por uso. Un abono de claude.ai no sirve: no da acceso por API.",
    models: [
      { id: "claude-opus-5", label: "Opus 5", detail: "El más capaz. Lo mejor para análisis con búsqueda." },
      { id: "claude-sonnet-5", label: "Sonnet 5", detail: "Bastante más barato, buen resultado para el uso diario." },
      { id: "claude-haiku-4-5", label: "Haiku 4.5", detail: "El más barato y rápido. Análisis más superficial." },
    ],
  },
  {
    id: "gemini",
    label: "Gemini",
    keyUrl: "aistudio.google.com",
    keyPlaceholder: "AIza…",
    nota: "Tiene nivel gratuito con cupo diario. Flash es el que trae el cupo más holgado.",
    models: [
      { id: "gemini-pro-latest", label: "Gemini Pro", detail: "El más capaz. Cupo gratuito más ajustado." },
      { id: "gemini-flash-latest", label: "Gemini Flash", detail: "Rápido y con el cupo gratuito más holgado." },
      { id: "gemini-flash-lite-latest", label: "Gemini Flash Lite", detail: "El más liviano. Análisis más superficial." },
    ],
  },
];

export const DEFAULT_PROVIDER: Provider = "anthropic";

export function providerInfo(id: Provider): ProviderInfo {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];
}

export function resolveProvider(requested: string | undefined | null): Provider {
  return PROVIDERS.some((p) => p.id === requested) ? (requested as Provider) : DEFAULT_PROVIDER;
}

/** El modelo pedido, si esta en la lista del proveedor; si no, el de la casa. */
export function resolveModel(provider: Provider, requested: string | undefined | null): string {
  const info = providerInfo(provider);
  if (requested && info.models.some((m) => m.id === requested)) return requested;
  // La variable de entorno puede fijar cualquier modelo: la define quien
  // despliega, no quien usa la app.
  const delEntorno = process.env.WALTRA_MODEL;
  if (delEntorno && info.models.some((m) => m.id === delEntorno)) return delEntorno;
  return info.models[0].id;
}

/**
 * Lo que cada modelo de Anthropic acepta en el pedido.
 *
 * No todos hablan el mismo dialecto: la variante nueva de busqueda web y el
 * pensamiento adaptativo existen en la familia Opus/Sonnet actual, pero no en
 * Haiku 4.5, que sigue con la busqueda basica y sin adaptativo. Mandar el
 * pedido equivocado devuelve un 400 y el usuario solo ve "fallo".
 */
export interface ModelShape {
  webSearchType: "web_search_20260209" | "web_search_20250305";
  adaptiveThinking: boolean;
}

export function modelShape(model: string): ModelShape {
  if (model.startsWith("claude-haiku")) {
    return { webSearchType: "web_search_20250305", adaptiveThinking: false };
  }
  return { webSearchType: "web_search_20260209", adaptiveThinking: true };
}

/**
 * La clave que corresponde al proveedor elegido.
 *
 * Se guardan las dos por separado: cambiar de proveedor para probar no tiene
 * que borrar la clave del otro.
 */
export function keyFor(
  provider: Provider,
  settings: { apiKey?: string; geminiKey?: string },
): string | undefined {
  const clave = provider === "gemini" ? settings.geminiKey : settings.apiKey;
  return clave?.trim() || undefined;
}
