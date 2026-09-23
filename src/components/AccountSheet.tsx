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
        <div className="num text-[26px] leading-none">{money(account.valueUsd, "USD")}</div>
        <div className="mt-1.5 flex items-baseline gap-2">
          <span className={`num text-[13px] ${account.pnlUsd >= 0 ? "pos" : "neg"}`}>
            {money(account.pnlUsd, "USD", { sign: true })}
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
          ["Invertido", money(account.investedUsd, "USD"), false],
          // Un efectivo negativo es plata que se gastó sin haber entrado:
          // no rompe los totales, pero significa que falta un movimiento.
          ["Efectivo", money(account.cashUsd, "USD"), account.cashUsd < -0.01],
          ["Capital aportado", money(account.netContributedUsd, "USD"), false],
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
        <>
          <div className="eyebrow mb-2">Posiciones ({held.length})</div>
          <div className="card divide-hairline mb-4">
            {held.map((pos) => {
              const qty = pos.accounts.find((a) => a.accountId === account.accountId)?.quantity ?? 0;
              const share = pos.quantity > 0 ? qty / pos.quantity : 0;
              return (
                <div key={pos.assetId} className="flex items-center gap-2 p-3">
                  <span className="min-w-0 flex-1 truncate text-[13px]">{pos.symbol}</span>
                  <span className="label shrink-0">{fmtQty(qty, 4)}</span>
                  <span className="num shrink-0 text-[13px]">
                    {money(pos.valueUsd * share, "USD", { compact: true })}
                  </span>
                </div>
              );
            })}
          </div>
        </>
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
