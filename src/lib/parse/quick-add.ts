import type { Account, Asset, Currency, TxType } from "@/lib/types";
import type { DayKey } from "@/lib/date";
import { today } from "@/lib/date";
import { CATALOG_ALIASES, lookupCatalog, type CatalogEntry } from "@/lib/catalog";
import { extractDate } from "./dates";
import { parseLooseNumber } from "./number";

export interface ParseContext {
  accounts: Account[];
  assets: Asset[];
  defaultAccountId?: string;
  now?: DayKey;
}

export interface ParsedEntry {
  type: TxType;
  /** "vendí todo el SPY": la cantidad sale de la posición actual. */
  all?: boolean;
  /** La frase traía una fecha. Si no, `day` es hoy por defecto. */
  dateExplicit: boolean;
  /** La frase nombraba la cuenta. Si no, se uso la predeterminada. */
  accountExplicit: boolean;
  day: DayKey;
  accountId?: string;
  counterAccountId?: string;
  /** Texto de cuenta que no se pudo resolver. */
  accountHint?: string;
  assetId?: string;
  symbol?: string;
  /** Entrada del catalogo si el simbolo es conocido pero aun no esta cargado. */
  catalog?: CatalogEntry;
  quantity?: number;
  price?: number;
  amount?: number;
  currency: Currency;
  fee?: number;
  /**
   * Como interpretamos el numero principal: "amount" = el usuario dijo cuanta
   * plata puso; "quantity" = dijo cuantas unidades compro. La UI muestra un
   * interruptor para dar vuelta la lectura sin reescribir la frase.
   */
  basis: "amount" | "quantity";
  note?: string;
  confidence: number;
  warnings: string[];
  raw: string;
}

const strip = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Escapa un fragmento para usarlo dentro de una expresion regular. */
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const VERBS: { re: RegExp; type: TxType }[] = [
  { re: /\b(compr[eoaé]|compre|compra|comprar|adquir[ií]|adquiri)\b/, type: "buy" },
  { re: /\b(vend[ií]|vendi|venta|vender|liquid[eé]|liquide)\b/, type: "sell" },
  { re: /\b(dividendos?|divi)\b/, type: "dividend" },
  { re: /\b(inter[eé]s|intereses|rendimiento|renta|devengad[oa])\b/, type: "interest" },
  { re: /\b(comisi[oó]n|comisiones|fee|arancel|impuesto|gasto)\b/, type: "fee" },
  { re: /\b(retir[eé]|retire|retiro|saqu[eé]|saque|extraj[eé]|extraje|sali[oó])\b/, type: "withdraw" },
  {
    re: /\b(depos[ieé]t[eé]?|deposit[eoé]|deposito|dep[oó]sito|pas[eé]|pase|transfer[ií]|transferi|carg[uú][eé]|cargue|ingres[eé]|ingrese|ingresos?|met[ií]|meti|pus[eé]|puse|mand[eé]|mande|envi[eé]|envie|sum[eé]|sume|agregu[eé]|agregue)\b/,
    type: "deposit",
  },
];

const BROKER_ALIASES: Record<string, string[]> = {
  cocos: ["cocos", "cocos capital", "cocos cap"],
  binance: ["binance", "bnb exchange", "binance ar"],
};

interface AccountHit {
  account: Account;
  index: number;
  /** Preposicion inmediatamente anterior: "de" / "desde" / "a" / "en" / null. */
  preposition: string | null;
}

function findAccounts(text: string, accounts: Account[]): AccountHit[] {
  const hits: AccountHit[] = [];
  const seen = new Set<string>();
  for (const account of accounts) {
    const names = new Set<string>([strip(account.name)]);
    for (const alias of BROKER_ALIASES[account.broker] ?? []) names.add(strip(alias));
    // Primera palabra del nombre: "Cocos Capital" -> "cocos".
    const firstWord = strip(account.name).split(/\s+/)[0];
    if (firstWord.length >= 3) names.add(firstWord);

    for (const name of [...names].sort((a, b) => b.length - a.length)) {
      const re = new RegExp(`(?:\\b(de|desde|a|al|en|hacia|para)\\s+(?:mi\\s+|la\\s+|el\\s+)?(?:cuenta\\s+|billetera\\s+|wallet\\s+)?(?:de\\s+)?)?\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
      const m = text.match(re);
      if (m && m.index !== undefined && !seen.has(account.id)) {
        seen.add(account.id);
        hits.push({ account, index: m.index, preposition: m[1] ?? null });
        break;
      }
    }
  }
  return hits.sort((a, b) => a.index - b.index);
}

function findSymbol(
  text: string,
  raw: string,
  assets: Asset[],
): { symbol: string; asset?: Asset; catalog?: CatalogEntry; match: string } | null {
  // 1. Activos que el usuario ya tiene cargados: son los mas probables.
  const candidates = assets
    .map((a) => ({ asset: a, keys: [strip(a.symbol), strip(a.name)] }))
    .flatMap(({ asset, keys }) => keys.map((k) => ({ asset, key: k })))
    .filter((c) => c.key.length >= 2)
    .sort((a, b) => b.key.length - a.key.length);
  for (const c of candidates) {
    const re = new RegExp(`(?<![a-z0-9])${c.key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9])`);
    const m = text.match(re);
    if (m) return { symbol: c.asset.symbol, asset: c.asset, match: m[0] };
  }

  // 2. Catalogo conocido (incluye alias en castellano: "nasdaq", "bitcoin").
  for (const alias of CATALOG_ALIASES) {
    // Un alias de puros digitos competiria con el monto de la frase.
    if (alias.length < 2 || /^[\d.,]+$/.test(alias)) continue;
    const re = new RegExp(`(?<![a-z0-9])${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9])`);
    const m = text.match(re);
    if (m) {
      const entry = lookupCatalog(alias);
      if (entry) return { symbol: entry.symbol, catalog: entry, match: m[0] };
    }
  }

  // 3. Ticker escrito en mayusculas en el texto original: "compre 2 XYZ a 10".
  const upper = raw.match(/(?<![A-Za-z0-9])([A-Z]{2,6}(?:\.[A-Z]{2})?)(?![A-Za-z0-9])/);
  if (upper && !["USD", "ARS", "USDT"].includes(upper[1])) {
    return { symbol: upper[1], match: strip(upper[1]) };
  }
  return null;
}

const USD_RE = /\b(usd|u\$s|us\$|d[oó]lares?|dolar|d[oó]lar|verdes?|dls)\b/;
const ARS_RE = /\b(ars|pesos?|peso|mangos?|gauchos?)\b/;

function cut(text: string, fragment: string): string {
  if (!fragment) return text;
  const i = text.indexOf(fragment);
  if (i < 0) return text;
  return text.slice(0, i) + " ".repeat(fragment.length) + text.slice(i + fragment.length);
}

/**
 * Convierte una frase suelta en un movimiento estructurado.
 *
 * La idea no es adivinar perfecto: es adivinar bien la mayoria de las veces y
 * mostrar siempre lo que entendio, para que corregir sea un toque y no
 * volver a escribir todo.
 */
export function parseQuickEntry(raw: string, ctx: ParseContext): ParsedEntry | null {
  const input = raw.trim();
  if (!input) return null;
  const now = ctx.now ?? today();
  let work = ` ${strip(input)} `;
  const warnings: string[] = [];
  let confidence = 0.35;

  // --- Fecha ---------------------------------------------------------------
  const dateHit = extractDate(work, now);
  let day = now;
  if (dateHit) {
    day = dateHit.day;
    work = cut(work, dateHit.match);
    confidence += 0.05;
  }

  // --- Verbo ---------------------------------------------------------------
  let type: TxType = "deposit";
  let verbFound = false;
  for (const v of VERBS) {
    const m = work.match(v.re);
    if (m) {
      type = v.type;
      verbFound = true;
      work = cut(work, m[0]);
      confidence += 0.2;
      break;
    }
  }

  // --- Cuentas -------------------------------------------------------------
  const hits = findAccounts(work, ctx.accounts);
  let accountId: string | undefined;
  let counterAccountId: string | undefined;

  if (hits.length >= 2) {
    const source = hits.find((h) => h.preposition === "de" || h.preposition === "desde");
    const dest = hits.find(
      (h) => h !== source && ["a", "al", "en", "hacia", "para"].includes(h.preposition ?? ""),
    );
    if (source && dest && source.index < dest.index) {
      type = "transfer";
      accountId = source.account.id;
      counterAccountId = dest.account.id;
      confidence += 0.2;
    } else {
      accountId = hits[0].account.id;
      confidence += 0.1;
    }
  } else if (hits.length === 1) {
    accountId = hits[0].account.id;
    confidence += 0.15;
  } else {
    /* sin mencion de cuenta: cae en la predeterminada */
    accountId = ctx.defaultAccountId;
    if (ctx.accounts.length > 1) {
      const name = ctx.accounts.find((a) => a.id === accountId)?.name;
      warnings.push(name ? `No dijiste la cuenta: usé ${name}.` : "No dijiste la cuenta.");
    }
  }
  for (const h of hits) work = cut(work, strip(h.account.name).split(/\s+/)[0]);

  // --- Moneda --------------------------------------------------------------
  const account = ctx.accounts.find((a) => a.id === accountId);
  let currency: Currency = account?.currency ?? "USD";
  const usdHit = work.match(USD_RE);
  const arsHit = work.match(ARS_RE);
  if (usdHit) {
    currency = "USD";
    work = cut(work, usdHit[0]);
    confidence += 0.05;
  } else if (arsHit) {
    currency = "ARS";
    work = cut(work, arsHit[0]);
    confidence += 0.05;
  }

  // --- Comision suelta -----------------------------------------------------
  let fee: number | undefined;
  if (type !== "fee") {
    const feeHit = work.match(/\b(?:comisi[oó]n|comision|fee|costo)\s*(?:de\s*)?\$?\s*([\d.,]+)/);
    if (feeHit) {
      fee = parseLooseNumber(feeHit[1]) ?? undefined;
      work = cut(work, feeHit[0]);
    }
  }

  // --- Precio unitario -----------------------------------------------------
  let price: number | undefined;
  const priceHit = work.match(
    /(?:\ba\s+(?:\$|usd|u\$s)?\s*|@\s*|\bprecio\s+(?:de\s+)?\$?\s*|\bcada\s+(?:una?\s+)?(?:a\s+)?\$?\s*)([\d][\d.,]*)\b/,
  );
  if (priceHit) {
    price = parseLooseNumber(priceHit[1]) ?? undefined;
    work = cut(work, priceHit[0]);
    if (price !== undefined) confidence += 0.1;
  }

  // --- Activo --------------------------------------------------------------
  const needsAsset = type === "buy" || type === "sell" || type === "dividend";
  // "vendí todo el SPY": la cantidad la completa la app con la tenencia real.
  const sellAll = type === "sell" && /\b(todo|toda|todos|todas)\b/.test(work);
  const symbolHit = findSymbol(work, input, ctx.assets);
  if (symbolHit) {
    work = cut(work, symbolHit.match);
    if (needsAsset) confidence += 0.15;
  } else if (needsAsset) {
    warnings.push("No reconocí el activo.");
    confidence -= 0.1;
  }

  // --- Numero principal ----------------------------------------------------
  // Lo que queda deberia ser el monto o la cantidad.
  const numbers: { value: number; index: number; text: string }[] = [];
  const numRe = /(?<![a-z0-9.,])(\d[\d.,]*)(?![a-z0-9])/g;
  for (const m of work.matchAll(numRe)) {
    const value = parseLooseNumber(m[1]);
    if (value !== null && m.index !== undefined) {
      numbers.push({ value, index: m.index, text: m[1] });
    }
  }

  let main = numbers[0]?.value;
  if (numbers.length > 1) {
    // Con dos numeros y sin precio detectado, el segundo suele ser el precio.
    if (price === undefined) {
      main = numbers[0].value;
      price = numbers[1].value;
      warnings.push("Interpreté el segundo número como precio unitario.");
    }
  }
  if (main === undefined) {
    if (!sellAll) {
      warnings.push("No encontré ningún monto.");
      confidence -= 0.2;
    }
  } else {
    confidence += 0.15;
  }

  // --- Monto vs cantidad ---------------------------------------------------
  // "compre 50 de QQQ" son 50 dolares; "compre 2 QQQ" son 2 unidades. La
  // diferencia esta en si hay un "de" entre el numero y el simbolo.
  let basis: "amount" | "quantity" = "amount";
  let quantity: number | undefined;
  let amount: number | undefined;
  const isTrade = type === "buy" || type === "sell";

  if (isTrade && main !== undefined) {
    const norm = ` ${strip(input)} `;
    const num = esc(numbers[0]?.text ?? "");
    const sym = symbolHit ? esc(symbolHit.match) : null;
    // Palabras que cuentan unidades, no plata: "3 acciones de apple".
    const UNIDADES = "(?:unidades?|acciones?|papeles?|cedears?|nominales?|monedas?|t[ií]tulos?)";
    // "2 QQQ" / "3 acciones de apple" -> unidades.
    const directQuantity =
      sym !== null &&
      new RegExp(`${num}\\s+(?:${UNIDADES}\\s+(?:de\\s+)?)?${sym}`).test(norm);
    // "50 de QQQ" / "50 usd de QQQ" -> plata.
    const amountOf =
      sym !== null && new RegExp(`${num}\\s+[a-z$]*\\s*de\\s+${sym}`).test(norm);
    const saidMoney = Boolean(usdHit || arsHit) || /\$/.test(input);

    // El orden importa: en "compré 2 QQQ a 480 usd" hay una marca de moneda,
    // pero el 2 sigue siendo cantidad. Que el numero toque al simbolo pesa
    // mas que una mencion de moneda en cualquier otro lugar de la frase.
    if (directQuantity) basis = "quantity";
    else if (saidMoney) basis = "amount";
    else if (amountOf) basis = main < 1 ? "quantity" : "amount";
    else basis = main < 1 ? "quantity" : "amount";

    // "50 de QQQ" sin moneda ni precio es genuinamente ambiguo: avisamos en
    // vez de decidir en silencio.
    if (basis === "amount" && amountOf && !saidMoney && price === undefined) {
      warnings.push("Lo leí como plata. Si eran unidades, cambiá a «Por unidades».");
    }

    if (basis === "quantity") {
      quantity = main;
      amount = price !== undefined ? main * price : undefined;
    } else {
      amount = main;
      quantity = price !== undefined && price > 0 ? main / price : undefined;
    }
  } else if (main !== undefined) {
    // Dividendos, intereses, comisiones, depositos: el numero siempre es plata.
    amount = main;
  }

  const note = undefined;
  if (!verbFound) warnings.push("No reconocí la acción: asumí un ingreso de capital.");

  return {
    type,
    all: sellAll || undefined,
    day,
    dateExplicit: dateHit !== null,
    accountExplicit: hits.length > 0,
    accountId,
    counterAccountId,
    assetId: symbolHit?.asset?.id,
    symbol: symbolHit?.symbol,
    catalog: symbolHit?.catalog,
    quantity,
    price,
    amount,
    currency,
    fee,
    basis,
    note,
    confidence: Math.max(0, Math.min(1, confidence)),
    warnings,
    raw: input,
  };
}
