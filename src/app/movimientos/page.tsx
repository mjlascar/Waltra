"use client";

import { useMemo, useState } from "react";
import { Header } from "@/components/ui/Header";
import { AddTransaction } from "@/components/AddTransaction";
import { Sheet } from "@/components/ui/Sheet";
import { EmptyStart } from "@/components/EmptyStart";
import { IconEdit, IconTrash } from "@/components/icons";
import { useStore } from "@/lib/store";
import { txColor } from "@/lib/tx-style";
import {
  longDate,
  money,
  percent,
  plainNumber,
  quantity as fmtQty,
  shortDate,
  TX_LABEL,
  TX_SHORT,
} from "@/lib/format";
import type { Transaction, TxType } from "@/lib/types";
import { unitsFactor } from "@/lib/engine/splits";
import { toDay } from "@/lib/date";

const FILTERS: { value: TxType | "todos" | "capital"; label: string }[] = [
  { value: "todos", label: "Todos" },
  { value: "capital", label: "Capital" },
  { value: "buy", label: "Compras" },
  { value: "sell", label: "Ventas" },
  { value: "dividend", label: "Rentas" },
];

/** Cuantos movimientos se agregan por vez al tocar "mostrar mas". */
const PAGINA = 60;

const MONTHS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

export default function Movimientos() {
  const { transactions, accounts, assets, portfolio, ready, deleteTransaction } = useStore();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["value"]>("todos");
  const [account, setAccount] = useState<string>("todas");
  const [query, setQuery] = useState("");
  const [detail, setDetail] = useState<Transaction | null>(null);
  // Cuantos movimientos se dibujan. Una historia larga en un telefono de 2019
  // se nota: es mejor mostrar los ultimos y pedir mas si hacen falta.
  const [limite, setLimite] = useState(PAGINA);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  /** Tocar un filtro vuelve a arrancar la lista desde el principio. */
  function aplicar<T>(set: (value: T) => void) {
    return (value: T) => {
      set(value);
      setLimite(PAGINA);
    };
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return transactions
      .filter((tx) => {
        if (account !== "todas" && tx.accountId !== account && tx.counterAccountId !== account) {
          return false;
        }
        if (filter === "capital" && tx.type !== "deposit" && tx.type !== "withdraw") return false;
        if (filter === "dividend" && tx.type !== "dividend" && tx.type !== "interest") return false;
        if (filter !== "todos" && filter !== "capital" && filter !== "dividend" && tx.type !== filter) {
          return false;
        }
        if (q) {
          const asset = assets.find((a) => a.id === tx.assetId);
          const hay = [
            asset?.symbol,
            asset?.name,
            tx.note,
            tx.raw,
            TX_LABEL[tx.type],
            accounts.find((a) => a.id === tx.accountId)?.name,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt.localeCompare(a.createdAt)));
  }, [transactions, filter, account, query, assets, accounts]);

  const visibles = useMemo(() => filtered.slice(0, limite), [filtered, limite]);
  const faltan = filtered.length - visibles.length;

  /** Agrupado por mes: da ritmo a la lista y hace visible la cadencia de aportes. */
  const months = useMemo(() => {
    const groups = new Map<string, Transaction[]>();
    for (const tx of visibles) {
      const key = tx.date.slice(0, 7);
      const bucket = groups.get(key);
      if (bucket) bucket.push(tx);
      else groups.set(key, [tx]);
    }
    return [...groups.entries()];
  }, [visibles]);

  if (!ready) return <div className="py-20 text-center"><span className="label">Abriendo…</span></div>;
  if (transactions.length === 0) return <EmptyStart />;

  const assetOf = (tx: Transaction) => assets.find((a) => a.id === tx.assetId);
  const accountOf = (id?: string) => accounts.find((a) => a.id === id)?.name ?? "—";
  /** "Cocos Capital" -> "Cocos": en una fila apretada alcanza y sobra. */
  const shortAccount = (id?: string) => accountOf(id).split(/\s+/)[0];

  return (
    <div className="pb-6">
      <Header title="Movimientos" />

      <input
        className="input mb-3"
        value={query}
        onChange={(e) => aplicar(setQuery)(e.target.value)}
        placeholder="Buscar por activo, nota o cuenta…"
      />

      <div className="no-scrollbar mb-2 flex gap-1.5 overflow-x-auto pb-1">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            className="chip shrink-0"
            style={{
              background: filter === f.value ? "var(--color-surface-3)" : "transparent",
              color: filter === f.value ? "var(--color-ink)" : undefined,
              height: 28,
            }}
            onClick={() => aplicar(setFilter)(f.value)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {accounts.length > 1 && (
        <div className="no-scrollbar mb-4 flex gap-1.5 overflow-x-auto pb-1">
          {[{ id: "todas", name: "Todas las cuentas" }, ...accounts].map((a) => (
            <button
              key={a.id}
              className="chip shrink-0"
              style={{
                background: account === a.id ? "var(--color-surface-3)" : "transparent",
                color: account === a.id ? "var(--color-ink)" : undefined,
                height: 28,
                textTransform: "none",
                letterSpacing: 0,
              }}
              onClick={() => aplicar(setAccount)(a.id)}
            >
              {a.name}
            </button>
          ))}
        </div>
      )}

      <p className="label mb-3">
        {filtered.length} {filtered.length === 1 ? "movimiento" : "movimientos"}
        {filter === "capital" &&
          ` · neto ${money(portfolio.netContributedUsd, "USD", { compact: true })}`}
      </p>

      {months.map(([key, rows]) => {
        const [year, month] = key.split("-");
        return (
          <section key={key} className="mb-4">
            <div className="eyebrow mb-1.5">
              {MONTHS[Number(month) - 1]} {year}
            </div>
            <div className="card divide-hairline">
              {rows.map((tx) => {
                const asset = assetOf(tx);
                const outflow = tx.type === "withdraw" || tx.type === "buy" || tx.type === "fee";
                // El detalle va debajo junto a la fecha: en 360px, una columna
                // de fecha aparte le come el ancho al dato que importa.
                // La fecha va primero y sin año: el encabezado del mes ya lo
                // dice, y asi lo que se corta al final es el detalle de precio,
                // que ademas se deduce del monto de la derecha.
                // En un cambio, a la derecha va lo que entro y abajo lo que se
                // dio a cambio y a que dolar: es como lo cuenta el comprobante.
                const esCambio = tx.type === "exchange" && tx.toAmount !== undefined;
                const detailParts = [
                  shortDate(tx.date, false),
                  esCambio ? `por ${money(tx.amount, tx.currency, { compact: true })}` : null,
                  esCambio && tx.fxRate ? `a ${plainNumber(tx.fxRate, 0)}` : null,
                  asset ? shortAccount(tx.accountId) : null,
                  // El simbolo de moneda del precio unitario se omite: es el
                  // mismo del monto que esta a la derecha, y aca cada caracter
                  // se paga en texto cortado.
                  tx.quantity
                    ? `${fmtQty(tx.quantity, 6)} @ ${plainNumber(tx.price ?? 0, (tx.price ?? 0) >= 1000 ? 0 : 2)}`
                    : null,
                  tx.note && tx.note !== "ejemplo" ? tx.note : null,
                ].filter(Boolean);
                return (
                  <button
                    key={tx.id}
                    onClick={() => setDetail(tx)}
                    className="flex w-full items-center gap-2.5 p-3 text-left"
                    // Un filete del color del tipo sobre el borde izquierdo:
                    // se barre la lista de un vistazo sin leer cada rotulo.
                    style={{ borderLeft: `3px solid ${txColor(tx.type)}` }}
                  >
                    <span
                      className="chip shrink-0"
                      style={{ color: txColor(tx.type), borderColor: txColor(tx.type) }}
                    >
                      {TX_SHORT[tx.type]}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px]">
                        {tx.type === "transfer"
                          ? `${shortAccount(tx.accountId)} → ${shortAccount(tx.counterAccountId)}`
                          : esCambio
                            ? `${tx.toCurrency === "USD" ? "Compra" : "Venta"} de dólares · ${shortAccount(tx.accountId)}`
                            : (asset?.symbol ?? accountOf(tx.accountId))}
                      </div>
                      <div className="label mt-0.5 truncate">{detailParts.join(" · ")}</div>
                    </div>
                    <span className="num shrink-0 text-[13px]">
                      {tx.type === "split" && tx.ratio
                        ? `×${tx.ratio.toLocaleString("es-AR", { maximumFractionDigits: 2 })}`
                        : esCambio
                          ? money(tx.toAmount!, tx.toCurrency ?? "USD", { compact: true })
                          : `${outflow ? "−" : ""}${money(tx.amount, tx.currency, { compact: true })}`}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}

      {faltan > 0 && (
        <button className="btn w-full" onClick={() => setLimite((n) => n + PAGINA)}>
          Mostrar {Math.min(PAGINA, faltan)} más
          <span className="label">de {faltan} restantes</span>
        </button>
      )}

      {filtered.length === 0 && (
        <p className="label py-10 text-center">Ningún movimiento coincide con el filtro.</p>
      )}

      {detail && (
        <Sheet
          open
          onClose={() => {
            setDetail(null);
            setConfirmDelete(false);
          }}
          title={TX_LABEL[detail.type]}
          footer={
            confirmDelete ? (
              <div className="flex gap-2">
                <button className="btn btn-ghost flex-1" onClick={() => setConfirmDelete(false)}>
                  No, volver
                </button>
                <button
                  className="btn flex-1"
                  style={{ borderColor: "var(--color-neg)", color: "var(--color-neg)" }}
                  onClick={async () => {
                    await deleteTransaction(detail.id);
                    setConfirmDelete(false);
                    setDetail(null);
                  }}
                >
                  Sí, borrar
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <button
                  className="btn btn-ghost flex-1"
                  onClick={() => setConfirmDelete(true)}
                >
                  <IconTrash size={16} /> Borrar
                </button>
                {/* Un cambio de ratio se corrige borrandolo y cargandolo de nuevo
                    desde la posicion: el formulario comun no sabe de ratios. */}
                {detail.type !== "split" && (
                  <button
                    className="btn btn-primary flex-1"
                    onClick={() => {
                      setEditing(detail);
                      setDetail(null);
                    }}
                  >
                    <IconEdit size={16} /> Editar
                  </button>
                )}
              </div>
            )
          }
        >
          {confirmDelete && (
            <p className="mb-4 text-[13px]" style={{ color: "var(--color-warn)" }}>
              Se borra el movimiento y todas las métricas se recalculan. No se puede deshacer.
            </p>
          )}
          <div className="card divide-hairline">
            {(
              [
                ["Fecha", longDate(detail.date)],
                ["Cuenta", accountOf(detail.accountId)],
                detail.counterAccountId ? ["Hacia", accountOf(detail.counterAccountId)] : null,
                assetOf(detail) ? ["Activo", `${assetOf(detail)!.symbol} — ${assetOf(detail)!.name}`] : null,
                detail.quantity ? ["Cantidad", fmtQty(detail.quantity, 8)] : null,
                detail.type === "split" && detail.ratio
                  ? ["Ratio", `cada unidad pasó a ser ${detail.ratio.toLocaleString("es-AR", { maximumFractionDigits: 2 })}`]
                  : null,
                detail.price ? ["Precio unitario", money(detail.price, detail.currency)] : null,
                detail.type === "split"
                  ? null
                  : [detail.type === "exchange" ? "Entregado" : "Monto", money(detail.amount, detail.currency)],
                detail.type === "exchange" && detail.toAmount !== undefined
                  ? ["Recibido", money(detail.toAmount, detail.toCurrency ?? "USD")]
                  : null,
                detail.fee ? ["Comisión", money(detail.fee, detail.currency)] : null,
                detail.fxRate ? ["Dólar usado", `$ ${detail.fxRate}`] : null,
                detail.note ? ["Nota", detail.note] : null,
                detail.raw ? ["Lo escribiste así", `«${detail.raw}»`] : null,
              ].filter(Boolean) as [string, string][]
            ).map(([label, value]) => (
              <div key={label} className="flex items-baseline gap-3 p-3">
                <span className="eyebrow shrink-0" style={{ width: 96 }}>
                  {label}
                </span>
                <span className="flex-1 text-right text-[13px]">{value}</span>
              </div>
            ))}
          </div>
          {(detail.type === "deposit" || detail.type === "withdraw") && (
            <p className="label mt-3 leading-snug">
              Esto cuenta como capital: entra en «capital aportado» y no como ganancia.
            </p>
          )}
          {detail.type === "split" && (
            <p className="label mt-3 leading-snug">
              Un cambio de ratio no mueve plata: las mismas acciones pasan a contarse en
              más unidades, cada una más barata. El costo total queda igual.
            </p>
          )}
          {detail.type === "exchange" && (
            <p className="label mt-3 leading-snug">
              Cambiar pesos por dólares no es capital ni ganancia: es la misma plata en
              otra moneda. Si lo pagaste más caro que el dólar del día, la diferencia
              aparece como una pérdida chica, que es lo que fue.
            </p>
          )}
          {detail.type === "transfer" && (
            <p className="label mt-3 leading-snug">
              Una transferencia entre cuentas propias no suma capital nuevo: el saldo
              solo cambia de lugar.
            </p>
          )}
          {detail.type === "buy" && assetOf(detail) && (
            <p className="label mt-3 leading-snug">
              {(() => {
                const pos = portfolio.positions.find((x) => x.assetId === detail.assetId);
                if (!pos || !detail.price) return "Compra registrada.";
                // Si despues hubo un split, el precio de esta compra esta en
                // otra escala: 9 CEDEARs a $ 50.705 son 22,5 a $ 20.282. Sin
                // pasarlo a unidades de hoy, un cambio de ratio de 2,5 se leia
                // como una caida del 60%.
                const f = unitsFactor(portfolio.splits[detail.assetId!], toDay(detail.date));
                const pagado = detail.price / f;
                const now = pos.price ?? pagado;
                const change = now / pagado - 1;
                return `Desde esta compra, ${pos.symbol} ${
                  change >= 0 ? "subió" : "bajó"
                } ${percent(Math.abs(change), { decimals: 1, sign: false })}${
                  f !== 1 ? ", contando el cambio de ratio posterior" : ""
                }.`;
              })()}
            </p>
          )}
        </Sheet>
      )}

      <AddTransaction open={Boolean(editing)} onClose={() => setEditing(null)} editing={editing} />
    </div>
  );
}
