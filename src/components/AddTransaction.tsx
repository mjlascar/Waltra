"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { Field, Segmented } from "@/components/ui/Field";
import { IconWarning } from "@/components/icons";
import { newId, useStore } from "@/lib/store";
import { describeBackendError, parseEntry, searchSymbols } from "@/lib/backend";
import { parseQuickEntry } from "@/lib/parse/quick-add";
import { parseLooseNumber } from "@/lib/parse/number";
import { lookupCatalog, searchCatalog, type CatalogEntry } from "@/lib/catalog";
import { lastUsedAccountId } from "@/lib/assets";
import { cedearSymbol, isUsListing, resolveTradeAsset, tradesAsCedear } from "@/lib/cedear";
import { longDate, money, percent, quantity as fmtQty, shortDate, TX_LABEL } from "@/lib/format";
import { txColor } from "@/lib/tx-style";
import { today } from "@/lib/date";
import type { SymbolHit } from "@/lib/market/search";
import type { Currency, Transaction, TxType } from "@/lib/types";

/**
 * Lo que se carga casi siempre, en el orden en que se usa.
 *
 * El resto de los tipos existe pero no compite por la atencion: quien carga un
 * dividendo sabe que lo esta buscando, quien carga una compra no tiene por que
 * leer ocho opciones para encontrarla.
 */
const PRINCIPALES: { value: TxType; label: string; detalle: string }[] = [
  { value: "buy", label: "Compré", detalle: "Acciones, ETF, CEDEAR o cripto" },
  { value: "sell", label: "Vendí", detalle: "Salir de una posición" },
  { value: "deposit", label: "Ingresé dinero", detalle: "Capital nuevo a una cuenta" },
  { value: "withdraw", label: "Retiré dinero", detalle: "Capital que sale" },
];

const SECUNDARIOS: { value: TxType; label: string; detalle: string }[] = [
  { value: "exchange", label: "Compré o vendí dólares", detalle: "MEP, en la misma cuenta" },
  { value: "transfer", label: "Transferencia", detalle: "Entre cuentas propias" },
  { value: "dividend", label: "Dividendo", detalle: "Renta de un activo" },
  { value: "interest", label: "Interés", detalle: "Renta de una cuenta" },
  { value: "fee", label: "Comisión", detalle: "Un costo" },
];

const TODOS = [...PRINCIPALES, ...SECUNDARIOS];

interface Draft {
  type: TxType;
  date: string;
  accountId: string;
  counterAccountId: string;
  symbol: string;
  assetId: string;
  quantityText: string;
  priceText: string;
  amountText: string;
  currency: Currency;
  feeText: string;
  fxText: string;
  note: string;
  /** Lo que entra en un cambio de moneda: los dolares al comprar, los pesos al vender. */
  toAmountText: string;
  /**
   * Que dos datos cargo el usuario; el tercero se deduce.
   *
   * - `amount`: monto y precio -> unidades.
   * - `quantity`: unidades y precio -> monto.
   * - `total`: lo que pagaste (o cobraste) y las unidades -> precio. Es lo que
   *   muestra el comprobante del broker, que casi nunca dice el precio limpio.
   */
  basis: "amount" | "quantity" | "total";
}

function emptyDraft(accountId: string, currency: Currency): Draft {
  return {
    type: "deposit",
    date: today(),
    accountId,
    counterAccountId: "",
    symbol: "",
    assetId: "",
    quantityText: "",
    priceText: "",
    amountText: "",
    currency,
    feeText: "",
    fxText: "",
    toAmountText: "",
    note: "",
    basis: "amount",
  };
}

/**
 * Un precio como texto que `parseLooseNumber` lee de vuelta igual: con coma
 * decimal y nunca con tres decimales, que se leerian como miles.
 */
const precioTexto = (v: number): string => v.toFixed(v >= 1 ? 2 : 6).replace(".", ",");

const num = (text: string): number | undefined => {
  const value = parseLooseNumber(text);
  return value === null ? undefined : value;
};

export function AddTransaction({
  open,
  onClose,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  editing?: Transaction | null;
}) {
  const {
    accounts, assets, transactions, portfolio,
    saveTransaction, saveAsset, refresh, settings, backend, marketPrice,
  } = useStore();

  const defaultAccount = useMemo(
    () => lastUsedAccountId(transactions, accounts),
    [transactions, accounts],
  );
  const defaultCurrency =
    accounts.find((a) => a.id === defaultAccount)?.currency ?? accounts[0]?.currency ?? "USD";

  /**
   * En que paso esta la carga.
   *
   * - `tipo`: que hiciste. Es lo primero que se pregunta y lo unico que se ve.
   * - `datos`: solo los campos que ese tipo necesita.
   * - `escribir`: la frase suelta de siempre, que sigue siendo el camino mas
   *   rapido para quien ya sabe lo que quiere cargar.
   */
  const [paso, setPaso] = useState<"tipo" | "datos" | "escribir">("tipo");
  const [avanzado, setAvanzado] = useState(false);
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(defaultAccount, defaultCurrency));
  const [warnings, setWarnings] = useState<string[]>([]);
  const [catalogHit, setCatalogHit] = useState<CatalogEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confidence, setConfidence] = useState(1);
  // Las posiciones se leen por referencia para que su recalculo no dispare el
  // efecto que interpreta la frase.
  const positionsRef = useRef(portfolio.positions);
  /** El resultado de busqueda elegido, para crear el activo al guardar. */
  const encontrado = useRef<SymbolHit | null>(null);
  useEffect(() => {
    positionsRef.current = portfolio.positions;
  }, [portfolio.positions]);
  const [asking, setAsking] = useState(false);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [hallados, setHallados] = useState<SymbolHit[] | null>(null);

  // Al abrir: o cargamos el movimiento que se esta editando, o empezamos limpio.
  useEffect(() => {
    if (!open) return;
    // Abrir la hoja resetea el formulario: es sincronizacion con una entrada
    // que cambia, no una derivacion que pueda calcularse en el render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError(null);
    setWarnings([]);
    if (editing) {
      const asset = assets.find((a) => a.id === editing.assetId);
      setPaso("datos");
      setText("");
      setDraft({
        type: editing.type,
        date: editing.date.slice(0, 10),
        accountId: editing.accountId,
        counterAccountId: editing.counterAccountId ?? "",
        symbol: asset?.symbol ?? "",
        assetId: editing.assetId ?? "",
        quantityText: editing.quantity ? String(editing.quantity) : "",
        priceText: editing.price ? String(editing.price) : "",
        amountText: String(editing.amount),
        currency: editing.currency,
        feeText: editing.fee ? String(editing.fee) : "",
        toAmountText: editing.toAmount ? String(editing.toAmount) : "",
        fxText: editing.fxRate ? String(editing.fxRate) : "",
        note: editing.note ?? "",
        basis: editing.quantity ? "quantity" : "amount",
      });
    } else {
      setPaso("tipo");
      setAvanzado(false);
      setHallados(null);
      setText("");
      setDraft(emptyDraft(defaultAccount, defaultCurrency));
      setCatalogHit(null);
      setConfidence(1);
      setAiNote(null);
    }
  }, [open, editing, assets, defaultAccount, defaultCurrency]);

  // En modo rapido, cada tecla vuelve a interpretar la frase completa.
  //
  // El estado se escribe desde el efecto a proposito: no es una derivacion
  // pura, es un "resetear el formulario cuando cambia la frase". Despues de
  // cada lectura el usuario puede editar cualquier campo a mano, asi que el
  // borrador tiene que vivir en estado y no calcularse en cada render.
  useEffect(() => {
    if (paso !== "escribir" || !open) return;
    if (!text.trim()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setWarnings([]);
      setCatalogHit(null);
      return;
    }
    const parsed = parseQuickEntry(text, {
      accounts,
      assets,
      defaultAccountId: defaultAccount,
    });
    if (!parsed) return;
    setWarnings(parsed.warnings);
    setCatalogHit(parsed.catalog ?? null);
    setConfidence(parsed.confidence);
    setAiNote(null);
    // "vendí todo el SPY": completamos la cantidad con la tenencia real.
    const holding = parsed.assetId
      ? positionsRef.current.find((pos) => pos.assetId === parsed.assetId)
      : undefined;
    const allQuantity = parsed.all && holding ? holding.quantity : undefined;

    setDraft((prev) => ({
      ...prev,
      type: parsed.type,
      date: parsed.day,
      accountId: parsed.accountId ?? defaultAccount,
      counterAccountId: parsed.counterAccountId ?? "",
      symbol: parsed.symbol ?? "",
      assetId: parsed.assetId ?? "",
      quantityText:
        allQuantity !== undefined
          ? fmtQty(allQuantity, 8)
          : parsed.quantity !== undefined
            ? fmtQty(parsed.quantity, 8)
            : "",
      priceText:
        parsed.price !== undefined
          ? String(parsed.price)
          : allQuantity !== undefined && holding?.price
            ? String(holding.price)
            : "",
      // Con total y unidades, el campo de monto muestra el total del
      // comprobante tal como se dijo; el bruto sin comision lo recalcula
      // `computed`, igual que cuando se carga a mano.
      amountText:
        parsed.basis === "total" && parsed.total !== undefined
          ? String(parsed.total)
          : parsed.amount !== undefined
            ? String(parsed.amount)
            : "",
      currency: parsed.currency,
      feeText: parsed.fee !== undefined ? String(parsed.fee) : "",
      toAmountText: parsed.toAmount !== undefined ? String(parsed.toAmount) : "",
      basis: allQuantity !== undefined ? "quantity" : parsed.basis,
    }));
    // Sin `portfolio` en las dependencias a proposito: un refresco de precios
    // no tiene que volver a parsear la frase y pisar lo que el usuario acaba
    // de retocar a mano.
  }, [text, paso, open, accounts, assets, defaultAccount]);

  const needsAsset = draft.type === "buy" || draft.type === "sell" || draft.type === "dividend";
  const isExchange = draft.type === "exchange";

  /**
   * Un cambio de moneda: en pesos sale lo que se paga y en dolares entra lo
   * que se recibe (al reves si se venden). El sentido lo da la moneda de lo
   * que sale, asi no hay un tercer campo que pueda contradecir a los otros.
   */
  const cambio = useMemo(() => {
    if (!isExchange) return null;
    const sale = num(draft.amountText);
    const entra = num(draft.toAmountText);
    const comprando = draft.currency === "ARS";
    const pesos = comprando ? sale : entra;
    const dolares = comprando ? entra : sale;
    return {
      comprando,
      entra,
      toCurrency: (comprando ? "USD" : "ARS") as Currency,
      // Pesos por dolar. Es el tipo de cambio que se guarda con el movimiento.
      rate: pesos !== undefined && dolares ? pesos / dolares : undefined,
    };
  }, [isExchange, draft.amountText, draft.toAmountText, draft.currency]);
  const isTrade = draft.type === "buy" || draft.type === "sell";

  /**
   * Lo que cotizaba el activo el dia de la operacion, en su moneda.
   *
   * La posicion se valua a la cotizacion, asi que las unidades que salen de
   * un precio que no es el del mercado aparecen como ganancia o perdida en el
   * momento de guardar. Comprar hoy $ 450.000 de SPY con el precio de otro dia
   * daba rendimiento el mismo dia de la compra. Solo para un activo que ya
   * esta cargado: de uno nuevo todavia no hay cotizacion guardada.
   *
   * Con el precio vacio se usa esta: el campo la muestra y sigue a la fecha
   * y al activo mientras nadie escriba otro. Si el usuario escribe el suyo,
   * queda el suyo, y el aviso de abajo dice cuanto se aleja.
   */
  const referencia = useMemo(() => {
    if (!isTrade) return null;
    const elegido = draft.assetId ? assets.find((a) => a.id === draft.assetId) : undefined;
    const symbol = (elegido?.symbol ?? draft.symbol).trim().toUpperCase();
    if (!symbol) return null;
    // El mismo camino que al guardar: en pesos, SPY es SPY.BA.
    const { asset, nuevo } = resolveTradeAsset(assets, symbol, draft.currency, () => "", {
      catalog: catalogHit ?? undefined,
      existing: elegido,
      broker: accounts.find((a) => a.id === draft.accountId)?.broker,
    });
    if (nuevo) return null;
    const ref = marketPrice(asset.id, draft.date, draft.currency);
    return ref ? { ...ref, symbol: asset.symbol } : null;
  }, [isTrade, draft.assetId, draft.symbol, draft.currency, draft.date, draft.accountId, assets, accounts, catalogHit, marketPrice]);

  /** Monto y cantidad se derivan uno del otro segun como lo hayas dicho. */
  const computed = useMemo(() => {
    if (draft.basis === "total") {
      // El total del comprobante ya trae la comision adentro. El movimiento
      // guarda el monto bruto y la comision aparte, asi que se separa: en una
      // compra lo pagado es bruto + comision, en una venta lo cobrado es
      // bruto - comision. El costo de la posicion termina siendo el mismo.
      const total = num(draft.amountText);
      const qty = num(draft.quantityText);
      const fee = num(draft.feeText) ?? 0;
      const amount =
        total === undefined ? undefined : draft.type === "sell" ? total + fee : total - fee;
      return {
        amount,
        quantity: qty,
        price: amount !== undefined && qty !== undefined && qty > 0 ? amount / qty : undefined,
      };
    }
    const price = num(draft.priceText) ?? referencia?.price;
    if (draft.basis === "quantity") {
      const qty = num(draft.quantityText);
      return { quantity: qty, price, amount: qty !== undefined && price !== undefined ? qty * price : num(draft.amountText) };
    }
    const amount = num(draft.amountText);
    return {
      amount,
      price,
      quantity: amount !== undefined && price !== undefined && price > 0 ? amount / price : num(draft.quantityText),
    };
  }, [draft.basis, draft.type, draft.quantityText, draft.priceText, draft.amountText, draft.feeText, referencia?.price]);

  /**
   * Cuanto se aleja lo cargado de la cotizacion de ese dia, y lo que eso va a
   * mostrar como resultado apenas se guarde. Un 5% cubre la punta
   * compradora-vendedora y lo que se mueve un precio en el dia.
   */
  const desvio = useMemo(() => {
    if (!referencia || computed.price === undefined || !(computed.price > 0)) return null;
    if (computed.quantity === undefined || !(computed.quantity > 0)) return null;
    const r = computed.price / referencia.price - 1;
    if (Math.abs(r) < 0.05) return null;
    // Comprar por encima del mercado es perder la diferencia en el acto;
    // vender por encima, ganarla.
    const signo = draft.type === "sell" ? 1 : -1;
    const diff = signo * (computed.price - referencia.price) * computed.quantity;
    const fx = portfolio.fxLatest;
    const diffUsd = draft.currency === "ARS" ? (fx > 0 ? diff / fx : null) : diff;
    return { r, diffUsd };
  }, [referencia, computed.price, computed.quantity, draft.type, draft.currency, portfolio.fxLatest]);

  const suggestions = useMemo(() => {
    if (!needsAsset || draft.assetId || draft.symbol.length < 1) return [];
    return searchCatalog(draft.symbol, 5);
  }, [needsAsset, draft.assetId, draft.symbol]);

  const accountName = accounts.find((a) => a.id === draft.accountId)?.name ?? "—";

  /**
   * El CEDEAR que va a guardarse en lugar de la accion, si corresponde.
   *
   * No es un aviso de error: es la app haciendo lo correcto, pero el simbolo
   * que queda guardado no es el que el usuario escribio y eso tiene que verse
   * antes de tocar Agregar.
   */
  const comoCedear = useMemo(() => {
    if (!needsAsset) return null;
    const cuenta = accounts.find((a) => a.id === draft.accountId);
    if (!tradesAsCedear(draft.currency, cuenta?.broker)) return null;
    const elegido = draft.assetId ? assets.find((a) => a.id === draft.assetId) : undefined;
    const plantilla = elegido ?? catalogHit ?? (draft.symbol ? lookupCatalog(draft.symbol) : undefined);
    if (!plantilla || !isUsListing(plantilla)) return null;
    return {
      accion: plantilla.symbol,
      cedear: cedearSymbol(plantilla.symbol),
      // La razon que se muestra es la que aplica: en pesos vale para todos; en
      // dolares, solo porque el broker opera en BYMA.
      porque: draft.currency === "ARS" ? "En pesos" : `En ${cuenta?.name ?? "este broker"}`,
    };
  }, [needsAsset, draft.currency, draft.accountId, draft.assetId, draft.symbol, assets, accounts, catalogHit]);

  /**
   * Avisos que la app puede dar mirando el resto de los datos, no la frase.
   * Un movimiento mal cargado no se nota: simplemente todas las metricas
   * quedan un poco mal para siempre.
   */
  const checks = useMemo(() => {
    const out: string[] = [];

    // Vender mas de lo que tenes deja la posicion en negativo y rompe el
    // costo promedio sin que nada se vea roto en pantalla.
    if (draft.type === "sell" && draft.assetId && computed.quantity !== undefined) {
      const held = portfolio.positions.find((pos) => pos.assetId === draft.assetId);
      const available = held?.quantity ?? 0;
      if (computed.quantity > available + 1e-9) {
        out.push(
          available > 0
            ? `Tenés ${fmtQty(available, 6)} ${draft.symbol} y estás vendiendo ${fmtQty(computed.quantity, 6)}.`
            : `No figura ninguna tenencia de ${draft.symbol} para vender.`,
        );
      }
    }

    // Gastar mas efectivo del que hay en la cuenta.
    //
    // La cuenta cierra igual: el saldo se va a negativo y ese negativo
    // cancela exactamente el activo de mas, asi que NO aparece ganancia
    // fantasma (hay un test del motor que lo fija). Pero la cartera queda
    // describiendo algo que no pudo pasar, y en la practica casi siempre
    // significa que falta cargar el ingreso que financio la compra.
    const gastaEfectivo =
      draft.type === "buy" ||
      draft.type === "withdraw" ||
      draft.type === "transfer" ||
      draft.type === "fee";
    if (gastaEfectivo && computed.amount !== undefined && computed.amount > 0) {
      const cuenta = portfolio.accountViews.find((v) => v.accountId === draft.accountId);
      // En pesos hace falta el dolar para comparar contra un saldo en dolares.
      // Sin cotizacion no se avisa, antes que avisar con un numero inventado.
      const fx = portfolio.fxLatest;
      const montoUsd =
        draft.currency === "ARS" ? (fx > 0 ? computed.amount / fx : null) : computed.amount;
      // Al editar, el movimiento que se esta tocando ya esta contado en el
      // saldo: si no se devuelve, cualquier edicion se veria en descubierto.
      const devuelto =
        editing && editing.accountId === draft.accountId && editing.currency === "USD"
          ? editing.amount
          : 0;
      const disponible = (cuenta?.cashUsd ?? 0) + devuelto;
      // Un centavo de diferencia por redondeo no es un descubierto.
      if (cuenta && montoUsd !== null && montoUsd > disponible + 0.01) {
        out.push(
          disponible > 0
            ? `En ${cuenta.name} figuran ${money(disponible, "USD")} y esto usa ${money(montoUsd, "USD")}. ¿Falta cargar el ingreso?`
            : `En ${cuenta.name} no figura efectivo disponible. ¿Falta cargar el ingreso?`,
        );
      }
    }

    // Duplicado exacto: pasa al cargar dos veces lo mismo sin darse cuenta.
    if (!editing && computed.amount !== undefined) {
      const dup = transactions.find(
        (t) =>
          t.date.slice(0, 10) === draft.date &&
          t.type === draft.type &&
          t.accountId === draft.accountId &&
          (t.assetId ?? "") === (draft.assetId || "") &&
          Math.abs(t.amount - computed.amount!) < 0.01,
      );
      if (dup) out.push("Ya hay un movimiento igual ese mismo día. ¿Lo estás cargando dos veces?");
    }

    if (draft.type === "transfer" && draft.accountId === draft.counterAccountId) {
      out.push("El origen y el destino son la misma cuenta.");
    }

    return out;
  }, [draft, computed, portfolio.positions, portfolio.accountViews, portfolio.fxLatest, transactions, editing]);

  /** Resumen en una linea de lo que se va a guardar. */
  const summary = useMemo(() => {
    const parts: string[] = [TX_LABEL[draft.type]];
    if (needsAsset && draft.symbol) {
      // Lo que se va a guardar, no lo que se escribio: en pesos, SPY es SPY.BA.
      const simbolo = comoCedear?.cedear ?? draft.symbol;
      parts.push(
        computed.quantity !== undefined ? `${fmtQty(computed.quantity, 6)} ${simbolo}` : simbolo,
      );
      if (computed.price !== undefined) parts.push(`a ${money(computed.price, draft.currency)}`);
    }
    if (computed.amount !== undefined) parts.push(money(computed.amount, draft.currency));
    if (cambio?.entra !== undefined) parts.push(`→ ${money(cambio.entra, cambio.toCurrency)}`);
    if (cambio?.rate) parts.push(`dólar a ${money(cambio.rate, "ARS")}`);
    parts.push(accountName);
    if (draft.type === "transfer") {
      const dest = accounts.find((a) => a.id === draft.counterAccountId)?.name;
      if (dest) parts.push(`→ ${dest}`);
    }
    parts.push(draft.date === today() ? "hoy" : longDate(draft.date));
    return parts.join(" · ");
  }, [draft, computed, needsAsset, accountName, accounts, cambio, comoCedear]);

  const canSave =
    Boolean(draft.accountId) &&
    computed.amount !== undefined &&
    computed.amount > 0 &&
    (!needsAsset || Boolean(draft.symbol)) &&
    (draft.type !== "transfer" || Boolean(draft.counterAccountId)) &&
    (!isExchange || (cambio?.entra !== undefined && cambio.entra > 0)) &&
    (!isTrade || (computed.quantity !== undefined && computed.quantity > 0));

  /**
   * Busca el activo o lo crea, usando el catalogo cuando lo reconoce.
   *
   * Pasa siempre por `resolveTradeAsset`, incluso cuando la frase ya eligio un
   * activo cargado: si ese activo es la accion de EE.UU. y la operacion es en
   * pesos, lo que se compro es el CEDEAR, y confiar en la eleccion del parser
   * volveria a meter nueve acciones de US$ 660 donde hay nueve CEDEARs.
   */
  async function resolveAsset(): Promise<string | undefined> {
    if (!needsAsset) return undefined;
    const elegido = draft.assetId ? assets.find((a) => a.id === draft.assetId) : undefined;
    const symbol = (elegido?.symbol ?? draft.symbol).trim().toUpperCase();
    if (!symbol) return draft.assetId || undefined;

    // Un hallazgo del buscador trae ya resuelto proveedor, moneda y precision;
    // tiene la misma forma que una entrada del catalogo salvo los alias.
    const hallado = encontrado.current;
    const desdeBusqueda =
      hallado && hallado.symbol.toUpperCase() === symbol
        ? { ...hallado, aliases: [] }
        : undefined;

    const { asset, nuevo } = resolveTradeAsset(assets, symbol, draft.currency, newId, {
      catalog: desdeBusqueda ?? catalogHit ?? undefined,
      existing: elegido,
      broker: accounts.find((a) => a.id === draft.accountId)?.broker,
    });
    if (nuevo) await saveAsset(asset);
    return asset.id;
  }

  /**
   * Segunda lectura con el modelo, solo a pedido.
   *
   * El parser local resuelve la enorme mayoria de las frases sin salir del
   * telefono y sin costo. Esto entra unicamente cuando el usuario ve que la
   * lectura quedo floja y toca el boton: no se dispara solo.
   */
  async function askAi() {
    if (asking || !text.trim()) return;
    setAsking(true);
    setError(null);
    setAiNote(null);
    try {
      const data = await parseEntry(
        {
          text: text.trim(),
          accounts: accounts.map((a) => ({ id: a.id, name: a.name })),
          symbols: assets.map((a) => a.symbol),
          today: today(),
        },
        backend(),
      );
      const symbol: string = data.symbol ?? "";
      const match = assets.find((a) => a.symbol.toUpperCase() === symbol.toUpperCase());
      setCatalogHit(lookupCatalog(symbol) ?? null);
      setDraft((prev) => ({
        ...prev,
        type: data.type ?? prev.type,
        date: data.date ?? prev.date,
        accountId: data.accountId ?? prev.accountId,
        counterAccountId: data.counterAccountId ?? "",
        symbol,
        assetId: match?.id ?? "",
        quantityText: data.quantity !== null ? fmtQty(data.quantity, 8) : "",
        priceText: data.price !== null ? String(data.price) : "",
        amountText: data.amount !== null ? String(data.amount) : "",
        currency: data.currency ?? prev.currency,
        feeText: data.fee !== null ? String(data.fee) : "",
        note: data.note ?? prev.note,
        basis: data.quantity !== null && data.amount === null ? "quantity" : prev.basis,
      }));
      setWarnings([]);
      setConfidence(1);
      setAiNote(data.reasoning ?? null);
      // A partir de acá el usuario retoca sobre el formulario: si seguimos en
      // modo texto, la próxima tecla pisaría lo que el modelo interpretó.
      setPaso("datos");
    } catch (err) {
      setError(describeBackendError(err));
    } finally {
      setAsking(false);
    }
  }

  async function handleSave() {
    if (!canSave || saving) return;
    setSaving(true);
    setError(null);
    try {
      const assetId = await resolveAsset();
      const now = new Date().toISOString();
      const tx: Transaction = {
        id: editing?.id ?? newId(),
        date: draft.date,
        type: draft.type,
        accountId: draft.accountId,
        counterAccountId: draft.type === "transfer" ? draft.counterAccountId : undefined,
        assetId,
        quantity: isTrade ? computed.quantity : undefined,
        price: isTrade ? computed.price : undefined,
        amount: computed.amount!,
        currency: draft.currency,
        fee: num(draft.feeText),
        fxRate: isExchange
          ? cambio?.rate
          : draft.currency === "ARS"
            ? num(draft.fxText)
            : undefined,
        toAmount: isExchange ? cambio?.entra : undefined,
        toCurrency: isExchange ? cambio?.toCurrency : undefined,
        note: draft.note.trim() || undefined,
        raw: paso === "escribir" && text.trim() ? text.trim() : editing?.raw,
        createdAt: editing?.createdAt ?? now,
        updatedAt: now,
      };
      await saveTransaction(tx);
      // Un activo nuevo no tiene precios todavia: los pedimos enseguida.
      if (assetId && !assets.some((a) => a.id === assetId)) void refresh();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const set = (patch: Partial<Draft>) => setDraft((prev) => ({ ...prev, ...patch }));

  /** Activos que ya tenés: elegir de una lista es mejor que tipear un ticker. */
  const enCartera = useMemo(
    () => portfolio.positions.filter((pos) => pos.quantity > 0).slice(0, 8),
    [portfolio.positions],
  );

  const tipoActual = TODOS.find((t) => t.value === draft.type);

  /**
   * Busca el nombre escrito contra el proveedor.
   *
   * El catalogo local es una lista a mano: escribir "Nike" no encontraba nada
   * porque Nike no estaba, y agregar nombres de a uno es una carrera que no se
   * gana. Esto le pregunta al proveedor, que conoce todo lo que cotiza.
   */
  async function buscarActivo() {
    const q = draft.symbol.trim();
    if (q.length < 2 || buscando) return;
    setBuscando(true);
    setError(null);
    try {
      const hits = await searchSymbols(q, backend());
      setHallados(hits);
      if (hits.length === 0) {
        setError(`No encontré ningún activo que se llame «${q}». Probá con el ticker.`);
      }
    } catch (err) {
      setError(describeBackendError(err));
    } finally {
      setBuscando(false);
    }
  }

  function elegirHallado(hit: SymbolHit) {
    setCatalogHit(null);
    setHallados(null);
    set({ symbol: hit.symbol, assetId: "", currency: hit.currency });
    // El activo se crea al guardar; `resolveAsset` mira el catalogo y, si no
    // esta, arma uno con lo que le pasemos. Guardamos el hallazgo para eso.
    encontrado.current = hit;
  }

  function elegirTipo(value: TxType) {
    set(value === "exchange" ? { type: value, currency: "ARS" } : { type: value });
    setPaso("datos");
  }

  const resumen = (
    <div className="card mb-4 p-3">
      <div className="eyebrow mb-1.5">Se va a guardar</div>
      <p className="text-[13px] leading-snug">{summary}</p>
      {aiNote && (
        <p className="mt-2 text-[11px] leading-snug" style={{ color: "var(--color-s1)" }}>
          {aiNote}
        </p>
      )}
      {comoCedear && (
        <p className="label mt-2 leading-snug">
          {comoCedear.porque}, {comoCedear.accion} se carga como su CEDEAR ({comoCedear.cedear}),
          que cotiza en BYMA. Desde acá no se compra la acción de EE.UU., y un CEDEAR es
          una fracción de ella: contarlos como acciones inflaría el valor.
        </p>
      )}
      {desvio && referencia && (
        <div className="mt-2 text-[11px] leading-snug" style={{ color: "var(--color-warn)" }}>
          <p className="flex items-start gap-1.5">
            <IconWarning size={13} className="mt-px shrink-0" />
            <span>
              {referencia.live
                ? `Hoy ${referencia.symbol} cotiza `
                : `El ${shortDate(referencia.day, true)} ${referencia.symbol} cotizaba `}
              {money(referencia.price, referencia.currency)} y acá dice{" "}
              {money(computed.price, draft.currency)} ({percent(desvio.r, { sign: true })}).
              {desvio.diffUsd !== null &&
                ` Al guardarlo, la diferencia aparece en el acto como ${desvio.diffUsd >= 0 ? "ganancia" : "pérdida"} de ${money(Math.abs(desvio.diffUsd), "USD")}.`}
              {draft.basis === "total" && " Revisá las unidades contra el comprobante."}
            </span>
          </p>
          {draft.basis !== "total" && (
            <button
              type="button"
              className="btn btn-ghost mt-1.5 w-full text-[12px]"
              onClick={() => set({ priceText: "" })}
            >
              Usar la cotización
            </button>
          )}
        </div>
      )}
      {[...warnings, ...checks].length > 0 && (
        <ul className="mt-2 space-y-1">
          {[...warnings, ...checks].map((w) => (
            <li
              key={w}
              className="flex items-start gap-1.5 text-[11px]"
              style={{ color: "var(--color-warn)" }}
            >
              <IconWarning size={13} className="mt-px shrink-0" />
              <span>{w}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  const guardar = (
    <button
      className="btn btn-primary flex-[2]"
      disabled={!canSave || saving}
      onClick={handleSave}
    >
      {saving ? "Guardando…" : editing ? "Guardar cambios" : "Agregar"}
    </button>
  );

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={
        editing
          ? "Editar movimiento"
          : paso === "tipo"
            ? "¿Qué hiciste?"
            : paso === "escribir"
              ? "Escribir el movimiento"
              : (tipoActual?.label ?? "Nuevo movimiento")
      }
      footer={
        paso === "tipo" ? undefined : (
          <div className="flex gap-2">
            <button
              className="btn btn-ghost flex-1"
              onClick={() => (editing ? onClose() : setPaso("tipo"))}
            >
              {editing ? "Cancelar" : "Atrás"}
            </button>
            {guardar}
          </div>
        )
      }
    >
      {/* --- Paso 1: que clase de movimiento es ------------------------------ */}
      {paso === "tipo" && (
        <>
          <div className="grid grid-cols-2 gap-2">
            {PRINCIPALES.map((t) => (
              <button
                key={t.value}
                className="card p-3 text-left"
                style={{ borderLeft: `3px solid ${txColor(t.value)}` }}
                onClick={() => elegirTipo(t.value)}
              >
                <div className="text-[15px] font-medium">{t.label}</div>
                <div className="label mt-1 leading-snug">{t.detalle}</div>
              </button>
            ))}
          </div>

          <div className="eyebrow mb-2 mt-4">Menos frecuentes</div>
          <ul className="card divide-hairline">
            {SECUNDARIOS.map((t) => (
              <li key={t.value}>
                <button
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
                  onClick={() => elegirTipo(t.value)}
                >
                  <span
                    aria-hidden
                    style={{ width: 3, height: 16, background: txColor(t.value) }}
                  />
                  <span className="min-w-0 flex-1 truncate text-[13px]">{t.label}</span>
                  <span className="label shrink-0">{t.detalle}</span>
                </button>
              </li>
            ))}
          </ul>

          <button
            className="btn btn-sm mt-4 w-full"
            onClick={() => {
              setPaso("escribir");
              setText("");
            }}
          >
            Escribirlo en una línea
          </button>
        </>
      )}

      {/* --- La frase suelta de siempre -------------------------------------- */}
      {paso === "escribir" && (
        <>
          <div className="mb-4">
            <input
              className="input"
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="compré 50 de QQQ a 480"
              enterKeyHint="done"
              onKeyDown={(e) => {
                if (e.key === "Enter" && canSave) void handleSave();
              }}
            />
            {confidence < 0.65 && text.trim().length > 3 && (
              <button className="btn btn-sm mt-2 w-full" onClick={askAi} disabled={asking}>
                {asking ? "Interpretando…" : "No quedó claro — que lo lea la IA"}
              </button>
            )}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {[
                "pasé 100 dólares a cocos",
                "compré 0.01 BTC a 95000",
                "vendí 2 QQQ a 520 ayer",
                "retiré 200 de binance",
              ].map((example) => (
                <button
                  key={example}
                  type="button"
                  className="chip"
                  style={{ textTransform: "none", letterSpacing: 0 }}
                  onClick={() => setText(example)}
                >
                  {example}
                </button>
              ))}
            </div>
          </div>

          {text.trim() && resumen}

          {text.trim() && (
            <button className="btn btn-sm w-full" onClick={() => setPaso("datos")}>
              Revisar los campos
            </button>
          )}
        </>
      )}

      {/* --- Paso 2: solo lo que este tipo necesita -------------------------- */}
      {paso === "datos" && (
        <div className="space-y-3">
          {needsAsset && (
            <div>
              <Field
                label="Activo"
                hint={catalogHit ? `Reconocido: ${catalogHit.name}` : undefined}
              >
                <input
                  className="input"
                  value={draft.symbol}
                  placeholder="QQQ, BTC, GGAL…"
                  autoCapitalize="characters"
                  onChange={(e) => {
                    const value = e.target.value;
                    const match = assets.find(
                      (a) => a.symbol.toUpperCase() === value.toUpperCase(),
                    );
                    setCatalogHit(lookupCatalog(value) ?? null);
                    setHallados(null);
                    encontrado.current = null;
                    set({ symbol: value, assetId: match?.id ?? "" });
                  }}
                />
              </Field>
              {/* Cuando ni el catálogo ni tu cartera lo conocen, se le
                  pregunta al proveedor. Es lo que hace que «Nike» funcione
                  sin que nadie lo haya escrito en una lista. */}
              {draft.symbol.trim().length >= 2 &&
                !draft.assetId &&
                !catalogHit &&
                suggestions.length === 0 &&
                hallados === null && (
                  <button
                    className="btn btn-sm mt-2 w-full"
                    onClick={() => void buscarActivo()}
                    disabled={buscando}
                  >
                    {buscando ? "Buscando…" : `Buscar «${draft.symbol.trim()}»`}
                  </button>
                )}

              {hallados !== null && hallados.length > 0 && (
                <ul className="card divide-hairline mt-2">
                  {hallados.map((hit) => (
                    <li key={hit.symbol}>
                      <button
                        className="flex w-full items-center gap-2 p-2.5 text-left"
                        onClick={() => elegirHallado(hit)}
                      >
                        <span className="num shrink-0 text-[13px]">{hit.symbol}</span>
                        <span className="label min-w-0 flex-1 truncate">{hit.name}</span>
                        <span className="label shrink-0">{hit.exchange ?? hit.currency}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {/* Lo que ya tenés, primero: en una cartera real el 90% de las
                  operaciones son sobre un activo que ya está adentro. */}
              {!draft.symbol && enCartera.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {enCartera.map((pos) => (
                    <button
                      key={pos.assetId}
                      type="button"
                      className="chip"
                      onClick={() => set({ symbol: pos.symbol, assetId: pos.assetId })}
                    >
                      {pos.symbol}
                    </button>
                  ))}
                </div>
              )}
              {suggestions.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {suggestions.map((s) => (
                    <button
                      key={s.symbol}
                      type="button"
                      className="chip"
                      onClick={() => {
                        setCatalogHit(s);
                        set({ symbol: s.symbol, currency: s.currency });
                      }}
                    >
                      {s.symbol}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Con una sola cuenta no hay nada que elegir. */}
          {accounts.length > 1 && (
            <Field label={draft.type === "transfer" ? "Desde" : "En qué cuenta"}>
              <Segmented
                value={draft.accountId}
                onChange={(v) => set({ accountId: v })}
                options={accounts.map((a) => ({ value: a.id, label: a.name }))}
              />
            </Field>
          )}

          {draft.type === "transfer" && (
            <Field label="Hacia">
              <Segmented
                value={draft.counterAccountId}
                onChange={(v) => set({ counterAccountId: v })}
                options={accounts
                  .filter((a) => a.id !== draft.accountId)
                  .map((a) => ({ value: a.id, label: a.name }))}
              />
            </Field>
          )}

          {isExchange && cambio ? (
            <>
              <Segmented
                value={cambio.comprando ? "compre" : "vendi"}
                // El sentido es la moneda de lo que sale. Al darlo vuelta se
                // intercambian los montos, para no dejar pesos en el campo
                // de dolares.
                onChange={(v) =>
                  (v === "compre") !== cambio.comprando &&
                  set({
                    currency: v === "compre" ? "ARS" : "USD",
                    amountText: draft.toAmountText,
                    toAmountText: draft.amountText,
                  })
                }
                options={[
                  { value: "compre", label: "Compré dólares" },
                  { value: "vendi", label: "Vendí dólares" },
                ]}
              />
              <div className="grid grid-cols-2 gap-3">
                <Field label={cambio.comprando ? "Pagué (pesos)" : "Entregué (dólares)"}>
                  <input
                    className="input num"
                    inputMode="decimal"
                    value={draft.amountText}
                    onChange={(e) => set({ amountText: e.target.value })}
                    placeholder={cambio.comprando ? "145.000" : "100"}
                  />
                </Field>
                <Field label={cambio.comprando ? "Recibí (dólares)" : "Recibí (pesos)"}>
                  <input
                    className="input num"
                    inputMode="decimal"
                    value={draft.toAmountText}
                    onChange={(e) => set({ toAmountText: e.target.value })}
                    placeholder={cambio.comprando ? "100" : "145.000"}
                  />
                </Field>
              </div>
              <p className="text-[11px] leading-snug" style={{ color: "var(--color-ink-3)" }}>
                {cambio.rate
                  ? `Dólar a ${money(cambio.rate, "ARS")}. `
                  : ""}
                No es capital ni ganancia: es la misma plata en otra moneda.
              </p>
            </>
          ) : isTrade ? (
            <>
              <div>
                <span className="eyebrow mb-1.5 block">Cómo lo cargás</span>
                <Segmented
                  value={draft.basis}
                  onChange={(v) => set({ basis: v })}
                  options={[
                    { value: "amount", label: "Monto" },
                    { value: "quantity", label: "Unidades" },
                    { value: "total", label: "Total y unid." },
                  ]}
                />
              </div>
              {draft.basis === "total" ? (
                <div className="grid grid-cols-2 gap-3">
                  <Field label={draft.type === "sell" ? "Total cobrado" : "Total pagado"}>
                    <input
                      className="input num"
                      inputMode="decimal"
                      value={draft.amountText}
                      onChange={(e) => set({ amountText: e.target.value })}
                      placeholder="456.345"
                    />
                  </Field>
                  <Field label="Unidades">
                    <input
                      className="input num"
                      inputMode="decimal"
                      value={draft.quantityText}
                      onChange={(e) => set({ quantityText: e.target.value })}
                      placeholder="9"
                    />
                  </Field>
                </div>
              ) : (
              <div className="grid grid-cols-2 gap-3">
                <Field label={draft.basis === "amount" ? "Monto invertido" : "Unidades"}>
                  <input
                    className="input num"
                    inputMode="decimal"
                    value={draft.basis === "amount" ? draft.amountText : draft.quantityText}
                    onChange={(e) =>
                      draft.basis === "amount"
                        ? set({ amountText: e.target.value })
                        : set({ quantityText: e.target.value })
                    }
                    placeholder={draft.basis === "amount" ? "50" : "0,01"}
                  />
                </Field>
                <Field label="Precio unitario">
                  <input
                    className="input num"
                    inputMode="decimal"
                    value={draft.priceText || (referencia ? precioTexto(referencia.price) : "")}
                    onChange={(e) => set({ priceText: e.target.value })}
                    placeholder="480"
                  />
                </Field>
              </div>
              )}
              <p className="text-[11px]" style={{ color: "var(--color-ink-3)" }}>
                {draft.basis === "amount"
                  ? `Equivale a ${computed.quantity !== undefined ? fmtQty(computed.quantity, 8) : "—"} unidades.`
                  : draft.basis === "quantity"
                    ? `Total: ${computed.amount !== undefined ? money(computed.amount, draft.currency) : "—"}.`
                    : `Precio por unidad: ${computed.price !== undefined ? money(computed.price, draft.currency) : "—"}${num(draft.feeText) ? ", sin la comisión" : ""}.`}
                {referencia &&
                  ` Cotización ${referencia.live ? "de hoy" : `del ${shortDate(referencia.day, true)}`}: ${money(referencia.price, referencia.currency)}.`}
              </p>
            </>
          ) : (
            <Field label="Monto">
              <input
                className="input num"
                inputMode="decimal"
                value={draft.amountText}
                onChange={(e) => set({ amountText: e.target.value })}
                placeholder="100"
              />
            </Field>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Fecha">
              <input
                type="date"
                className="input"
                value={draft.date}
                max={today()}
                onChange={(e) => set({ date: e.target.value })}
              />
            </Field>
            {/* En un cambio la moneda la decide si compraste o vendiste. */}
            {!isExchange && (
              <Field label="Moneda">
                <Segmented
                  value={draft.currency}
                  onChange={(v) => set({ currency: v })}
                  options={[
                    { value: "USD", label: "USD" },
                    { value: "ARS", label: "ARS" },
                  ]}
                />
              </Field>
            )}
          </div>

          {resumen}

          {/* Lo que casi nunca se toca, detrás de un toque. */}
          <button
            className="btn btn-sm w-full"
            onClick={() => setAvanzado((v) => !v)}
            aria-expanded={avanzado}
          >
            {avanzado
              ? "Ocultar detalles"
              : isExchange
                ? "Comisión y nota"
                : "Comisión, tipo de cambio y nota"}
          </button>

          {avanzado && (
            <div className="space-y-3">
              <Field label="Comisión">
                <input
                  className="input num"
                  inputMode="decimal"
                  value={draft.feeText}
                  onChange={(e) => set({ feeText: e.target.value })}
                  placeholder="0"
                />
              </Field>

              {/* En un cambio el dolar sale de los dos montos: un tercer campo
                  solo podria contradecirlos. */}
              {draft.currency === "ARS" && !isExchange && (
                <Field
                  label="Dólar de la operación"
                  hint="Opcional. Sin esto se usa el MEP del día que traiga la app."
                >
                  <input
                    className="input num"
                    inputMode="decimal"
                    value={draft.fxText}
                    onChange={(e) => set({ fxText: e.target.value })}
                    placeholder="1250"
                  />
                </Field>
              )}

              <Field label="Nota">
                <input
                  className="input"
                  value={draft.note}
                  onChange={(e) => set({ note: e.target.value })}
                  placeholder="Opcional"
                />
              </Field>

              {editing && (
                <Field label="Tipo">
                  <select
                    className="input"
                    value={draft.type}
                    onChange={(e) => set({ type: e.target.value as TxType })}
                  >
                    {TODOS.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
            </div>
          )}

          {settings.baseCurrency === "USD" && draft.currency === "ARS" && (
            <p className="text-[11px]" style={{ color: "var(--color-ink-3)" }}>
              Todo se muestra en dólares. Los pesos se convierten al MEP de cada fecha.
            </p>
          )}
        </div>
      )}

      {error && <p className="mt-3 text-[12px] neg">{error}</p>}
    </Sheet>
  );
}
