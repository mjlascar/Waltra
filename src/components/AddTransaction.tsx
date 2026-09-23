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
import { assetFromSymbol, findAssetBySymbol, lastUsedAccountId } from "@/lib/assets";
import { longDate, money, quantity as fmtQty, TX_LABEL } from "@/lib/format";
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
  basis: "amount" | "quantity";
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
    note: "",
    basis: "amount",
  };
}

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
    saveTransaction, saveAsset, refresh, settings, backend,
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
      amountText: parsed.amount !== undefined ? String(parsed.amount) : "",
      currency: parsed.currency,
      feeText: parsed.fee !== undefined ? String(parsed.fee) : "",
      basis: allQuantity !== undefined ? "quantity" : parsed.basis,
    }));
    // Sin `portfolio` en las dependencias a proposito: un refresco de precios
    // no tiene que volver a parsear la frase y pisar lo que el usuario acaba
    // de retocar a mano.
  }, [text, paso, open, accounts, assets, defaultAccount]);

  const needsAsset = draft.type === "buy" || draft.type === "sell" || draft.type === "dividend";
  const isTrade = draft.type === "buy" || draft.type === "sell";

  /** Monto y cantidad se derivan uno del otro segun como lo hayas dicho. */
  const computed = useMemo(() => {
    const price = num(draft.priceText);
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
  }, [draft.basis, draft.quantityText, draft.priceText, draft.amountText]);

  const suggestions = useMemo(() => {
    if (!needsAsset || draft.assetId || draft.symbol.length < 1) return [];
    return searchCatalog(draft.symbol, 5);
  }, [needsAsset, draft.assetId, draft.symbol]);

  const accountName = accounts.find((a) => a.id === draft.accountId)?.name ?? "—";

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
      parts.push(
        computed.quantity !== undefined
          ? `${fmtQty(computed.quantity, 6)} ${draft.symbol}`
          : draft.symbol,
      );
      if (computed.price !== undefined) parts.push(`a ${money(computed.price, draft.currency)}`);
    }
    if (computed.amount !== undefined) parts.push(money(computed.amount, draft.currency));
    parts.push(accountName);
    if (draft.type === "transfer") {
      const dest = accounts.find((a) => a.id === draft.counterAccountId)?.name;
      if (dest) parts.push(`→ ${dest}`);
    }
    parts.push(draft.date === today() ? "hoy" : longDate(draft.date));
    return parts.join(" · ");
  }, [draft, computed, needsAsset, accountName, accounts]);

  const canSave =
    Boolean(draft.accountId) &&
    computed.amount !== undefined &&
    computed.amount > 0 &&
    (!needsAsset || Boolean(draft.symbol)) &&
    (draft.type !== "transfer" || Boolean(draft.counterAccountId)) &&
    (!isTrade || (computed.quantity !== undefined && computed.quantity > 0));

  /** Busca el activo o lo crea, usando el catalogo cuando lo reconoce. */
  async function resolveAsset(): Promise<string | undefined> {
    if (!needsAsset) return undefined;
    if (draft.assetId) return draft.assetId;
    const symbol = draft.symbol.trim().toUpperCase();
    if (!symbol) return undefined;

    const existing = findAssetBySymbol(assets, symbol);
    if (existing) return existing.id;

    // Un hallazgo del buscador trae ya resuelto proveedor, moneda y precision;
    // tiene la misma forma que una entrada del catalogo salvo los alias.
    const hallado = encontrado.current;
    const desdeBusqueda =
      hallado && hallado.symbol.toUpperCase() === symbol
        ? { ...hallado, aliases: [] }
        : undefined;

    const asset = assetFromSymbol(symbol, newId(), {
      catalog: desdeBusqueda ?? catalogHit ?? undefined,
      currency: draft.currency,
    });
    await saveAsset(asset);
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
        fxRate: draft.currency === "ARS" ? num(draft.fxText) : undefined,
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
    set({ type: value });
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

          {isTrade ? (
            <>
              <div>
                <span className="eyebrow mb-1.5 block">Cómo lo cargás</span>
                <Segmented
                  value={draft.basis}
                  onChange={(v) => set({ basis: v })}
                  options={[
                    { value: "amount", label: "Por monto" },
                    { value: "quantity", label: "Por unidades" },
                  ]}
                />
              </div>
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
                    value={draft.priceText}
                    onChange={(e) => set({ priceText: e.target.value })}
                    placeholder="480"
                  />
                </Field>
              </div>
              <p className="text-[11px]" style={{ color: "var(--color-ink-3)" }}>
                {draft.basis === "amount"
                  ? `Equivale a ${computed.quantity !== undefined ? fmtQty(computed.quantity, 8) : "—"} unidades.`
                  : `Total: ${computed.amount !== undefined ? money(computed.amount, draft.currency) : "—"}.`}
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
          </div>

          {resumen}

          {/* Lo que casi nunca se toca, detrás de un toque. */}
          <button
            className="btn btn-sm w-full"
            onClick={() => setAvanzado((v) => !v)}
            aria-expanded={avanzado}
          >
            {avanzado ? "Ocultar detalles" : "Comisión, tipo de cambio y nota"}
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

              {draft.currency === "ARS" && (
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
