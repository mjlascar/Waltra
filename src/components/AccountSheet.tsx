"use client";

import { useMemo, useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { Field, Segmented } from "@/components/ui/Field";
import { IconWarning } from "@/components/icons";
import { newId, useStore } from "@/lib/store";
import { parseLooseNumber } from "@/lib/parse/number";
import { money, percent, quantity as fmtQty } from "@/lib/format";
import { today } from "@/lib/date";
import type { AccountView } from "@/lib/engine/portfolio";
import type { Currency, Transaction } from "@/lib/types";

/**
 * Detalle de una cuenta, con la reconciliacion de saldo.
 *
 * Tarde o temprano el numero de la app y el del broker no van a coincidir: una
 * comision que no cargaste, el interes diario de una cuenta remunerada, un
 * redondeo. En vez de dejar que la diferencia se arrastre para siempre, se
 * carga un ajuste explicito y queda anotado como tal.
 */
export function AccountSheet({
  account,
  onClose,
}: {
  account: AccountView | null;
  onClose: () => void;
}) {
  const { portfolio, accounts, saveTransaction } = useStore();
  const display = portfolio.base;
  const [realText, setRealText] = useState("");
  const [currency, setCurrency] = useState<Currency>("USD");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const held = useMemo(
    () =>
      account
        ? portfolio.positions.filter((pos) =>
            pos.accounts.some((a) => a.accountId === account.accountId),
          )
        : [],
    [portfolio.positions, account],
  );

  if (!account) return null;

  const config = accounts.find((a) => a.id === account.accountId);
  const efectivoActual = account.cash[currency] ?? 0;
  const real = parseLooseNumber(realText);
  const diferencia = real === null ? null : real - efectivoActual;
  const puedeAjustar = diferencia !== null && Math.abs(diferencia) > 0.009;

  async function ajustar() {
    if (!account || diferencia === null || !puedeAjustar || saving) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const tx: Transaction = {
        id: newId(),
        date: today(),
        // Un ajuste positivo entra como renta y uno negativo como costo: las
        // dos cuentan como resultado y ninguna como capital nuevo, que es
        // exactamente lo que corresponde.
        type: diferencia > 0 ? "interest" : "fee",
        accountId: account.accountId,
        amount: Math.abs(diferencia),
        currency,
        note: "ajuste de saldo",
        createdAt: now,
        updatedAt: now,
      };
      await saveTransaction(tx);
      setRealText("");
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open onClose={onClose} title={account.name}>
      <div className="mb-4">
        <div className="eyebrow mb-1.5">Valor de la cuenta</div>
        <div className="num text-[26px] leading-none">{money(account.valueUsd, display)}</div>
        <div className="mt-1.5 flex items-baseline gap-2">
          <span className={`num text-[13px] ${account.pnlUsd >= 0 ? "pos" : "neg"}`}>
            {money(account.pnlUsd, display, { sign: true })}
          </span>
          {account.pnlPct !== null && (
            <span className={`num text-[12px] ${account.pnlUsd >= 0 ? "pos" : "neg"}`}>
              {percent(account.pnlPct, { decimals: 1 })}
            </span>
          )}
          <span className="label">sobre el capital aportado acá</span>
        </div>
      </div>

      <div className="card mb-4 grid grid-cols-2" style={{ gap: 1, background: "var(--color-line)" }}>
        {[
          ["Invertido", money(account.investedUsd, display), false],
          // Un efectivo negativo es plata que se gastó sin haber entrado:
          // no rompe los totales, pero significa que falta un movimiento.
          ["Efectivo", money(account.cashUsd, display), account.cashUsd < -0.01],
          ["Capital aportado", money(account.netContributedUsd, display), false],
          ["Peso en la cartera", percent(account.weight, { decimals: 0, sign: false }), false],
        ].map(([label, value, alerta]) => (
          <div key={String(label)} style={{ background: "var(--color-surface)" }} className="p-3">
            <div className="eyebrow mb-1.5">{label}</div>
            <div className="num text-[13px]" style={alerta ? { color: "var(--color-warn)" } : undefined}>
              {value}
            </div>
          </div>
        ))}
      </div>

      {account.cashUsd < -0.01 && (
        <div
          className="card mb-4 flex items-start gap-2 p-3 text-[12px] leading-snug"
          style={{ color: "var(--color-warn)", borderColor: "var(--color-warn)" }}
        >
          <IconWarning size={14} className="shrink-0" />
          <span>
            El efectivo quedó en negativo: hay compras por más plata de la que figura
            ingresada acá. La ganancia no se infla por esto, pero falta cargar un
            ingreso o una transferencia desde otra cuenta.
          </span>
        </div>
      )}

      {held.length > 0 && (
        <Posiciones
          held={held}
          accountId={account.accountId}
          broker={config?.name ?? "tu broker"}
        />
      )}

      <div className="eyebrow mb-2">Ajustar el efectivo</div>
      <div className="card p-3">
        <p className="label mb-3 leading-relaxed">
          Si el efectivo que muestra {config?.name ?? "el broker"} no coincide con el
          de la app, ingresá el saldo real y la diferencia se registra como un
          ajuste explícito. Queda asentado como tal.
        </p>

        <div className="mb-3">
          <Segmented
            value={currency}
            onChange={(v) => {
              setCurrency(v);
              setSaved(false);
            }}
            options={[
              { value: "USD", label: "USD" },
              { value: "ARS", label: "ARS" },
            ]}
          />
        </div>

        <div className="mb-3 flex items-baseline justify-between">
          <span className="label">Según Waltra</span>
          <span className="num text-[13px]">{money(efectivoActual, currency)}</span>
        </div>

        <Field label={`Efectivo real en ${currency}`}>
          <input
            className="input num"
            inputMode="decimal"
            value={realText}
            onChange={(e) => {
              setRealText(e.target.value);
              setSaved(false);
            }}
            placeholder={String(Math.round(efectivoActual))}
          />
        </Field>

        {diferencia !== null && (
          <p className="mt-2 text-[12px]">
            Diferencia:{" "}
            <span className={`num ${diferencia >= 0 ? "pos" : "neg"}`}>
              {money(diferencia, currency, { sign: true })}
            </span>
            {puedeAjustar && (
              <span className="label">
                {" "}
                — se registra como {diferencia > 0 ? "interés" : "comisión"}, que
                cuenta como resultado y no como capital nuevo.
              </span>
            )}
          </p>
        )}

        <button
          className="btn btn-sm mt-3 w-full"
          disabled={!puedeAjustar || saving}
          onClick={ajustar}
        >
          {saving ? "Registrando…" : "Registrar el ajuste"}
        </button>

        {saved && (
          <p className="label mt-2 pos">Ajuste registrado. El saldo ya coincide.</p>
        )}
      </div>
    </Sheet>
  );
}

/**
 * Las posiciones de la cuenta, con la conciliacion de unidades.
 *
 * La exportacion de Binance no trae lo que rinde Earn ni las comisiones que se
 * cobran en el activo, y un Convert tampoco aparece: las unidades de la app y
 * las del broker se separan de a poco. En vez de inventar movimientos que no
 * se sabe cuando fueron, se anota la diferencia de hoy como un ajuste: de mas
 * entra como ingreso a su precio, de menos sale a su costo como comision.
 */
function Posiciones({
  held,
  accountId,
  broker,
}: {
  held: ReturnType<typeof useStore>["portfolio"]["positions"];
  accountId: string;
  broker: string;
}) {
  const { saveTransaction, portfolio } = useStore();
  const display = portfolio.base;
  const [corrigiendo, setCorrigiendo] = useState(false);
  const [reales, setReales] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [hechos, setHechos] = useState<number | null>(null);

  const filas = held.map((pos) => {
    const qty = pos.accounts.find((a) => a.accountId === accountId)?.quantity ?? 0;
    const share = pos.quantity > 0 ? qty / pos.quantity : 0;
    const real = reales[pos.assetId] !== undefined ? parseLooseNumber(reales[pos.assetId]) : null;
    const delta = real === null ? null : real - qty;
    // Una millonesima de la tenencia es redondeo, no una diferencia.
    const minimo = Math.max(1e-8, Math.abs(qty) * 1e-6);
    const precio = pos.price ?? pos.avgCost;
    return {
      pos,
      qty,
      valueUsd: pos.valueUsd * share,
      delta: delta !== null && Math.abs(delta) >= minimo ? delta : null,
      deltaUsd: delta !== null && pos.priceUsd !== null ? delta * pos.priceUsd : null,
      precio,
    };
  });
  const cambios = filas.filter((f) => f.delta !== null);

  async function registrar() {
    if (saving || cambios.length === 0) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      for (const f of cambios) {
        await saveTransaction({
          id: newId(),
          date: today(),
          type: "adjust",
          accountId,
          assetId: f.pos.assetId,
          quantity: f.delta!,
          // El valor de las unidades hoy, en la moneda del activo: es el
          // ingreso si sobran; si faltan, el ledger usa su costo.
          amount: Math.abs(f.delta!) * f.precio,
          price: f.precio,
          currency: f.pos.currency,
          note: `conciliado con ${broker}`,
          createdAt: now,
          updatedAt: now,
        });
      }
      setHechos(cambios.length);
      setReales({});
      setCorrigiendo(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="eyebrow">Posiciones ({held.length})</span>
        <button
          className="label underline"
          onClick={() => {
            setCorrigiendo((v) => !v);
            setHechos(null);
          }}
        >
          {corrigiendo ? "Cancelar" : `Corregir con ${broker}`}
        </button>
      </div>
      {corrigiendo && (
        <p className="label mb-2 leading-relaxed">
          Escribí las unidades que ves en {broker}; dejá vacío lo que coincide. Lo que sobra
          (Earn, staking) entra como ingreso a su precio de hoy; lo que falta (comisiones
          cobradas en el activo) sale a su costo, como una comisión. Si lo que falta lo
          mandaste a otra billetera, eso es un retiro: cargalo como retiro.
        </p>
      )}
      <div className="card divide-hairline mb-2">
        {filas.map((f) => (
          <div key={f.pos.assetId} className="p-3">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[13px]">{f.pos.symbol}</span>
              <span className="label shrink-0">{fmtQty(f.qty, 8)}</span>
              {!corrigiendo && (
                <span className="num shrink-0 text-[13px]">
                  {money(f.valueUsd, display, { compact: true })}
                </span>
              )}
              {corrigiendo && (
                <input
                  className="input num w-[112px] shrink-0 py-1 text-[13px]"
                  inputMode="decimal"
                  aria-label={`Unidades de ${f.pos.symbol} en ${broker}`}
                  value={reales[f.pos.assetId] ?? ""}
                  placeholder="igual"
                  onChange={(e) => setReales((r) => ({ ...r, [f.pos.assetId]: e.target.value }))}
                />
              )}
            </div>
            {corrigiendo && f.delta !== null && (
              <p className={`num mt-1 text-right text-[11px] ${f.delta > 0 ? "pos" : "neg"}`}>
                {f.delta > 0 ? "+" : "−"}
                {fmtQty(Math.abs(f.delta), 8)}
                {f.deltaUsd !== null && ` · ${money(f.deltaUsd, display, { sign: true })}`}
                {f.delta > 0 ? " · ingreso" : " · comisión"}
              </p>
            )}
          </div>
        ))}
      </div>
      {corrigiendo && (
        <button
          className="btn btn-sm mb-4 w-full"
          disabled={cambios.length === 0 || saving}
          onClick={() => void registrar()}
        >
          {saving
            ? "Registrando…"
            : cambios.length === 0
              ? "Sin diferencias"
              : `Registrar ${cambios.length} ${cambios.length === 1 ? "ajuste" : "ajustes"}`}
        </button>
      )}
      {hechos !== null && (
        <p className="label pos mb-4">
          {hechos === 1 ? "Ajuste registrado" : `${hechos} ajustes registrados`}. Las unidades ya
          coinciden con {broker}.
        </p>
      )}
      {!corrigiendo && hechos === null && <div className="mb-2" />}
    </>
  );
}
