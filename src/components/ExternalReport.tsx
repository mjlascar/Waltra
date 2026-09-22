"use client";

import { useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { Field, Segmented } from "@/components/ui/Field";
import { buildExternalRequest, parseExternalReport } from "@/lib/insights/external";
import { KIND_LABEL, type ReportKind } from "@/lib/insights/schedule";
import type { InsightRequest } from "@/lib/insights/digest";
import type { InsightReport } from "@/lib/types";
import { newId } from "@/lib/store";

/**
 * Informe hecho afuera de la app.
 *
 * Un abono de claude.ai no se puede llamar desde codigo, pero si se puede usar
 * a mano. Esto arma el pedido completo para copiar, y acepta de vuelta lo que
 * sea: el JSON si vino, o la prosa pelada si no.
 *
 * Es tambien el punto de enganche para una automatizacion: lo que sale de aca
 * es lo que un proceso programado tendria que leer, y lo que se pega es lo que
 * tendria que escribir.
 */
export function ExternalReport({
  open,
  onClose,
  body,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  body: InsightRequest | null;
  onSave: (report: InsightReport) => Promise<void>;
}) {
  const [kind, setKind] = useState<ReportKind>("cartera");
  const [pegado, setPegado] = useState("");
  const [copiado, setCopiado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const pedido = body ? buildExternalRequest(body, kind) : "";

  async function copiar() {
    setError(null);
    try {
      await navigator.clipboard.writeText(pedido);
      setCopiado(true);
    } catch {
      // Sin permiso de portapapeles queda el textarea para copiar a mano.
      setError("No se pudo copiar solo. El texto está abajo para seleccionarlo.");
    }
  }

  async function guardar() {
    const leido = parseExternalReport(pegado);
    if (!leido) {
      setError("Eso no parece un informe. Pegá lo que devolvió el análisis completo.");
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      await onSave({
        id: newId(),
        createdAt: new Date().toISOString(),
        model: "externo",
        marketBrief: leido.marketBrief,
        signals: leido.signals,
        profileRead: leido.profileRead,
        sources: leido.sources,
        degraded: leido.degraded,
        portfolioDigest: pedido,
      });
      setPegado("");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Informe externo"
      footer={
        <div className="flex gap-2">
          <button className="btn btn-ghost flex-1" onClick={onClose}>
            Cerrar
          </button>
          <button
            className="btn btn-primary flex-[2]"
            disabled={pegado.trim().length < 20 || guardando}
            onClick={() => void guardar()}
          >
            {guardando ? "Guardando…" : "Guardar el informe"}
          </button>
        </div>
      }
    >
      <p className="label mb-4 leading-relaxed">
        Para usar un abono de Claude, ChatGPT o cualquier otro, que no dan acceso por
        API. Copiás el pedido, lo pegás allá, y traés la respuesta de vuelta.
      </p>

      <div className="mb-4">
        <Segmented
          value={kind}
          onChange={(v) => {
            setKind(v);
            setCopiado(false);
          }}
          options={[
            { value: "cartera", label: "Tu cartera" },
            { value: "mercado", label: "Mercado" },
          ]}
        />
        <p className="label mt-2 leading-snug">{KIND_LABEL[kind]}.</p>
      </div>

      <div className="eyebrow mb-2">1 · Copiar el pedido</div>
      <button className="btn btn-sm mb-2 w-full" onClick={() => void copiar()}>
        {copiado ? "Copiado" : "Copiar el pedido"}
      </button>
      <textarea
        className="input num mb-4"
        rows={5}
        readOnly
        value={pedido}
        style={{ fontSize: 11, lineHeight: 1.5 }}
        onFocus={(e) => e.currentTarget.select()}
      />

      <div className="eyebrow mb-2">2 · Pegar la respuesta</div>
      <Field
        label="Lo que te devolvió"
        hint="Si trae el bloque JSON, se guarda con sus señales. Si es solo texto, se guarda igual."
      >
        <textarea
          className="input"
          rows={6}
          value={pegado}
          onChange={(e) => {
            setPegado(e.target.value);
            setError(null);
          }}
          placeholder="Pegá acá el análisis completo…"
          style={{ fontSize: 12, lineHeight: 1.5 }}
        />
      </Field>

      {error && <p className="mt-3 text-[12px] neg">{error}</p>}

      <p className="label mt-4 leading-relaxed">
        El pedido lleva tickers, pesos y números. No lleva los montos de tus
        movimientos ni el nombre de tus cuentas.
      </p>
    </Sheet>
  );
}
