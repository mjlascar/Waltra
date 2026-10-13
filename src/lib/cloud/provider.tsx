"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { liveQuery } from "dexie";
import { useLiveQuery } from "dexie-react-hooks";
import { useStore } from "@/lib/store";
import { NATIVE } from "@/lib/platform";
import { CloudFormatError, readData } from "./data";
import { DriveTransport } from "./drive";
import { GOOGLE_CLIENT_ID, GoogleError, loginGoogle, logoutGoogle, renewGoogle,
  type GoogleSession, type GoogleUser } from "./google";
import { CloudOwnerError, setPaused, synchronize, unlinkCloud, type CloudConflict, type Resolution } from "./sync";

type Status = "unconfigured" | "loading" | "disconnected" | "syncing" | "ok" | "pending" | "offline" | "conflict" | "error";
interface CloudValue {
  user: GoogleUser | null; status: Status; message: string | null; lastSync: string | null;
  conflict: CloudConflict | null;
  /** La cuenta a la que quedo vinculada esta instalacion, haya o no sesion ahora. */
  linked: { email?: string } | null;
  login(): Promise<void>; logout(): Promise<void>; unlink(): Promise<void>;
  sync(resolution?: Resolution): Promise<void>;
}
const CloudContext = createContext<CloudValue | null>(null);

const EXPIRED = "La sesión de Google venció. Reconectá tu cuenta para seguir sincronizando.";

export function CloudProvider({ children }: { children: ReactNode }) {
  const { db, ready, dbError, refresh } = useStore();
  const [user, setUser] = useState<GoogleUser | null>(null);
  const [status, setStatus] = useState<Status>(GOOGLE_CLIENT_ID ? "loading" : "unconfigured");
  const [message, setMessage] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [conflict, setConflict] = useState<CloudValue["conflict"]>(null);
  const linkedRow = useLiveQuery(() => (db ? db.cloudState.get("cloud") : undefined), [db]);
  const session = useRef<GoogleSession | null>(null);
  const busy = useRef(false);
  const mounted = useRef(false);
  const stopped = useRef(false);
  const refreshing = useRef(refresh);
  useEffect(() => { refreshing.current = refresh; }, [refresh]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; session.current = null; };
  }, []);

  // Al abrir, el APK retoma la sesion sin preguntar, pero solo si esta
  // instalacion ya estaba conectada y el usuario no toco Desconectar.
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || !db || !ready || dbError) return;
    let alive = true;
    void (async () => {
      const state = await db.cloudState.get("cloud");
      const renewed = NATIVE && state && !state.paused ? await renewGoogle().catch(() => null) : null;
      if (!alive || session.current) return;
      session.current = renewed;
      setUser(renewed?.user ?? null);
      setStatus(renewed ? "pending" : "disconnected");
    })().catch(() => { if (alive && !session.current) setStatus("disconnected"); });
    return () => { alive = false; };
  }, [db, ready, dbError]);

  /** Solo el APK puede pedir otro token sin un toque. */
  const renew = useCallback(async (): Promise<GoogleSession | null> => {
    if (!NATIVE) return null;
    const previous = session.current;
    const renewed = await renewGoogle().catch(() => null);
    // Si en el medio se desconecto, el token nuevo no se usa.
    if (!mounted.current || session.current !== previous) return null;
    session.current = renewed;
    if (renewed) setUser(renewed.user);
    return renewed;
  }, []);

  const sync = useCallback(async (resolution?: Resolution) => {
    if (!session.current || !db || !ready || dbError || busy.current || (stopped.current && !resolution)) return;
    if (!navigator.onLine) { setStatus("offline"); return; }
    busy.current = true;
    const expired = () => { setStatus("error"); setMessage(EXPIRED); stopped.current = true; };
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        let connection: GoogleSession | null = session.current;
        if (!connection) return;
        if (Date.now() >= connection.expiresAt - 30_000) {
          connection = await renew();
          if (!connection) { expired(); return; }
        }
        const current = connection;
        const active = () => mounted.current && session.current === current;
        setStatus("syncing"); setMessage(null);
        try {
          const result = await synchronize(db, new DriveTransport(current.token, active),
            current.user.sub, active, resolution, current.user.email);
          if (!active()) return;
          setStatus(result.status);
          if (result.status === "conflict") { setConflict(result); stopped.current = true; }
          else {
            setConflict(null); stopped.current = false;
            if (result.status === "ok") setLastSync(result.at);
            // Solo trae lo que falta: los precios que ya estaban siguen sirviendo.
            if (result.downloaded) void refreshing.current();
          }
          return;
        } catch (err) {
          if (!active()) return;
          // En el APK, un 401 es casi siempre un token que vencio antes de lo
          // calculado: se renueva una vez y se reintenta.
          if (attempt === 0 && NATIVE && err instanceof GoogleError && err.status === 401 && await renew()) continue;
          setStatus(navigator.onLine ? "error" : "offline");
          setMessage(err instanceof Error ? err.message : "No se pudo sincronizar con Drive.");
          // Lo que reintentar no arregla espera a que el usuario haga algo.
          if (err instanceof CloudOwnerError || err instanceof CloudFormatError ||
            (err instanceof GoogleError && [401, 403].includes(err.status ?? 0))) stopped.current = true;
          return;
        }
      }
    } finally { busy.current = false; }
  }, [db, ready, dbError, renew]);

  useEffect(() => {
    if (!user || !ready || !db || dbError) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (busy.current) schedule();
        else void sync();
      }, 1500);
    };
    // Observa la base, incluidos importaciones, borrados y cambios de otras pestanas.
    let previous: string | undefined;
    const subscription = liveQuery(() => readData(db)).subscribe({
      next: (value) => { if (value !== previous) { previous = value; schedule(); } },
      error: () => { setStatus("error"); setMessage("No se pudo leer la base local. No se subió ninguna copia."); },
    });
    const tick = () => { if (document.visibilityState === "visible") schedule(); };
    const interval = setInterval(tick, 60_000);
    window.addEventListener("online", tick);
    window.addEventListener("offline", tick);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearTimeout(timer); clearInterval(interval); subscription.unsubscribe();
      window.removeEventListener("online", tick); window.removeEventListener("offline", tick);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [user, ready, db, dbError, sync]);

  const login = async () => {
    setStatus("loading"); setMessage(null);
    try {
      const connection = await loginGoogle();
      if (!mounted.current) return;
      session.current = connection; stopped.current = false;
      if (db) await setPaused(db, false);
      setConflict(null); setUser(connection.user); setStatus("pending");
      // Tambien sirve al reconectar la misma cuenta, cuyo efecto no cambia.
      await sync();
    } catch (err) {
      if (!mounted.current) return;
      setStatus("error"); setMessage(err instanceof Error ? err.message : "No se pudo conectar Google.");
    }
  };
  /** Invalida en el acto cualquier respuesta en vuelo y deja la pantalla sin sesion. */
  const forget = () => {
    session.current = null; stopped.current = true;
    setUser(null); setConflict(null); setLastSync(null); setStatus("disconnected"); setMessage(null);
  };
  const logout = async () => {
    forget();
    if (db) await setPaused(db, true).catch(() => undefined);
    try { await logoutGoogle(); }
    catch { setMessage("Se desconectó la sincronización. Google no pudo cerrar su sesión nativa; reintentá antes de cambiar de cuenta."); }
  };
  const unlink = async () => {
    forget();
    if (db) await unlinkCloud(db);
    // La instalacion ya quedo desvinculada; cerrar la sesion de Google es un extra.
    await logoutGoogle().catch(() => undefined);
  };

  // Con la base sin abrir no hay nada que sincronizar, y decir "Preparando el
  // acceso a Google" para siempre confundiria.
  const blocked = Boolean(dbError) && GOOGLE_CLIENT_ID !== "";
  return <CloudContext.Provider value={{ user, lastSync, conflict,
    status: blocked ? "error" : status,
    message: blocked ? "No se pudieron abrir los datos de este dispositivo. La sincronización queda en pausa." : message,
    linked: linkedRow ? { email: linkedRow.email } : null, login, logout, unlink,
    sync: (resolution) => { if (!resolution) stopped.current = false; return sync(resolution); } }}>{children}</CloudContext.Provider>;
}

export function useCloud(): CloudValue {
  const cloud = useContext(CloudContext);
  if (!cloud) throw new Error("useCloud necesita CloudProvider");
  return cloud;
}
