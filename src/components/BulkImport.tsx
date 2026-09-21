"use client";

import { useMemo, useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { Field } from "@/components/ui/Field";
import { IconWarning } from "@/components/icons";
import { newId, useStore } from "@/lib/store";
import { parseBulk, summarize, type BulkRow } from "@/lib/parse/bulk";
import { assetFromSymbol, findAssetBySymbol, lastUsedAccountId } from "@/lib/assets";
import { money, quantity as fmtQty, shortDate, TX_SHORT } from "@/lib/format";
import { today } from "@/lib/date";
import type { Asset, Transaction } from "@/lib/types";

const EJEMPLO = `12/03/2025 pasé 500 dólares a cocos
13/03/2025 compré 300 de QQQ a 430
20/04/2025 pasé 200 a binance
21/04/2025 compré 0,002 BTC a 84000
15/06/2025 vendí 0,3 QQQ a 470`;

/**
 * Importar un bloc de notas entero.
 *
 * Es la puerta de entrada real para alguien que ya venia anotando sus
 * movimientos a mano: en vez de recargar dos anios de a uno, pega el archivo
 * completo, revisa fila por fila lo que la app entendio, saca lo que no va y
 * guarda todo junto.
 */
export function BulkImport({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { accounts, assets, transactions, db, refresh } = useStore();
  const [text, setText] = useState("");
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [fallbackDate, setFallbackDate] = useState(today());
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const defaultAccount = useMemo(
    () => lastUsedAccountId(transactions, accounts),
    [transactions, accounts],
  );

  const rows = useMemo(
    () =>
      parseBulk(text, { accounts, assets, defaultAccountId: defaultAccount }).map((row) => ({
        ...row,
        include: row.include && !excluded.has(row.index),
      })),
    [text, accounts, assets, defaultAccount, excluded],
  );

  const stats = useMemo(() => summarize(rows), [rows]);

  function toggle(row: BulkRow) {
    if (row.blockers.length > 0) return;
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(row.index)) next.delete(row.index);
      else next.add(row.index);
      return next;
    });
  }

  async function save() {
    if (!db || saving || stats.listos === 0) return;
    setSaving(true);
    setError(null);
    try {
      const nuevos: Asset[] = [];
      const porSimbolo = new Map<string, string>();
      for (const asset of assets) porSimbolo.set(asset.symbol.toUpperCase(), asset.id);

      const txs: Transaction[] = [];
      const now = new Date().toISOString();
      let seq = 0;

      for (const row of rows) {
        if (!row.include || !row.entry) continue;
        const entry = row.entry;
        seq += 1;

        let assetId: string | undefined;
        if (entry.symbol) {
          const key = entry.symbol.toUpperCase();
          assetId = porSimbolo.get(key);
          if (!assetId) {
            const existente = findAssetBySymbol(assets, key);
            if (existente) {
              assetId = existente.id;
            } else {
              const asset = assetFromSymbol(key, newId(), {
                catalog: entry.catalog,
                currency: entry.currency,
              });
              nuevos.push(asset);
              assetId = asset.id;
            }
            porSimbolo.set(key, assetId);
          }
        }

        const isTrade = entry.type === "buy" || entry.type === "sell";
        const amount = entry.amount ?? 0;
        if (amount <= 0) continue;

        txs.push({
          id: newId(),
          // Las lineas sin fecha propia van todas a la fecha de respaldo que
          // el usuario elige arriba, en vez de caer en "hoy" sin avisar.
          date: entry.dateExplicit ? entry.day : fallbackDate,
          type: entry.type,
          accountId: entry.accountId ?? defaultAccount,
          counterAccountId: entry.counterAccountId,
          assetId,
          quantity: isTrade ? entry.quantity : undefined,
          price: isTrade ? entry.price : undefined,
          amount,
          currency: entry.currency,
          fee: entry.fee,
          raw: entry.raw,
          // El orden de carga define el desempate cuando dos movimientos caen
          // el mismo dia: respetamos el orden del archivo.
          createdAt: new Date(Date.parse(now) + seq).toISOString(),
          updatedAt: now,
        });
      }

      await db.transaction("rw", [db.assets, db.transactions], async () => {
        if (nuevos.length) await db.assets.bulkPut(nuevos);
        await db.transactions.bulkPut(txs);
      });

      setDone(txs.length);
      setText("");
      setExcluded(new Set());
      void refresh({ force: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const accountName = (id?: string) => accounts.find((a) => a.id === id)?.name ?? "—";

  return (
    <Sheet
      open={open}
      onClose={() => {
        setDone(null);
        onClose();
      }}
      title="Importar desde tus notas"
      footer={
        done !== null ? (
          <button
            className="btn btn-primary w-full"
            onClick={() => {
              setDone(null);
              onClose();
            }}
          >
            Listo
          </button>
        ) : (
          <div className="flex gap-2">
            <button className="btn btn-ghost flex-1" onClick={onClose}>
              Cancelar
            </button>
            <button
              className="btn btn-primary flex-[2]"
              disabled={stats.listos === 0 || saving}
              onClick={save}
            >
              {saving
                ? "Guardando…"
                : stats.listos > 0
                  ? `Agregar ${stats.listos}`
                  : "Agregar"}
            </button>
          </div>
        )
      }
    >
      {done !== null ? (
        <div className="py-6 text-center">
          <p className="text-[15px] font-medium">
            Se cargaron {done} {done === 1 ? "movimiento" : "movimientos"}.
          </p>
          <p className="label mt-2 leading-relaxed">
            Los precios históricos se están trayendo ahora. Revisá el resumen en un
            momento.
          </p>
        </div>
      ) : (
        <>
          <p className="label mb-3 leading-relaxed">
            Pegá tus anotaciones, una por línea. Las líneas vacías y las que empiezan
            con <code>#</code> se ignoran.
          </p>

          <Field label="Tus notas">
            <textarea
              className="input num"
              rows={7}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setExcluded(new Set());
              }}
              placeholder={EJEMPLO}
              style={{ fontSize: 12, lineHeight: 1.5 }}
            />
          </Field>

          {text.trim() === "" && (
            <button
              className="btn btn-sm mt-2 w-full"
              onClick={() => setText(EJEMPLO)}
            >
              Probar con un ejemplo
            </button>
          )}

          {rows.length > 0 && (
            <>
              <div className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="num text-[13px]">
                  {stats.listos} de {stats.total} listas
                </span>
                {stats.conProblemas > 0 && (
                  <span className="num text-[12px]" style={{ color: "var(--color-warn)" }}>
                    {stats.conProblemas} con problemas
                  </span>
                )}
                {stats.primerDia && (
                  <span className="label">
                    {shortDate(stats.primerDia, true)} — {shortDate(stats.ultimoDia!, true)}
                  </span>
                )}
              </div>

              {stats.sinFecha > 0 && (
                <div className="mt-3">
                  <Field
                    label={`Fecha para las ${stats.sinFecha} líneas sin fecha`}
                    hint="Si tus notas no traen fecha, todas esas van a esta."
                  >
                    <input
                      type="date"
                      className="input"
                      value={fallbackDate}
                      max={today()}
                      onChange={(e) => setFallbackDate(e.target.value)}
                    />
                  </Field>
                </div>
              )}

              <div className="eyebrow mb-2 mt-4">Lo que entendí</div>
              <ul className="card divide-hairline">
                {rows.map((row) => {
                  const entry = row.entry;
                  const bad = row.blockers.length > 0;
                  return (
                    <li key={row.index}>
                      <button
                        className="flex w-full items-start gap-2.5 p-2.5 text-left"
                        onClick={() => toggle(row)}
                        style={{ opacity: row.include ? 1 : 0.4 }}
                      >
                        <span className="num shrink-0 text-[10px] pt-1" style={{ color: "var(--color-ink-3)", width: 18 }}>
                          {row.index}
                        </span>
                        <div className="min-w-0 flex-1">
                          {entry && !bad ? (
                            <>
                              <div className="flex items-baseline gap-1.5">
                                <span className="chip shrink-0">{TX_SHORT[entry.type]}</span>
                                <span className="truncate text-[13px]">
                                  {entry.symbol ?? accountName(entry.accountId)}
                                </span>
                                <span className="num ml-auto shrink-0 text-[12px]">
                                  {money(entry.amount ?? 0, entry.currency, { compact: true })}
                                </span>
                              </div>
                              <div className="label mt-0.5 truncate">
                                {/* Fecha y cuenta primero: son lo que el
                                    usuario necesita verificar, y el detalle
                                    de precio ya se deduce del monto. */}
                                {[
                                  entry.dateExplicit ? shortDate(entry.day, true) : "sin fecha",
                                  accountName(entry.accountId),
                                  entry.quantity
                                    ? `${fmtQty(entry.quantity, 6)} @ ${money(entry.price ?? 0, entry.currency)}`
                                    : null,
                                ]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </div>
                            </>
                          ) : (
                            <>
                              <div className="num truncate text-[12px]" style={{ color: "var(--color-ink-2)" }}>
                                {row.raw}
                              </div>
                              <div
                                className="mt-0.5 flex items-center gap-1 text-[11px]"
                                style={{ color: "var(--color-warn)" }}
                              >
                                <IconWarning size={12} />
                                {row.blockers.join(" ")}
                              </div>
                            </>
                          )}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>

              <p className="label mt-2 leading-snug">
                Tocá una línea para sacarla o volver a incluirla. Las que tienen
                problemas no se guardan: arreglalas en el texto y volvé a pegar.
              </p>

              {transactions.length > 0 && (
                <p className="label mt-2 leading-snug">
                  Ya tenés {transactions.length} movimientos cargados. Esto se suma a
                  lo que hay; no reemplaza nada.
                </p>
              )}
            </>
          )}

          {error && <p className="mt-3 text-[12px] neg">{error}</p>}
        </>
      )}
    </Sheet>
  );
}
