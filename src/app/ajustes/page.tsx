"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Header } from "@/components/ui/Header";
import { SectionTitle } from "@/components/ui/Stat";
import { Field, Segmented } from "@/components/ui/Field";
import { Sheet } from "@/components/ui/Sheet";
import { BulkImport } from "@/components/BulkImport";
import { InstallPrompt } from "@/components/InstallPrompt";
import { AlertSettings } from "@/components/AlertSettings";
import { AssetEditor } from "@/components/AssetEditor";
import { IconChevron, IconTrash } from "@/components/icons";
import { newId, useStore } from "@/lib/store";
import { exportBackup, importBackup, parseBackup, wipeAll } from "@/lib/db";
import { describeBackendError, diagnostics, ON_DEVICE } from "@/lib/backend";
import { clearDemoData, hasDemoData, loadDemoData } from "@/lib/demo";
import { KIND_LABEL, money, relativeTime } from "@/lib/format";
import { BENCHMARK_CHOICES } from "@/lib/benchmark";
import { DEFAULT_MODEL, MODELS } from "@/lib/insights/models";
import type { Account, Asset, Broker, Currency } from "@/lib/types";

interface Health {
  mock: boolean;
  aiConfigured: boolean;
  model: string;
  providers: { name: string; ok: boolean; ms: number; error?: string }[];
}

export default function Ajustes() {
  const {
    accounts, assets, transactions, settings, updateSettings,
    saveAccount, deleteAccount, saveAsset, deleteAsset,
    db, refresh, backend, portfolio,
  } = useStore();

  const router = useRouter();
  const [account, setAccount] = useState<Account | null>(null);
  const [asset, setAsset] = useState<Asset | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [bulk, setBulk] = useState(false);
  const [wipeText, setWipeText] = useState("");
  const [wiping, setWiping] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const demo = hasDemoData(transactions.map((t) => t.id));

  async function runHealth() {
    setChecking(true);
    setMessage(null);
    try {
      setHealth(await diagnostics(false, backend()));
    } catch (err) {
      setMessage(describeBackendError(err));
    } finally {
      setChecking(false);
    }
  }

  async function doExport() {
    if (!db) return;
    const backup = await exportBackup(db);
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `waltra-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setMessage("Backup descargado. Guardalo fuera del teléfono.");
  }

  async function doImport(file: File, mode: "replace" | "merge") {
    if (!db) return;
    try {
      const summary = await importBackup(db, parseBackup(await file.text()), mode);
      setMessage(
        `Importado: ${summary.transactions} movimientos, ${summary.assets} activos, ${summary.accounts} cuentas.`,
      );
      void refresh({ force: true });
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="pb-6">
      <Header title="Ajustes" />

      {message && (
        <div className="card mb-4 p-3">
          <p className="text-[12px] leading-snug">{message}</p>
        </div>
      )}

      {/* --- Perfil: alimenta directamente la seccion de Insights ---------- */}
      <section className="mb-5">
        <SectionTitle>Tu perfil como inversor</SectionTitle>
        <div className="card space-y-3 p-3">
          <Field label="Tolerancia al riesgo">
            <Segmented
              value={settings.riskProfile}
              onChange={(v) => void updateSettings({ riskProfile: v })}
              options={[
                { value: "conservador", label: "Conservador" },
                { value: "moderado", label: "Moderado" },
                { value: "agresivo", label: "Agresivo" },
              ]}
            />
          </Field>
          <Field label="Horizonte" hint="En cuántos años pensás necesitar esta plata.">
            <input
              className="input num"
              type="number"
              min={1}
              max={50}
              value={settings.horizonYears}
              onChange={(e) => void updateSettings({ horizonYears: Number(e.target.value) || 1 })}
            />
          </Field>
          <Field
            label="Comparar contra"
            hint="La vara del gráfico de rendimiento: qué habrías conseguido sin elegir nada."
          >
            <select
              className="input"
              value={settings.benchmark ?? "SPY"}
              onChange={(e) => {
                void updateSettings({ benchmark: e.target.value });
                void refresh({ force: true });
              }}
            >
              {BENCHMARK_CHOICES.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Objetivo" hint="Con esto el análisis deja de ser genérico.">
            <textarea
              className="input"
              rows={3}
              maxLength={600}
              value={settings.goals}
              placeholder="Ej: juntar para un departamento en 5 años, sin sustos grandes."
              onChange={(e) => void updateSettings({ goals: e.target.value })}
            />
          </Field>
        </div>
      </section>

      {/* --- Cuentas ------------------------------------------------------- */}
      <section className="mb-5">
        <SectionTitle
          action={
            <button
              className="label"
              onClick={() =>
                setAccount({
                  id: newId(),
                  name: "",
                  broker: "other",
                  currency: "USD",
                  createdAt: new Date().toISOString(),
                })
              }
            >
              + Agregar
            </button>
          }
        >
          Cuentas
        </SectionTitle>
        <div className="card divide-hairline">
          {accounts.map((a) => (
            <button
              key={a.id}
              className="flex w-full items-center gap-2 p-3 text-left"
              onClick={() => setAccount(a)}
            >
              <span className="min-w-0 flex-1 truncate text-[13px]">{a.name}</span>
              <span className="label shrink-0">{a.currency}</span>
              <IconChevron size={13} />
            </button>
          ))}
        </div>
      </section>

      {/* --- Activos ------------------------------------------------------- */}
      <section className="mb-5">
        <SectionTitle>Activos ({assets.length})</SectionTitle>
        <div className="card divide-hairline">
          {assets.map((a) => {
            const missing = portfolio.missingPrices.includes(a.symbol);
            return (
              <button
                key={a.id}
                className="flex w-full items-center gap-2 p-3 text-left"
                onClick={() => setAsset(a)}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px]">
                    {a.symbol}
                    {missing && (
                      <span className="ml-2 text-[10px]" style={{ color: "var(--color-warn)" }}>
                        sin precio
                      </span>
                    )}
                  </div>
                  <div className="label mt-0.5 truncate">
                    {KIND_LABEL[a.kind]} · {a.source} · {a.sourceSymbol}
                  </div>
                </div>
                <IconChevron size={13} />
              </button>
            );
          })}
          {assets.length === 0 && <p className="label p-4 text-center">Todavía no hay activos.</p>}
        </div>
      </section>

      {/* --- Datos --------------------------------------------------------- */}
      <section className="mb-5">
        <SectionTitle>Tus datos</SectionTitle>
        <div className="card p-3">
          <p className="label mb-3 leading-relaxed">
            Todo vive en este teléfono. Si borrás los datos del navegador o cambiás de
            equipo, se pierde. El backup es un archivo tuyo, no sube a ningún lado.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button className="btn btn-sm" onClick={doExport}>
              Exportar
            </button>
            <button className="btn btn-sm" onClick={() => fileRef.current?.click()}>
              Importar
            </button>
          </div>
          <button className="btn btn-sm mt-2 w-full" onClick={() => setBulk(true)}>
            Pegar movimientos desde tus notas
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void doImport(file, "merge");
              e.target.value = "";
            }}
          />
          <p className="label mt-2">
            Importar combina con lo que ya tenés: los movimientos con el mismo id se
            reemplazan, el resto se suma.
          </p>

          <div className="hairline mt-3 pt-3">
            {demo ? (
              <button
                className="btn btn-sm w-full"
                onClick={async () => {
                  if (!db) return;
                  await clearDemoData(db);
                  setMessage("Datos de ejemplo borrados.");
                }}
              >
                Borrar los datos de ejemplo
              </button>
            ) : (
              <button
                className="btn btn-sm w-full"
                onClick={async () => {
                  if (!db) return;
                  await loadDemoData(db);
                  await refresh({ force: true });
                  setMessage("Datos de ejemplo cargados.");
                }}
              >
                Cargar datos de ejemplo
              </button>
            )}
          </div>

          <div className="hairline mt-3 pt-3">
            <p className="eyebrow mb-2">Borrar todo</p>
            <p className="label mb-2 leading-snug">
              Escribí <strong style={{ color: "var(--color-ink)" }}>BORRAR</strong> para
              habilitar. Se va todo: movimientos, activos, cuentas e informes.
            </p>
            <div className="flex gap-2">
              <input
                className="input flex-1"
                value={wipeText}
                onChange={(e) => setWipeText(e.target.value)}
                placeholder="BORRAR"
              />
              <button
                className="btn"
                style={{ borderColor: "var(--color-neg)", color: "var(--color-neg)" }}
                disabled={wipeText !== "BORRAR" || wiping}
                onClick={async () => {
                  if (!db || wipeText !== "BORRAR") return;
                  setWiping(true);
                  await wipeAll(db);
                  setWipeText("");
                  setWiping(false);
                  router.replace("/");
                }}
              >
                <IconTrash size={16} />
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* --- Diagnostico --------------------------------------------------- */}
      <section className="mb-5">
        <SectionTitle>Diagnóstico</SectionTitle>
        <div className="card p-3">
          <p className="label mb-3 leading-relaxed">
            Los precios vienen de APIs públicas gratuitas. Si algo no cotiza, acá se ve
            cuál de las fuentes está caída.
          </p>
          <button className="btn btn-sm w-full" onClick={runHealth} disabled={checking}>
            {checking ? "Probando…" : "Probar las fuentes de datos"}
          </button>

          {health && (
            <div className="mt-3">
              <div className="divide-hairline">
                {health.providers.map((provider) => (
                  <div key={provider.name} className="flex items-center gap-2 py-2">
                    <span
                      className="swatch"
                      style={{ background: provider.ok ? "var(--color-pos)" : "var(--color-neg)" }}
                    />
                    <span className="min-w-0 flex-1 truncate text-[12px]">{provider.name}</span>
                    <span className="num shrink-0 text-[11px]" style={{ color: "var(--color-ink-3)" }}>
                      {provider.ok ? `${provider.ms} ms` : "falla"}
                    </span>
                  </div>
                ))}
              </div>
              <p className="label mt-2 leading-snug">
                Insights: {health.aiConfigured ? `activos (${health.model})` : "sin clave configurada"}
                {health.mock && " · precios simulados"}
              </p>
              {health.providers.filter((x) => !x.ok).map((x) => (
                <p key={x.name} className="label mt-1 leading-snug">
                  {x.name}: {x.error}
                </p>
              ))}
            </div>
          )}

          <p className="label mt-3">
            Último refresco:{" "}
            {settings.lastQuoteSync ? relativeTime(settings.lastQuoteSync) : "nunca"}
            {" · "}dólar MEP{" "}
            {portfolio.fxLatest > 0 ? money(portfolio.fxLatest, "ARS", { decimals: 0 }) : "sin dato"}
          </p>
        </div>
      </section>

      {/* --- Instalacion --------------------------------------------------- */}
      <section className="mb-5">
        <SectionTitle>En tu teléfono</SectionTitle>
        <div className="card p-3">
          <InstallPrompt />
        </div>
      </section>

      {/* --- Insights ------------------------------------------------------ */}
      <section className="mb-5">
        <SectionTitle>Insights</SectionTitle>
        <div className="card p-3">
          <Field
            label="Modelo"
            hint={
              MODELS.find((m) => m.id === (settings.model ?? DEFAULT_MODEL))?.detail ??
              "Cada análisis consume créditos de tu cuenta de Anthropic."
            }
          >
            <select
              className="input"
              value={settings.model ?? DEFAULT_MODEL}
              onChange={(e) => void updateSettings({ model: e.target.value })}
            >
              {MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </Field>
          <p className="label mt-2 leading-snug">
            Cada análisis hace varias búsquedas web y dos llamadas al modelo. Bajar de
            modelo abarata, a costa de profundidad.
          </p>
        </div>
      </section>

      {/* --- Alertas ------------------------------------------------------- */}
      {ON_DEVICE && (
        <section className="mb-5">
          <SectionTitle>Alertas de precio</SectionTitle>
          <AlertSettings />
        </section>
      )}

      {/* --- Acceso -------------------------------------------------------- */}
      <section className="mb-5">
        <SectionTitle>{ON_DEVICE ? "Tu clave de Anthropic" : "Acceso a la API"}</SectionTitle>
        {ON_DEVICE ? (
          <ApiKeyField
            value={settings.apiKey}
            onChange={(key) => void updateSettings({ apiKey: key })}
          />
        ) : (
          <div className="card p-3">
            <Field
              label="Clave de acceso"
              hint="Solo hace falta si publicaste la app en internet con WALTRA_ACCESS_KEY. Se guarda en este teléfono."
            >
              <input
                className="input"
                type="password"
                autoComplete="off"
                value={settings.accessKey ?? ""}
                onChange={(e) => void updateSettings({ accessKey: e.target.value || undefined })}
                placeholder="vacío"
              />
            </Field>
          </div>
        )}
      </section>

      <p className="label leading-relaxed">
        Waltra · {transactions.length} movimientos, {assets.length} activos.
        <br />
        Los precios son informativos y pueden tener demora. No es asesoramiento financiero.
      </p>

      <BulkImport open={bulk} onClose={() => setBulk(false)} />

      {/* --- Editor de cuenta ---------------------------------------------- */}
      {account && (
        <AccountEditor
          account={account}
          canDelete={accounts.length > 1 && !transactions.some((t) => t.accountId === account.id)}
          onClose={() => setAccount(null)}
          onSave={async (next) => {
            await saveAccount(next);
            setAccount(null);
          }}
          onDelete={async () => {
            await deleteAccount(account.id);
            setAccount(null);
          }}
        />
      )}

      {/* --- Editor de activo ---------------------------------------------- */}
      {asset && (
        <AssetEditor
          asset={asset}
          canDelete={!transactions.some((t) => t.assetId === asset.id)}
          onClose={() => setAsset(null)}
          onSave={async (next) => {
            await saveAsset(next);
            setAsset(null);
            void refresh({ force: true });
          }}
          onDelete={async () => {
            await deleteAsset(asset.id);
            setAsset(null);
          }}
        />
      )}
    </div>
  );
}

function AccountEditor({
  account, canDelete, onClose, onSave, onDelete,
}: {
  account: Account;
  canDelete: boolean;
  onClose: () => void;
  onSave: (a: Account) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(account);
  return (
    <Sheet
      open
      onClose={onClose}
      title={account.name || "Nueva cuenta"}
      footer={
        <div className="flex gap-2">
          {canDelete && (
            <button
              className="btn"
              style={{ borderColor: "var(--color-neg)", color: "var(--color-neg)" }}
              onClick={onDelete}
            >
              <IconTrash size={16} />
            </button>
          )}
          <button
            className="btn btn-primary flex-1"
            disabled={!draft.name.trim()}
            onClick={() => void onSave({ ...draft, name: draft.name.trim() })}
          >
            Guardar
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <Field label="Nombre">
          <input
            className="input"
            value={draft.name}
            autoFocus
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="Cocos Capital"
          />
        </Field>
        <Field label="Tipo" hint="Define los alias que entiende la carga rápida.">
          <select
            className="input"
            value={draft.broker}
            onChange={(e) => setDraft({ ...draft, broker: e.target.value as Broker })}
          >
            <option value="cocos">Cocos Capital</option>
            <option value="binance">Binance</option>
            <option value="other">Otro</option>
          </select>
        </Field>
        <Field label="Moneda habitual">
          <Segmented
            value={draft.currency}
            onChange={(v) => setDraft({ ...draft, currency: v as Currency })}
            options={[
              { value: "USD", label: "USD" },
              { value: "ARS", label: "ARS" },
            ]}
          />
        </Field>
        {!canDelete && (
          <p className="label leading-snug">
            No se puede borrar: tiene movimientos cargados o es la única cuenta.
          </p>
        )}
      </div>
    </Sheet>
  );
}

/**
 * La clave de Anthropic del usuario, en el APK.
 *
 * En la version web esta clave vive en el servidor y la pantalla ni la
 * menciona. En el telefono no hay servidor, asi que la pone el usuario y se
 * guarda junto al resto de sus datos, en el almacenamiento privado de la app.
 *
 * Nunca se muestra despues de guardada: no hay nada que ganar en volver a
 * verla y si algo que perder si alguien mira por encima del hombro. Tampoco
 * entra en el backup (ver `exportBackup`), porque ese archivo termina en
 * Drive o en un mail a uno mismo.
 */
function ApiKeyField({
  value,
  onChange,
}: {
  value?: string;
  onChange: (key: string | undefined) => void;
}) {
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const cargada = Boolean(value);

  if (cargada && !editing) {
    return (
      <div className="card p-3">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <span className="text-[13px]">Hay una clave cargada.</span>
          <span className="chip shrink-0 pos">activa</span>
        </div>
        <p className="label mb-3 leading-relaxed">
          Los insights y la lectura asistida de frases salen de tu cuenta de Anthropic.
          Lo que gastan lo ves en tu consola.
        </p>
        <div className="flex gap-2">
          <button
            className="btn btn-sm flex-1"
            onClick={() => {
              setDraft("");
              setEditing(true);
            }}
          >
            Cambiar
          </button>
          <button className="btn btn-sm flex-1" onClick={() => onChange(undefined)}>
            Borrar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card p-3">
      <Field
        label="Clave"
        hint="Se guarda solo en este teléfono y viaja únicamente a api.anthropic.com. No entra en el backup."
      >
        <input
          className="input"
          type="password"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="sk-ant-…"
        />
      </Field>
      <div className="mt-3 flex gap-2">
        {cargada && (
          <button className="btn btn-sm flex-1" onClick={() => setEditing(false)}>
            Cancelar
          </button>
        )}
        <button
          className="btn btn-primary btn-sm flex-[2]"
          disabled={draft.trim().length < 20}
          onClick={() => {
            onChange(draft.trim());
            setDraft("");
            setEditing(false);
          }}
        >
          Guardar
        </button>
      </div>
      <p className="label mt-3 leading-relaxed">
        Se saca de console.anthropic.com, en API keys. Es tuya: la app no la comparte
        con nadie y cada uno paga lo suyo.
      </p>
    </div>
  );
}
