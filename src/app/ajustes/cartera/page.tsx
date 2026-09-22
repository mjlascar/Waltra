"use client";

import { useState } from "react";
import { AjustesShell } from "@/components/ajustes/Shell";
import { AccountEditor } from "@/components/ajustes/AccountEditor";
import { AssetEditor } from "@/components/AssetEditor";
import { IconChevron } from "@/components/icons";
import { SectionTitle } from "@/components/ui/Stat";
import { newId, useStore } from "@/lib/store";
import { KIND_LABEL } from "@/lib/format";
import type { Account, Asset } from "@/lib/types";

/** Donde opera el usuario y que tiene adentro. */
export default function CarteraAjustes() {
  const {
    accounts, assets, transactions, portfolio,
    saveAccount, deleteAccount, saveAsset, deleteAsset,
  } = useStore();
  const [account, setAccount] = useState<Account | null>(null);
  const [asset, setAsset] = useState<Asset | null>(null);

  return (
    <AjustesShell
      title="Cuentas y activos"
      intro="Las cuentas son dónde operás. Los activos se crean solos al cargar un movimiento; acá se corrige de dónde sale su precio."
    >
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

      {asset && (
        <AssetEditor
          asset={asset}
          canDelete={!transactions.some((t) => t.assetId === asset.id)}
          onClose={() => setAsset(null)}
          onSave={async (next) => {
            await saveAsset(next);
            setAsset(null);
          }}
          onDelete={async () => {
            await deleteAsset(asset.id);
            setAsset(null);
          }}
        />
      )}
    </AjustesShell>
  );
}
