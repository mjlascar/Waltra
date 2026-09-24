"use client";

import { useCallback, useEffect, useState } from "react";
import { NATIVE } from "@/lib/platform";
import { installedApp, isNewer, latestRelease, type InstalledApp, type ReleaseInfo } from "@/lib/update";

export interface UpdateStatus {
  installed: InstalledApp | null;
  release: ReleaseInfo | null;
  /** Hay una version publicada mas nueva que la instalada. */
  available: boolean;
  checking: boolean;
  error: string | null;
  checkedAt: number | null;
}

interface Resultado {
  installed: InstalledApp | null;
  release: ReleaseInfo | null;
  error: string | null;
  at: number;
}

/**
 * Una sola consulta compartida entre el inicio y Ajustes. GitHub deja 60
 * pedidos por hora sin credenciales: consultar en cada pantalla que se abre
 * los gastaria sin ganar nada.
 */
let enCurso: Promise<Resultado> | null = null;
let ultimo: Resultado | null = null;
const VIGENCIA_MS = 60 * 60 * 1000;

function consultar(force: boolean): Promise<Resultado> {
  if (!force && ultimo && Date.now() - ultimo.at < VIGENCIA_MS) return Promise.resolve(ultimo);
  if (enCurso) return enCurso;
  enCurso = (async () => {
    const installed = await installedApp();
    let release: ReleaseInfo | null = null;
    let error: string | null = null;
    try {
      release = await latestRelease();
      if (!release) error = "el release no dice qué versión es";
    } catch {
      // "Failed to fetch" no le dice nada a nadie: casi siempre es la señal.
      error = "GitHub no respondió, revisá la conexión y probá de nuevo";
    }
    ultimo = { installed, release, error, at: Date.now() };
    return ultimo;
  })().finally(() => {
    enCurso = null;
  });
  return enCurso;
}

/** Si hay una version nueva del APK. En la web no consulta nada. */
export function useUpdate(): UpdateStatus & { check: () => void } {
  const [res, setRes] = useState<Resultado | null>(ultimo);
  const [checking, setChecking] = useState(false);

  const correr = useCallback((force: boolean) => {
    if (!NATIVE) return;
    setChecking(true);
    void consultar(force).then((r) => {
      setRes(r);
      setChecking(false);
    });
  }, []);

  useEffect(() => {
    if (!NATIVE) return;
    let vivo = true;
    void consultar(false).then((r) => {
      if (vivo) setRes(r);
    });
    return () => {
      vivo = false;
    };
  }, []);

  return {
    installed: res?.installed ?? null,
    release: res?.release ?? null,
    available: isNewer(res?.release ?? null, res?.installed ?? null),
    checking: checking || (NATIVE && !res),
    error: res?.error ?? null,
    checkedAt: res?.at ?? null,
    check: () => correr(true),
  };
}
