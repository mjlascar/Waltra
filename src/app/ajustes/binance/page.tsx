"use client";

import { useMemo, useState } from "react";
import { AjustesShell } from "@/components/ajustes/Shell";
import { Field } from "@/components/ui/Field";
import { SectionTitle } from "@/components/ui/Stat";
import { useStore } from "@/lib/store";
import { useBinanceConnection } from "@/lib/binance/use-connection";
import { money, relativeTime, shortDate } from "@/lib/format";
import { connectWarnings } from "@/lib/binance/sync";
import type { Transaction } from "@/lib/types";
import { today } from "@/lib/date";

/**
 * Conectar Binance con una clave de solo lectura.
 *
 * Despues no hay nada que tocar: los movimientos se traen al abrir la app, al
 * volver a ella y al deslizar hacia abajo. Esta pantalla dice como salio la
 * ultima pasada y lo que no se pudo cargar, que es lo unico que puede hacer
 * falta mirar.
 */
export default function BinanceAjustes() {
  const { accounts, transactions, db, syncBinance } = useStore();
  const conn = useBinanceConnection();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const cuentas = useMemo(() => accounts.filter((a) => !a.archived), [accounts]);
  const propuesta = cuentas.find((a) => a.broker === "binance") ?? cuentas[0];

  async function traer() {
    setBusy(true);
    setMessage(null);
    try {
      const r = await syncBinance({ force: true });
      if (r?.error) setMessage(r.error);
    } finally {
      setBusy(false);
    }
  }

  async function desconectar() {
    if (!db) return;
    const { disconnectBinance } = await import("@/lib/binance/sync");
    await disconnectBinance(db);
    setEditing(false);
    setMessage("Listo. Los movimientos que ya se trajeron quedan.");
  }

  if (conn === undefined) return <AjustesShell title="Binance">{null}</AjustesShell>;

  if (!conn || editing) {
    return (
      <AjustesShell
        title="Binance"
        intro="Tus movimientos de Binance se cargan solos, con una clave que solo puede leer."
        message={message}
      >
        <Conectar
          cuentas={cuentas}
          cuentaPropuesta={conn?.accountId ?? propuesta?.id ?? ""}
          desdePropuesto={conn?.since}
          transactions={transactions}
          onCancel={conn ? () => setEditing(false) : undefined}
          onConnected={async () => {
            setEditing(false);
            setMessage(null);
            await traer();
          }}
        />
      </AjustesShell>
    );
  }

  const cuenta = accounts.find((a) => a.id === conn.accountId);
  const run = conn.lastRun;
  const nuevos = run ? run.added + run.updated : 0;

  return (
    <AjustesShell
      title="Binance"
      intro="Se actualiza sola al abrir la app y al deslizar hacia abajo."
      message={message}
    >
      <section className="mb-5">
        <SectionTitle>Conexión</SectionTitle>
        <div className="card p-3">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <span className="text-[13px]">
              En <strong>{cuenta?.name ?? "una cuenta borrada"}</strong>, desde el{" "}
              {shortDate(conn.since, true)}
            </span>
            <span className={`chip shrink-0 ${conn.authError ? "" : "pos"}`} style={conn.authError ? { color: "var(--color-warn)" } : undefined}>
              {conn.authError ? "sin acceso" : "activa"}
            </span>
          </div>

          {conn.authError ? (
            <p className="text-[12px] leading-snug" style={{ color: "var(--color-warn)" }}>
              {conn.authError}
            </p>
          ) : busy ? (
            <p className="label">Trayendo…</p>
          ) : run ? (
            <p className="label leading-snug">
              {relativeTime(run.at)}:{" "}
              {run.error
                ? run.error
                : nuevos > 0
                  ? `${nuevos} ${nuevos === 1 ? "movimiento nuevo" : "movimientos nuevos"}`
                  : "sin novedades"}
              {run.dupes > 0 && `, ${run.dupes} ya ${run.dupes === 1 ? "estaba cargado" : "estaban cargados"} a mano`}
              {run.partial && ". Falta historial: sigue solo en un minuto"}
              .
            </p>
          ) : (
            <p className="label">Todavía no trajo nada.</p>
          )}

          <div className="mt-3 flex gap-2">
            {conn.authError ? (
              <button className="btn btn-primary btn-sm flex-[2]" onClick={() => setEditing(true)}>
                Cargar otra clave
              </button>
            ) : (
              <button className="btn btn-sm flex-1" disabled={busy} onClick={() => void traer()}>
                Traer ahora
              </button>
            )}
            <button className="btn btn-sm flex-1" onClick={() => void desconectar()}>
              Desconectar
            </button>
          </div>
        </div>
      </section>

      {run && run.skipped.length > 0 && (
        <section className="mb-5">
          <SectionTitle>No se cargó</SectionTitle>
          <ul className="card divide-hairline">
            {run.skipped.map((s) => (
              <li key={s} className="p-2.5 text-[12px] leading-snug" style={{ color: "var(--color-ink-2)" }}>
                {s}
              </li>
            ))}
          </ul>
          <p className="label mt-2 leading-snug">
            Si las unidades no te cierran, Corregir en el detalle de la cuenta las ajusta a lo
            que dice Binance.
          </p>
        </section>
      )}

      <p className="label leading-relaxed">
        Trae solo lo último: compras y ventas, Convert, P2P, ingresos y retiros, hasta lo que
        ya tenías cargado. Nunca cambia lo que ya está, y lo que borres no vuelve. Earn entra
        una vez por mes, cuando el mes termina.
      </p>
    </AjustesShell>
  );
}

function Conectar({
  cuentas,
  cuentaPropuesta,
  desdePropuesto,
  transactions,
  onCancel,
  onConnected,
}: {
  cuentas: { id: string; name: string }[];
  cuentaPropuesta: string;
  desdePropuesto?: string;
  transactions: Transaction[];
  onCancel?: () => void;
  onConnected: () => Promise<void>;
}) {
  const { db, backend } = useStore();
  const [apiKey, setApiKey] = useState("");
  const [secret, setSecret] = useState("");
  // Lo que eligio el usuario; si no eligio, la propuesta. La propuesta no va
  // como valor inicial: cuando la pantalla abre antes de que carguen las
  // cuentas, quedaria vacia para siempre.
  const [elegida, setAccountId] = useState<string | null>(null);
  const accountId = elegida ?? cuentaPropuesta;
  const [since, setSince] = useState<string | null>(desdePropuesto ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Lo anterior al ultimo dia cargado ya esta: se propone seguir desde ahi.
  const desdeSugerido = useMemo(() => {
    const dias = transactions.filter((t) => t.accountId === accountId).map((t) => t.date.slice(0, 10)).sort();
    if (dias.length) return dias[dias.length - 1];
    const d = new Date();
    d.setDate(d.getDate() - 90);
    return today(d);
  }, [transactions, accountId]);
  const desde = since ?? desdeSugerido;
  const avisos = useMemo(() => connectWarnings(transactions, accountId, desde), [transactions, accountId, desde]);
  const [reemplazar, setReemplazar] = useState(true);
  const borrarEstimado = Boolean(avisos.estimate?.replace && reemplazar);

  async function conectar() {
    if (!db) return;
    setBusy(true);
    setError(null);
    try {
      const [{ BinanceClient }, { binanceTransport }, { connectBinance }] = await Promise.all([
        import("@/lib/binance/client"),
        import("@/lib/binance/transport"),
        import("@/lib/binance/sync"),
      ]);
      const creds = { apiKey: apiKey.trim(), secret: secret.trim() };
      const client = new BinanceClient(creds, binanceTransport(backend()));
      const problema = await connectBinance(db, client, { ...creds, accountId, since: desde, dropEstimate: borrarEstimado });
      if (problema) {
        setError(problema);
        return;
      }
      setApiKey("");
      setSecret("");
      await onConnected();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="mb-5">
        <SectionTitle>Sacar la clave</SectionTitle>
        <ol className="card divide-hairline">
          {[
            "En Binance: Perfil → Gestión de API → Crear API → «Generada por el sistema».",
            "Dejá marcado solo «Habilitar lectura», sin restricción de IP.",
            "Copiá la API Key y la Secret Key acá abajo.",
          ].map((paso, i) => (
            <li key={paso} className="flex gap-2.5 p-2.5 text-[12px] leading-snug">
              <span className="num shrink-0" style={{ color: "var(--color-ink-3)" }}>
                {i + 1}
              </span>
              {paso}
            </li>
          ))}
        </ol>
      </section>

      <section className="mb-5">
        <SectionTitle>Tu clave</SectionTitle>
        <div className="card space-y-3 p-3">
          <Field label="API Key">
            <input
              className="input"
              type="password"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </Field>
          <Field label="Secret Key">
            <input
              className="input"
              type="password"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
            />
          </Field>
          <Field label="Cuenta de Waltra">
            <select className="input" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {cuentas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Traer desde" hint="Nunca trae nada de antes de esta fecha.">
            <input
              type="date"
              className="input"
              value={desde}
              max={today()}
              onChange={(e) => setSince(e.target.value || null)}
            />
          </Field>

          {avisos.estimate &&
            (avisos.estimate.replace ? (
              <label className="flex items-start gap-2 text-[12px] leading-snug">
                <input type="checkbox" checked={reemplazar} onChange={(e) => setReemplazar(e.target.checked)} className="mt-0.5" />
                <span>
                  Borrar el ingreso estimado de {money(avisos.estimate.amount, "USD")} que dejó la importación del
                  archivo: los ingresos reales lo reemplazan. Si queda, se cuentan dos veces.
                </span>
              </label>
            ) : (
              <p className="text-[12px] leading-snug" style={{ color: "var(--color-warn)" }}>
                Entre el {shortDate(avisos.estimate.date, true)} y el {shortDate(avisos.estimate.until, true)} ya
                importaste el archivo con un ingreso estimado: los ingresos reales de esos días se contarían dos
                veces. Traé desde el {shortDate(avisos.estimate.date, true)} (y se reemplaza) o desde el{" "}
                {shortDate(avisos.estimate.until, true)}.
              </p>
            ))}
          {avisos.adjusts > 0 && (
            <p className="text-[12px] leading-snug" style={{ color: "var(--color-warn)" }}>
              Desde esa fecha hay {avisos.adjusts === 1 ? "una corrección" : `${avisos.adjusts} correcciones`} de
              unidades. Si eran por Earn o por comisiones, ahora se traen solas: revisalas después para no
              contarlas dos veces.
            </p>
          )}

          {error && <p className="text-[12px] neg leading-snug">{error}</p>}

          <div className="flex gap-2">
            {onCancel && (
              <button className="btn btn-sm flex-1" onClick={onCancel}>
                Cancelar
              </button>
            )}
            <button
              className="btn btn-primary btn-sm flex-[2]"
              disabled={busy || apiKey.trim().length < 20 || secret.trim().length < 20 || !accountId}
              onClick={() => void conectar()}
            >
              {busy ? "Comprobando…" : "Conectar"}
            </button>
          </div>
        </div>
        <p className="label mt-2 leading-relaxed">
          La clave queda solo en este dispositivo, fuera del backup y de Drive. Si puede operar o
          retirar, Waltra no la acepta.
        </p>
      </section>
    </>
  );
}
