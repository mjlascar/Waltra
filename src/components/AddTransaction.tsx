"use client";

import { useEffect, useMemo, useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { Field, Segmented } from "@/components/ui/Field";
import { IconWarning } from "@/components/icons";
import { newId, useStore } from "@/lib/store";
import { parseQuickEntry } from "@/lib/parse/quick-add";
import { parseLooseNumber } from "@/lib/parse/number";
import { lookupCatalog, searchCatalog, type CatalogEntry } from "@/lib/catalog";
import { longDate, money, quantity as fmtQty, TX_LABEL } from "@/lib/format";
import { today } from "@/lib/date";
import type { Asset, Currency, Transaction, TxType } from "@/lib/types";

const TYPES: { value: TxType; label: string }[] = [
  { value: "deposit", label: "Ingreso" },
  { value: "buy", label: "Compra" },
  { value: "sell", label: "Venta" },
  { value: "withdraw", label: "Retiro" },
  { value: "transfer", label: "Transfer." },
  { value: "dividend", label: "Dividendo" },
  { value: "interest", label: "Interés" },
  { value: "fee", label: "Comisión" },
];

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
  const { accounts, assets, transactions, saveTransaction, saveAsset, refresh, settings } =
    useStore();

  // La cuenta predeterminada es la ultima que usaste: en la practica uno carga
  // varios movimientos seguidos del mismo lado.
  const defaultAccount = useMemo(() => {
    const last = [...transactions].sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt.localeCompare(b.createdAt),
    )[transactions.length - 1];
    if (last && accounts.some((a) => a.id === last.accountId)) return last.accountId;
    return accounts[0]?.id ?? "";
  }, [transactions, accounts]);
  const defaultCurrency =
    accounts.find((a) => a.id === defaultAccount)?.currency ?? accounts[0]?.currency ?? "USD";

  const [mode, setMode] = useState<"quick" | "form">("quick");
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(defaultAccount, defaultCurrency));
  const [warnings, setWarnings] = useState<string[]>([]);
  const [catalogHit, setCatalogHit] = useState<CatalogEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Al abrir: o cargamos el movimiento que se esta editando, o empezamos limpio.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setWarnings([]);
    if (editing) {
      const asset = assets.find((a) => a.id === editing.assetId);
      setMode("form");
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
      setMode("quick");
      setText("");
      setDraft(emptyDraft(defaultAccount, defaultCurrency));
      setCatalogHit(null);
    }
  }, [open, editing, assets, defaultAccount, defaultCurrency]);

  // En modo rapido, cada tecla vuelve a interpretar la frase completa.
  useEffect(() => {
    if (mode !== "quick" || !open) return;
    if (!text.trim()) {
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
    setDraft((prev) => ({
      ...prev,
      type: parsed.type,
      date: parsed.day,
      accountId: parsed.accountId ?? defaultAccount,
      counterAccountId: parsed.counterAccountId ?? "",
      symbol: parsed.symbol ?? "",
      assetId: parsed.assetId ?? "",
      quantityText: parsed.quantity !== undefined ? fmtQty(parsed.quantity, 8) : "",
      priceText: parsed.price !== undefined ? String(parsed.price) : "",
      amountText: parsed.amount !== undefined ? String(parsed.amount) : "",
      currency: parsed.currency,
      feeText: parsed.fee !== undefined ? String(parsed.fee) : "",
      basis: parsed.basis,
    }));
  }, [text, mode, open, accounts, assets, defaultAccount]);

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

    const existing = assets.find((a) => a.symbol.toUpperCase() === symbol);
    if (existing) return existing.id;

    const entry = catalogHit ?? lookupCatalog(symbol);
    const asset: Asset = entry
      ? {
          id: newId(),
          symbol: entry.symbol,
          name: entry.name,
          kind: entry.kind,
          currency: entry.currency,
          source: entry.source,
          sourceSymbol: entry.sourceSymbol,
          precision: entry.precision,
        }
      : {
          id: newId(),
          symbol,
          name: symbol,
          kind: "stock",
          currency: draft.currency,
          // Sin catalogo apostamos a Yahoo, que es el que mas cobertura tiene.
          source: "yahoo",
          sourceSymbol: symbol,
          precision: 6,
        };
    await saveAsset(asset);
    return asset.id;
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
        raw: mode === "quick" && text.trim() ? text.trim() : editing?.raw,
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

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={editing ? "Editar movimiento" : "Nuevo movimiento"}
      footer={
        <div className="flex gap-2">
          <button className="btn btn-ghost flex-1" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn btn-primary flex-[2]" disabled={!canSave || saving} onClick={handleSave}>
            {saving ? "Guardando…" : editing ? "Guardar cambios" : "Agregar"}
          </button>
        </div>
      }
    >
      {!editing && (
        <div className="mb-4">
          <Segmented
            value={mode}
            onChange={(v) => setMode(v)}
            options={[
              { value: "quick", label: "Escribir" },
              { value: "form", label: "Formulario" },
            ]}
          />
        </div>
      )}

      {mode === "quick" && !editing && (
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
      )}

      {/* Lectura de lo entendido: siempre visible, siempre editable. */}
      {(text.trim() || mode === "form" || editing) && (
        <div className="card mb-4 p-3">
          <div className="eyebrow mb-1.5">Se va a guardar</div>
          <p className="text-[13px] leading-snug">{summary}</p>
          {warnings.length > 0 && (
            <ul className="mt-2 space-y-1">
              {warnings.map((w) => (
                <li key={w} className="flex items-start gap-1.5 text-[11px]" style={{ color: "var(--color-warn)" }}>
                  <IconWarning size={13} className="mt-px shrink-0" />
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {(mode === "form" || text.trim() || editing) && (
        <div className="space-y-3">
          <Field label="Tipo">
            <select
              className="input"
              value={draft.type}
              onChange={(e) => set({ type: e.target.value as TxType })}
            >
              {TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>

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
            <Field label={draft.type === "transfer" ? "Desde" : "Cuenta"}>
              <select
                className="input"
                value={draft.accountId}
                onChange={(e) => set({ accountId: e.target.value })}
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {draft.type === "transfer" && (
            <Field label="Hacia">
              <select
                className="input"
                value={draft.counterAccountId}
                onChange={(e) => set({ counterAccountId: e.target.value })}
              >
                <option value="">Elegí una cuenta…</option>
                {accounts
                  .filter((a) => a.id !== draft.accountId)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
              </select>
            </Field>
          )}

          {needsAsset && (
            <Field label="Activo" hint={catalogHit ? `Reconocido: ${catalogHit.name}` : undefined}>
              <input
                className="input"
                value={draft.symbol}
                placeholder="QQQ, BTC, GGAL…"
                autoCapitalize="characters"
                onChange={(e) => {
                  const value = e.target.value;
                  const match = assets.find((a) => a.symbol.toUpperCase() === value.toUpperCase());
                  setCatalogHit(lookupCatalog(value) ?? null);
                  set({ symbol: value, assetId: match?.id ?? "" });
                }}
              />
              {suggestions.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
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
            </Field>
          )}

          {isTrade && (
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
                <Field
                  label={draft.basis === "amount" ? "Monto invertido" : "Unidades"}
                >
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
          )}

          {!isTrade && (
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
            <Field label="Comisión">
              <input
                className="input num"
                inputMode="decimal"
                value={draft.feeText}
                onChange={(e) => set({ feeText: e.target.value })}
                placeholder="0"
              />
            </Field>
          </div>

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

          {settings.baseCurrency === "USD" && draft.currency === "ARS" && (
            <p className="text-[11px]" style={{ color: "var(--color-ink-3)" }}>
              Todo se muestra en dólares. Los pesos se convierten al MEP de cada fecha.
            </p>
          )}
        </div>
      )}

      {error && (
        <p className="mt-3 text-[12px] neg">{error}</p>
      )}
    </Sheet>
  );
}
