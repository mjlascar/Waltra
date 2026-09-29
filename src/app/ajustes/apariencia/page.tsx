"use client";

import { Segmented } from "@/components/ui/Field";
import { AjustesShell } from "@/components/ajustes/Shell";
import { useStore } from "@/lib/store";
import { money, percent } from "@/lib/format";

/**
 * Colores de la app. El blanco y negro es para quien usa el telefono en
 * escala de grises: ahi el verde y el rojo son el mismo gris, y la app
 * pasa a decir ganancia y perdida con el peso y el subrayado.
 */
export default function AparienciaAjustes() {
  const { settings, updateSettings } = useStore();
  const tema = settings.theme ?? "color";

  return (
    <AjustesShell
      title="Apariencia"
      intro="Si usás el teléfono en blanco y negro, el verde y el rojo se ven iguales. El modo blanco y negro sube los contrastes y marca la ganancia y la pérdida con la forma del texto."
    >
      <div className="card p-3">
        <Segmented
          value={tema}
          onChange={(v) => void updateSettings({ theme: v })}
          options={[
            { value: "color", label: "Color" },
            { value: "mono", label: "Blanco y negro" },
          ]}
        />
        <div className="hairline mt-3 pt-3">
          <div className="eyebrow mb-2">Así se ve</div>
          <div className="flex items-baseline justify-between">
            <span className="text-[13px]">Ganancia</span>
            <span className="num pos text-[14px]">
              {money(435.35, "USD", { sign: true })} ({percent(0.082, { decimals: 1 })})
            </span>
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-[13px]">Pérdida</span>
            <span className="num neg text-[14px]">
              {money(-96.5, "USD", { sign: true })} ({percent(-0.209, { decimals: 1 })})
            </span>
          </div>
          <p className="label mt-3 leading-snug">
            {tema === "mono"
              ? "La ganancia va en negrita y la pérdida en negrita subrayada, además del signo."
              : "La ganancia va en verde y la pérdida en rojo, siempre con su signo al lado."}
          </p>
        </div>
      </div>
    </AjustesShell>
  );
}
