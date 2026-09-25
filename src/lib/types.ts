/**
 * Dominio de Waltra.
 *
 * Idea central: separar el CAPITAL que entra y sale del portafolio (deposit /
 * withdraw) de los movimientos INTERNOS (buy / sell / transfer). Mezclar esas
 * dos cosas es exactamente lo que hace que los graficos de los brokers no se
 * entiendan: una transferencia de 100 USD aparece como si fuera una ganancia.
 */

export type Broker = "cocos" | "binance" | "other";

export type Currency = "USD" | "ARS";

export type AssetKind =
  | "stock"
  | "cedear"
  | "etf"
  | "crypto"
  | "fund"
  | "bond"
  | "cash";

/** De donde sale la cotizacion de un activo. */
export type QuoteSource = "binance" | "yahoo" | "byma" | "manual";

export interface Account {
  id: string;
  name: string;
  broker: Broker;
  /** Moneda en la que el usuario piensa esa cuenta. */
  currency: Currency;
  archived?: boolean;
  createdAt: string;
}

export interface Asset {
  id: string;
  /** Simbolo tal como lo escribe el usuario: QQQ, BTC, AL30. */
  symbol: string;
  name: string;
  kind: AssetKind;
  /** Moneda en la que cotiza. */
  currency: Currency;
  source: QuoteSource;
  /** Simbolo en el proveedor: BTCUSDT, QQQ, GGAL.BA... */
  sourceSymbol: string;
  /** Decimales razonables para mostrar cantidades. */
  precision: number;
  /** Precio fijado a mano cuando source === "manual". */
  manualPrice?: number;
  archived?: boolean;
}

export type TxType =
  /** Entra capital externo a una cuenta. */
  | "deposit"
  /** Sale capital del portafolio. */
  | "withdraw"
  /** Compra de un activo con el efectivo de la cuenta. */
  | "buy"
  /** Venta de un activo. */
  | "sell"
  /** Dividendo cobrado en efectivo. */
  | "dividend"
  /** Interes / rendimiento de cuenta remunerada. */
  | "interest"
  /** Comision o impuesto suelto. */
  | "fee"
  /** Movimiento entre dos cuentas propias. No es capital nuevo. */
  | "transfer"
  /**
   * Cambio de moneda dentro de la misma cuenta: comprar o vender dolares en
   * Cocos. Salen `amount` en `currency` y entran `toAmount` en `toCurrency`.
   * No es capital (la plata no entra ni sale del portafolio) ni ganancia: si
   * se compro por encima del dolar del dia, la diferencia aparece sola como
   * una perdida chica, que es lo que fue.
   */
  | "exchange"
  /**
   * Cambio de ratio o split: cada unidad pasa a ser `ratio` unidades. Pasa con
   * los CEDEARs cuando cambia cuantos hacen una accion, y con las acciones que
   * se dividen. No mueve plata: el costo total queda igual, repartido en mas
   * unidades.
   */
  | "split";

export interface Transaction {
  id: string;
  /** ISO 8601. Guardamos fecha y hora; la hora es opcional en la UI. */
  date: string;
  type: TxType;
  accountId: string;
  /** Cuenta destino, solo para type === "transfer". */
  counterAccountId?: string;
  assetId?: string;
  quantity?: number;
  /** Precio por unidad, en `currency`. */
  price?: number;
  /**
   * Movimiento bruto de efectivo, siempre positivo, en `currency`.
   * Para buy/sell = quantity * price. La comision va aparte.
   */
  amount: number;
  currency: Currency;
  fee?: number;
  /** ARS por USD en el momento de la operacion. Solo si currency === "ARS". */
  fxRate?: number;
  /** Unidades nuevas por cada unidad vieja, solo para type === "split". */
  ratio?: number;
  /** Lo que entra en un cambio de moneda, solo para type === "exchange". */
  toAmount?: number;
  toCurrency?: Currency;
  note?: string;
  /** Texto original si vino del parser rapido. */
  raw?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PricePoint {
  /** YYYY-MM-DD */
  date: string;
  close: number;
}

/** Un split o cambio de ratio informado por el proveedor de precios. */
export interface Split {
  /** YYYY-MM-DD, el dia desde el que rige. */
  date: string;
  /** Unidades nuevas por cada unidad vieja: 2,5 si 20 pasan a ser 50. */
  ratio: number;
}

export interface PriceSeries {
  assetId: string;
  currency: Currency;
  points: PricePoint[];
  /**
   * Splits que informa el proveedor. Yahoo entrega los precios viejos ya
   * divididos por estos ratios, asi que sin ellos la historia parece un
   * derrumbe que nunca paso.
   */
  splits?: Split[];
  updatedAt: string;
}

export interface Quote {
  assetId: string;
  price: number;
  currency: Currency;
  /** Variacion porcentual del dia, si el proveedor la da. */
  changePct?: number;
  at: string;
  source: QuoteSource;
  stale?: boolean;
}

export interface FxRate {
  /** YYYY-MM-DD */
  date: string;
  /** ARS por 1 USD. */
  arsPerUsd: number;
}

export interface Settings {
  id: "settings";
  baseCurrency: Currency;
  /** Perfil declarado por el usuario, alimenta los insights. */
  riskProfile: "conservador" | "moderado" | "agresivo";
  horizonYears: number;
  goals: string;
  /** Ultima vez que se refrescaron precios. */
  lastQuoteSync?: string;
  /** Clave de acceso a /api si el deploy la pide. */
  accessKey?: string;
  /**
   * Clave de Anthropic del usuario. Solo existe en el APK, donde no hay
   * servidor que la guarde: vive en el almacenamiento privado de la app y
   * viaja unicamente a api.anthropic.com. Nunca entra en un backup.
   */
  apiKey?: string;
  /** Lo mismo para Gemini. Se guardan las dos: cambiar de proveedor no borra. */
  geminiKey?: string;
  /** Que proveedor de modelo usar. Ver `src/lib/insights/providers.ts`. */
  provider?: import("@/lib/insights/providers").Provider;
  /** Modelo a usar en insights, del proveedor elegido. */
  model?: string;
  /**
   * Indice contra el cual compararse en el grafico de rendimiento.
   * Simbolo del catalogo, o "none" para no comparar.
   */
  benchmark?: string;
  onboarded?: boolean;
  /**
   * Alertas de precio. Solo tienen efecto en el APK: en la web no hay quien
   * mire los precios con la pantalla apagada.
   */
  alerts?: import("@/lib/alerts/plan").AlertRules;
  /** Informes que se recuerdan solos. Ver `src/lib/insights/schedule.ts`. */
  schedules?: import("@/lib/insights/schedule").Schedule[];
  /**
   * Como entra la plata en la cartera de referencia del grafico de
   * rendimiento. Ver `src/lib/engine/shadow.ts`. Si falta, "aportes".
   */
  compareMethod?: import("@/lib/engine/shadow").CompareMethod;
  /** Avisar con una notificacion cuando sale un APK nuevo. Prendido si falta. */
  updateNotify?: boolean;
}

export interface InsightSource {
  title: string;
  url: string;
}

export interface InsightSignal {
  symbol: string;
  /** Que sugiere hacer. */
  action: "acumular" | "mantener" | "reducir" | "vender" | "vigilar";
  confidence: "alta" | "media" | "baja";
  headline: string;
  rationale: string;
  horizon: string;
}

export interface InsightReport {
  id: string;
  createdAt: string;
  model: string;
  /**
   * Que clase de informe es. Los guardados antes de que existieran varias
   * clases no lo tienen, y ahi se asume "cartera", que es lo que eran.
   */
  kind?: import("@/lib/insights/schedule").ReportKind;
  /** Resumen del mercado en 2-3 frases. */
  marketBrief: string;
  signals: InsightSignal[];
  /** Lectura del perfil del inversor a partir de sus propios movimientos. */
  profileRead: {
    summary: string;
    observations: string[];
    risks: string[];
    suggestions: string[];
  };
  sources: InsightSource[];
  /**
   * El paso de estructurado fallo y se guardo el informe en prosa. La app lo
   * avisa en vez de mostrar secciones vacias como si no hubiera nada que decir.
   */
  degraded?: boolean;
  /** Snapshot de cartera con el que se genero, para poder auditarlo despues. */
  portfolioDigest: string;
}
