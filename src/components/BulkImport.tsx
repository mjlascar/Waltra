"use client";

import { useMemo, useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { Field } from "@/components/ui/Field";
import { CapturasPanel } from "@/components/CapturasPanel";
import { IconWarning } from "@/components/icons";
import { newId, useStore } from "@/lib/store";
import { parseBulk, summarize, type BulkRow } from "@/lib/parse/bulk";
import { lastUsedAccountId } from "@/lib/assets";
import { resolveTradeAsset } from "@/lib/cedear";
import { shortDate, TX_SHORT } from "@/lib/format";
import { txColor } from "@/lib/tx-style";
import {
  aplicarEdicion,
  cambiar,
  edicionDe,
  esOperacion,
  TIPOS_EDITABLES,
  type Edicion,
} from "@/lib/parse/bulk-edit";
import { today } from "@/lib/date";
import type { Account, Asset, Transaction } from "@/lib/types";

// Desde Cocos, QQQ es el CEDEAR: los montos son los de 10 CEDEARs, no los de
// la accion de Nueva York.
const EJEMPLO = `12/03/2025 pasé 500 dólares a cocos
13/03/2025 compré 10 QQQ por 240 usd
20/04/2025 pasé 200 a binance
21/04/2025 compré 0,002 BTC a 84000
15/06/2025 vendí 3 QQQ por 78 usd`;

/**
 * Importar un bloc de notas entero.
 *
 * Es la puerta de entrada real para alguien que ya venia anotando sus
 * movimientos a mano: en vez de recargar dos anios de a uno, pega el archivo
 * completo, revisa fila por fila lo que la app entendio, saca lo que no va y
 * guarda todo junto.
 */
export function BulkImport({
  open,
  onClose,
  mode = "notas",
}: {
  open: boolean;
  onClose: () => void;
  /** "capturas": el texto lo llena la lectura de capturas de pantalla. */
  mode?: "notas" | "capturas";
}) {
  const { accounts, assets, transactions, db, refresh } = useStore();
  const [text, setText] = useState("");
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  /** Lo corregido en las casillas, por linea. Se descarta si cambia el texto. */
  const [ediciones, setEdiciones] = useState<Record<number, Edicion>>({});
  const [verTexto, setVerTexto] = useState(false);
  const [fallbackDate, setFallbackDate] = useState(today());
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ultimaCuenta = useMemo(
    () => lastUsedAccountId(transactions, accounts),
    [transactions, accounts],
  );
  // Las capturas casi siempre son de Cocos, que no tiene otra forma de sacar
  // los movimientos; igual se puede elegir otra cuenta.
  const [cuentaCapturas, setCuentaCapturas] = useState<string | null>(null);
  const cocos = accounts.find((a) => a.broker === "cocos" && !a.archived)?.id;
  const defaultAccount = mode === "capturas" ? (cuentaCapturas ?? cocos ?? ultimaCuenta) : ultimaCuenta;

  const leidas = useMemo(
    () => parseBulk(text, { accounts, assets, defaultAccountId: defaultAccount }),
    [text, accounts, assets, defaultAccount],
  );
  const rows = useMemo(
    () =>
      leidas.map((leida) => {
        const ed = ediciones[leida.index];
        const row = ed ? aplicarEdicion(leida, ed) : leida;
        return { ...row, include: row.include && !excluded.has(row.index) };
      }),
    [leidas, ediciones, excluded],
  );

  function nuevoTexto(t: string) {
    setText(t);
    setExcluded(new Set());
    setEdiciones({});
  }

  function editar(index: number, campo: keyof Edicion, valor: string) {
    const leida = leidas.find((r) => r.index === index);
    if (!leida) return;
    setEdiciones((prev) => {
      const actual = prev[index] ?? edicionDe(leida, fallbackDate, defaultAccount);
      return { ...prev, [index]: cambiar(actual, campo, valor) };
    });
  }

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

      const txs: Transaction[] = [];
      const now = new Date().toISOString();
      let seq = 0;

      for (const row of rows) {
        if (!row.include || !row.entry) continue;
        const entry = row.entry;
        seq += 1;

        let assetId: string | undefined;
        if (entry.symbol) {
          // La moneda y el broker son parte de la clave: "SPY" en pesos o desde
          // Cocos es el CEDEAR, y en dolares desde otro broker puede ser la
          // accion. Las dos pueden aparecer en el mismo pegado.
          const cuenta = entry.accountId ?? defaultAccount;
          const broker = accounts.find((a) => a.id === cuenta)?.broker;
          const key = `${entry.symbol.toUpperCase()}|${entry.currency}|${broker ?? ""}`;
          assetId = porSimbolo.get(key);
          if (!assetId) {
            const { asset, nuevo } = resolveTradeAsset(
              [...assets, ...nuevos],
              entry.symbol,
              entry.currency,
              newId,
              { catalog: entry.catalog, broker },
            );
            if (nuevo) nuevos.push(asset);
            assetId = asset.id;
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
          // Un cambio de moneda guarda lo que entro y el dolar al que se hizo.
          toAmount: entry.type === "exchange" ? entry.toAmount : undefined,
          toCurrency: entry.type === "exchange" ? entry.toCurrency : undefined,
          fxRate: entry.type === "exchange" ? entry.rate : undefined,
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
      nuevoTexto("");
      void refresh({ force: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={() => {
        setDone(null);
        onClose();
      }}
      title={mode === "capturas" ? "Cargar desde capturas" : "Importar desde tus notas"}
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
            Se están descargando los precios históricos. El resumen va a reflejarlos
            en un momento.
          </p>
        </div>
      ) : (
        <>
          {mode === "capturas" ? (
            <>
              <p className="label mb-3 leading-relaxed">
                Capturas de la actividad de tu broker. Abajo revisás qué se leyó antes de
                guardar; las líneas con <code>#</code> no se cargan.
              </p>
              <CapturasPanel
                accountId={defaultAccount}
                onAccountChange={setCuentaCapturas}
                onText={(leido) => {
                  // Se agrega abajo sin tocar las lineas de antes: lo que ya se
                  // corrigio en las casillas sigue en su lugar.
                  setText((prev) => (prev.trim() ? `${prev.replace(/\s+$/, "")}\n${leido}` : leido));
                }}
              />
            </>
          ) : (
            <p className="label mb-3 leading-relaxed">
              Pegá tus anotaciones, una por línea. Las líneas vacías y las que empiezan
              con <code>#</code> se omiten.
            </p>
          )}

          {/* En capturas el texto es un paso intermedio: se revisa en las
              casillas. Queda a mano para pegar la respuesta sin clave. */}
          {mode === "capturas" && rows.length > 0 && !verTexto ? (
            <button className="label underline" onClick={() => setVerTexto(true)}>
              Ver el texto leído
            </button>
          ) : (
            <Field label={mode === "capturas" ? "Lo que se leyó" : "Tus notas"}>
              <textarea
                className="input num"
                rows={mode === "capturas" ? 4 : 7}
                value={text}
                onChange={(e) => nuevoTexto(e.target.value)}
                placeholder={
                  mode === "capturas" ? "Acá aparecen los movimientos de las capturas." : EJEMPLO
                }
                style={{ fontSize: 12, lineHeight: 1.5 }}
              />
            </Field>
          )}

          {text.trim() === "" && mode === "notas" && (
            <button className="btn btn-sm mt-2 w-full" onClick={() => nuevoTexto(EJEMPLO)}>
              Probar con un ejemplo
            </button>
          )}

          {rows.length > 0 && (
            <>
              <div className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="num text-[13px]">
                  {stats.listos} de {stats.total} listos
                </span>
                {stats.conProblemas > 0 && (
                  <span className="num text-[12px]" style={{ color: "var(--color-warn)" }}>
                    {stats.conProblemas} para completar
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
                    hint="Las líneas sin fecha propia se registran en esta."
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

              <div className="eyebrow mb-2 mt-4">Revisá y corregí</div>
              <ul className="card divide-hairline">
                {rows.map((row) => {
                  const leida = leidas.find((r) => r.index === row.index)!;
                  const ed = ediciones[row.index] ?? edicionDe(leida, fallbackDate, defaultAccount);
                  return (
                    <FilaEditable
                      key={row.index}
                      row={row}
                      ed={ed}
                      sinLeer={!leida.entry && !ediciones[row.index]}
                      accounts={accounts.filter((a) => !a.archived)}
                      onChange={(campo, valor) => editar(row.index, campo, valor)}
                      onToggle={() => toggle(row)}
                    />
                  );
                })}
              </ul>

              <p className="label mt-2 leading-snug">
                Cada casilla se puede corregir. Destildá un movimiento para no cargarlo; los que
                tienen algo en amarillo se cargan cuando lo completes.
              </p>

              {transactions.length > 0 && (
                <p className="label mt-2 leading-snug">
                  Ya hay {transactions.length} movimientos cargados. Esta importación
                  se suma a los existentes; no reemplaza nada.
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

/**
 * Un movimiento de la revision, con cada dato en su casilla: tipo, fecha,
 * cuenta, activo, cantidad, precio, total y moneda. Corregir un numero no
 * pide reescribir una frase.
 */
function FilaEditable({
  row,
  ed,
  sinLeer,
  accounts,
  onChange,
  onToggle,
}: {
  row: BulkRow;
  ed: Edicion;
  /** La linea no se pudo leer y todavia no se toco: se muestra lo que decia. */
  sinLeer: boolean;
  accounts: Account[];
  onChange: (campo: keyof Edicion, valor: string) => void;
  onToggle: () => void;
}) {
  const bad = row.blockers.length > 0;
  const trade = esOperacion(ed.type);
  const color = txColor(ed.type);
  const num = (campo: keyof Edicion, etiqueta: string) => (
    <label className="min-w-0 flex-1">
      <span className="label block text-[10px]">{etiqueta}</span>
      <input
        className="input input-sm num w-full"
        inputMode="decimal"
        value={ed[campo]}
        onChange={(e) => onChange(campo, e.target.value)}
        aria-label={`${etiqueta}, línea ${row.index}`}
      />
    </label>
  );
  const moneda = (campo: "currency" | "toCurrency") => (
    <label className="shrink-0" style={{ width: 66 }}>
      <span className="label block text-[10px]">Moneda</span>
      <select
        className="input input-sm"
        value={ed[campo]}
        onChange={(e) => onChange(campo, e.target.value)}
        aria-label={`Moneda, línea ${row.index}`}
      >
        <option value="ARS">$</option>
        <option value="USD">US$</option>
      </select>
    </label>
  );
  const cuenta = (campo: "accountId" | "counterAccountId", etiqueta: string) => (
    <select
      className="input input-sm flex-1"
      value={ed[campo]}
      onChange={(e) => onChange(campo, e.target.value)}
      aria-label={`${etiqueta}, línea ${row.index}`}
    >
      {campo === "counterAccountId" && <option value="">Hacia…</option>}
      {accounts.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name}
        </option>
      ))}
    </select>
  );

  return (
    <li className="space-y-2 p-2.5" style={{ opacity: row.include || bad ? 1 : 0.45 }}>
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          className="h-4 w-4 shrink-0"
          checked={row.include}
          disabled={bad}
          onChange={onToggle}
          aria-label={`Cargar la línea ${row.index}`}
        />
        <select
          className="input input-sm flex-1"
          value={ed.type}
          onChange={(e) => onChange("type", e.target.value)}
          style={{ color, borderColor: color }}
          aria-label={`Tipo, línea ${row.index}`}
        >
          {TIPOS_EDITABLES.map((t) => (
            <option key={t} value={t}>
              {TX_SHORT[t]}
            </option>
          ))}
        </select>
        <input
          type="date"
          className="input input-sm num flex-1"
          value={ed.day}
          max={today()}
          onChange={(e) => onChange("day", e.target.value)}
          aria-label={`Fecha, línea ${row.index}`}
        />
      </div>

      <div className="flex items-center gap-2">
        {cuenta("accountId", "Cuenta")}
        {ed.type === "transfer" && cuenta("counterAccountId", "Cuenta destino")}
        {trade && (
          <input
            className="input input-sm flex-1 uppercase"
            value={ed.symbol}
            placeholder="Activo"
            autoCapitalize="characters"
            onChange={(e) => onChange("symbol", e.target.value)}
            aria-label={`Activo, línea ${row.index}`}
          />
        )}
      </div>

      <div className="flex items-end gap-2">
        {trade ? (
          <>
            {num("quantity", "Cantidad")}
            {num("price", "Precio")}
            {num("amount", "Total")}
            {moneda("currency")}
          </>
        ) : ed.type === "exchange" ? (
          <>
            {num("amount", "Sale")}
            {moneda("currency")}
            {num("toAmount", "Entra")}
            {moneda("toCurrency")}
          </>
        ) : (
          <>
            {num("amount", "Monto")}
            {moneda("currency")}
          </>
        )}
      </div>

      {sinLeer && (
        <div className="num truncate text-[11px]" style={{ color: "var(--color-ink-3)" }}>
          {row.raw}
        </div>
      )}
      {bad && (
        <div className="flex items-center gap-1 text-[11px]" style={{ color: "var(--color-warn)" }}>
          <IconWarning size={12} />
          {row.blockers.join(" ")}
        </div>
      )}
    </li>
  );
}
