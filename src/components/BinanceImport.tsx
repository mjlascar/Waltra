"use client";

import { useMemo, useRef, useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { Field } from "@/components/ui/Field";
import { IconWarning } from "@/components/icons";
import { newId, useStore } from "@/lib/store";
import {
  binanceAsset,
  parseBinanceOrders,
  sortOrders,
  type BinanceImport as Parsed,
} from "@/lib/parse/binance";
import { findAssetBySymbol } from "@/lib/assets";
import { money, quantity as fmtQty, shortDate } from "@/lib/format";
import { txColor } from "@/lib/tx-style";
import type { Asset, Transaction } from "@/lib/types";

/** Cuántas órdenes se listan antes de plegar el resto. */
const VISTA = 12;

/**
 * Id del ingreso que cierra el efectivo de la cuenta.
 *
 * Es fijo a proposito: reimportar el archivo con tres meses mas lo reemplaza
 * por el nuevo en vez de dejar dos ingresos sumados.
 */
const CAPITAL_ID = "binance-capital-importado";

/**
 * Importar el historial de órdenes de Binance.
 *
 * La exportacion trae las operaciones pero no los ingresos de dinero, asi que
 * la pantalla dice cuanto capital hace falta para que el efectivo cierre y
 * ofrece anotarlo en un solo movimiento. Es la unica forma de que el "capital
 * aportado" no quede en cero con dos anios de compras cargadas.
 */
export function BinanceImport({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { accounts, assets, db, refresh } = useStore();
  const fileRef = useRef<HTMLInputElement>(null);

  const cuentaBinance = useMemo(
    () => accounts.find((a) => a.broker === "binance") ?? accounts[0],
    [accounts],
  );

  const [nombre, setNombre] = useState<string | null>(null);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [accountId, setAccountId] = useState("");
  const [conCapital, setConCapital] = useState(true);
  const [capital, setCapital] = useState("");
  const [capitalDay, setCapitalDay] = useState("");
  const [todas, setTodas] = useState(false);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ordenes = useMemo(() => (parsed?.ok ? sortOrders(parsed.rows) : []), [parsed]);
  const errores = parsed?.rows.filter((r) => r.error) ?? [];
  const cuenta = accountId || cuentaBinance?.id || "";
  const montoCapital = Number(capital.replace(",", "."));

  function reset() {
    setParsed(null);
    setNombre(null);
    setTodas(false);
    setError(null);
  }

  async function leer(file: File) {
    setError(null);
    setTodas(false);
    setNombre(file.name);
    try {
      const resultado = parseBinanceOrders(await file.text());
      setParsed(resultado);
      setAccountId(cuentaBinance?.id ?? "");
      // El neto de las ordenes es la propuesta, pero el monto y la fecha
      // quedan editables: si deposito mas y le sobro saldo, lo corrige.
      setCapital(resultado.resumen.netoUsd > 0 ? resultado.resumen.netoUsd.toFixed(2) : "");
      setCapitalDay(resultado.resumen.primerDia ?? "");
      setConCapital(resultado.resumen.netoUsd > 0);
    } catch (err) {
      setParsed(null);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function save() {
    if (!db || saving || ordenes.length === 0 || !cuenta) return;
    setSaving(true);
    setError(null);
    try {
      const nuevos: Asset[] = [];
      const porSimbolo = new Map<string, string>();
      for (const asset of assets) porSimbolo.set(asset.symbol.toUpperCase(), asset.id);

      const txs: Transaction[] = [];
      const now = new Date().toISOString();
      const base = Date.parse(now);
      let seq = 0;

      if (conCapital && Number.isFinite(montoCapital) && montoCapital > 0 && capitalDay) {
        txs.push({
          id: CAPITAL_ID,
          date: capitalDay,
          type: "deposit",
          accountId: cuenta,
          amount: montoCapital,
          currency: "USD",
          note: "Capital estimado a partir de las órdenes importadas",
          // Antes que cualquier compra: si el ingreso quedara despues, el
          // efectivo de la cuenta pasaria por negativo todo el periodo.
          createdAt: new Date(base).toISOString(),
          updatedAt: now,
        });
        seq = 1;
      }

      for (const orden of ordenes) {
        seq += 1;
        let assetId = porSimbolo.get(orden.symbol);
        if (!assetId) {
          const existente = findAssetBySymbol(assets, orden.symbol);
          if (existente) {
            assetId = existente.id;
          } else {
            const asset = binanceAsset(orden.symbol, newId());
            nuevos.push(asset);
            assetId = asset.id;
          }
          porSimbolo.set(orden.symbol, assetId);
        }

        txs.push({
          id: orden.id,
          date: orden.day,
          type: orden.type,
          accountId: cuenta,
          assetId,
          quantity: orden.quantity,
          price: orden.price,
          amount: orden.amount,
          currency: "USD",
          note: `Binance ${orden.symbol}/${orden.quote}`,
          // El orden de carga desempata los movimientos del mismo dia.
          createdAt: new Date(base + seq).toISOString(),
          updatedAt: now,
        });
      }

      await db.transaction("rw", [db.assets, db.transactions], async () => {
        if (nuevos.length) await db.assets.bulkPut(nuevos);
        await db.transactions.bulkPut(txs);
      });

      setDone(txs.length);
      reset();
      void refresh({ force: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const resumen = parsed?.resumen;
  const listadas = todas ? ordenes : ordenes.slice(0, VISTA);

  return (
    <Sheet
      open={open}
      onClose={() => {
        setDone(null);
        reset();
        onClose();
      }}
      title="Importar de Binance"
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
              disabled={ordenes.length === 0 || saving || !cuenta}
              onClick={save}
            >
              {saving
                ? "Guardando…"
                : ordenes.length > 0
                  ? `Importar ${ordenes.length}`
                  : "Importar"}
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
            Se están descargando los precios históricos. El resumen va a reflejarlos
            en un momento.
          </p>
        </div>
      ) : (
        <>
          <p className="label mb-3 leading-relaxed">
            En Binance: <strong style={{ color: "var(--color-ink)" }}>Órdenes → Historial
            de órdenes spot → Exportar</strong>. Te llega un zip por mail o a Descargas;
            descomprimilo y elegí el CSV que hay adentro.
          </p>

          <button className="btn w-full" onClick={() => fileRef.current?.click()}>
            {nombre ? "Elegir otro archivo" : "Elegir el archivo"}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="text/csv,.csv"
            className="hidden"
            data-testid="binance-file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void leer(file);
              e.target.value = "";
            }}
          />
          {nombre && (
            <p className="label num mt-2 truncate" title={nombre}>
              {nombre}
            </p>
          )}

          {parsed && !parsed.ok && (
            <div
              className="card mt-3 flex items-start gap-2 p-3 text-[12px] leading-snug"
              style={{ color: "var(--color-warn)", borderColor: "var(--color-warn)" }}
            >
              <IconWarning size={14} />
              <span>{parsed.problema}</span>
            </div>
          )}

          {parsed?.ok && resumen && (
            <>
              <div className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="num text-[13px]">
                  {resumen.listos} {resumen.listos === 1 ? "orden" : "órdenes"} ejecutadas
                </span>
                {resumen.omitidos > 0 && (
                  <span className="label">{resumen.omitidos} sin ejecutar</span>
                )}
                {resumen.errores > 0 && (
                  <span className="num text-[12px]" style={{ color: "var(--color-warn)" }}>
                    {resumen.errores} sin leer
                  </span>
                )}
                {resumen.primerDia && (
                  <span className="label">
                    {shortDate(resumen.primerDia, true)} — {shortDate(resumen.ultimoDia!, true)}
                  </span>
                )}
              </div>

              {resumen.simbolos.length > 0 && (
                <p className="label num mt-1 leading-snug">
                  {resumen.simbolos.length} activos: {resumen.simbolos.join(", ")}
                </p>
              )}

              <div
                className="card mt-3 flex items-start gap-2 p-3 text-[12px] leading-snug"
                style={{ color: "var(--color-warn)", borderColor: "var(--color-warn)" }}
              >
                <IconWarning size={14} className="shrink-0" />
                <span>
                  Esta exportación trae las operaciones, no los ingresos ni los retiros
                  de dinero, y tampoco las comisiones. Cargá los ingresos aparte o el
                  efectivo de la cuenta va a quedar en negativo.
                </span>
              </div>

              {accounts.length > 1 && (
                <div className="mt-3">
                  <Field label="Cuenta">
                    <select
                      className="input"
                      value={cuenta}
                      onChange={(e) => setAccountId(e.target.value)}
                    >
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              )}

              {resumen.netoUsd > 0 && (
                <div className="card mt-3 p-3">
                  <label className="flex items-start gap-2.5">
                    <input
                      type="checkbox"
                      className="check mt-0.5"
                      checked={conCapital}
                      onChange={(e) => setConCapital(e.target.checked)}
                    />
                    <span className="text-[13px] leading-snug">
                      Anotar también el capital que entró
                      <span className="label mt-1 block leading-snug">
                        Las órdenes consumieron{" "}
                        <span className="num">{money(resumen.netoUsd, "USD")}</span> netos.
                        Si depositaste más y te quedó saldo sin invertir, corregí el monto.
                      </span>
                    </span>
                  </label>
                  {conCapital && (
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <Field label="Monto">
                        <input
                          className="input num"
                          type="text"
                          inputMode="decimal"
                          value={capital}
                          onChange={(e) => setCapital(e.target.value)}
                        />
                      </Field>
                      <Field label="Fecha">
                        <input
                          className="input"
                          type="date"
                          value={capitalDay}
                          onChange={(e) => setCapitalDay(e.target.value)}
                        />
                      </Field>
                    </div>
                  )}
                </div>
              )}

              {errores.length > 0 && (
                <>
                  <div className="eyebrow mb-2 mt-4">Lo que no pude leer</div>
                  <ul className="card divide-hairline">
                    {errores.map((row) => (
                      <li key={row.index} className="p-2.5">
                        <div
                          className="flex items-center gap-1 text-[11px]"
                          style={{ color: "var(--color-warn)" }}
                        >
                          <IconWarning size={12} />
                          Fila {row.index}: {row.error}
                        </div>
                        <div className="num mt-0.5 truncate text-[11px]" style={{ color: "var(--color-ink-3)" }}>
                          {row.raw}
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {ordenes.length > 0 && (
                <>
                  <div className="eyebrow mb-2 mt-4">Lo que voy a cargar</div>
                  <ul className="card divide-hairline">
                    {listadas.map((orden) => (
                      <li key={orden.id} className="flex items-baseline gap-2 p-2.5">
                        <span
                          className="chip shrink-0"
                          style={{ color: txColor(orden.type), borderColor: txColor(orden.type) }}
                        >
                          {orden.type === "buy" ? "Compra" : "Venta"}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline gap-1.5">
                            <span className="truncate text-[13px]">{orden.symbol}</span>
                            <span className="num ml-auto shrink-0 text-[12px]">
                              {money(orden.amount, "USD")}
                            </span>
                          </div>
                          <div className="label num mt-0.5 truncate">
                            {shortDate(orden.day, true)} · {fmtQty(orden.quantity, 6)} @{" "}
                            {money(orden.price, "USD")}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                  {ordenes.length > listadas.length && (
                    <button className="btn btn-sm mt-2 w-full" onClick={() => setTodas(true)}>
                      Ver las {ordenes.length - listadas.length} restantes
                    </button>
                  )}
                  <p className="label mt-2 leading-snug">
                    Cada orden se guarda con su número de Binance: si exportás de nuevo
                    más adelante, las que ya están se reemplazan y no se duplican.
                  </p>
                </>
              )}
            </>
          )}

          {error && <p className="mt-3 text-[12px] neg">{error}</p>}
        </>
      )}
    </Sheet>
  );
}
