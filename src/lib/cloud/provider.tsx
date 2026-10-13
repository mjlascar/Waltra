"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { liveQuery } from "dexie";
import { useStore } from "@/lib/store";
import { readData } from "./data";
import { DriveTransport } from "./drive";
import { GOOGLE_CLIENT_ID, GoogleError, loginGoogle, logoutGoogle, prepareGoogle, restoreGoogle,
  type GoogleSession, type GoogleUser } from "./google";
import { CloudOwnerError, synchronize, type CloudSyncResult, type Resolution } from "./sync";

type Status = "unconfigured" | "loading" | "disconnected" | "syncing" | "ok" | "pending" | "offline" | "conflict" | "error";
interface CloudValue {
  user: GoogleUser | null; status: Status; message: string | null; lastSync: string | null;
  conflict: Extract<CloudSyncResult, { status: "conflict" }> | null;
  login(): Promise<void>; logout(): Promise<void>; sync(resolution?: Resolution): Promise<void>;
}
const CloudContext = createContext<CloudValue | null>(null);

export function CloudProvider({ children }: { children: ReactNode }) {
  const { db, ready, dbError, refresh } = useStore();
  const [user, setUser] = useState<GoogleUser | null>(null);
  const [status, setStatus] = useState<Status>(GOOGLE_CLIENT_ID ? "loading" : "unconfigured");
  const [message, setMessage] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [conflict, setConflict] = useState<CloudValue["conflict"]>(null);
  const session = useRef<GoogleSession | null>(null);
  const busy = useRef(false);
  const mounted = useRef(false);
  const stopped = useRef(false);
  const refreshing = useRef(refresh);
  useEffect(() => { refreshing.current = refresh; }, [refresh]);

  useEffect(() => {
    mounted.current = true;
    let alive = true;
    if (GOOGLE_CLIENT_ID) {
      void prepareGoogle().then(restoreGoogle).then((restored) => {
        if (!alive) return;
        session.current = restored;
        setUser(restored?.user ?? null);
        setStatus(restored ? "pending" : "disconnected");
      }).catch(() => { if (alive) setStatus("disconnected"); });
    }
    return () => { alive = false; mounted.current = false; session.current = null; };
  }, []);

  const sync = useCallback(async (resolution?: Resolution) => {
    const connection = session.current;
    if (!connection || !db || !ready || dbError || busy.current || (stopped.current && !resolution)) return;
    if (!navigator.onLine) { setStatus("offline"); return; }
    if (Date.now() >= connection.expiresAt - 30_000) {
      setStatus("error"); setMessage("La sesión de Google venció. Reconectá tu cuenta para seguir sincronizando.");
      stopped.current = true;
      return;
    }
    const active = () => mounted.current && session.current === connection;
    busy.current = true;
    setStatus("syncing"); setMessage(null);
    try {
      const result = await synchronize(db, new DriveTransport(connection.token, active),
        JSON.stringify([GOOGLE_CLIENT_ID, connection.user.sub]), active, resolution);
      if (!active()) return;
      setStatus(result.status);
      if (result.status === "conflict") { setConflict(result); stopped.current = true; }
      else {
        setConflict(null); stopped.current = false;
        if (result.status === "ok") setLastSync(result.at);
        // Solo trae lo que falta: los precios que ya estaban siguen sirviendo.
        if (result.downloaded) void refreshing.current();
      }
    } catch (err) {
      if (!active()) return;
      setStatus(navigator.onLine ? "error" : "offline");
      setMessage(err instanceof Error ? err.message : "No se pudo sincronizar con Drive.");
      if (err instanceof CloudOwnerError || (err instanceof GoogleError && [401, 403].includes(err.status ?? 0))) stopped.current = true;
    } finally { busy.current = false; }
  }, [db, ready, dbError]);

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
      setConflict(null); setUser(connection.user); setStatus("pending");
      // Tambien sirve al reconectar la misma cuenta, cuyo efecto no cambia.
      await sync();
    } catch (err) {
      if (!mounted.current) return;
      setStatus("error"); setMessage(err instanceof Error ? err.message : "No se pudo conectar Google.");
    }
  };
  const logout = async () => {
    // Invalida inmediatamente cualquier respuesta en vuelo.
    session.current = null; stopped.current = true;
    setUser(null); setConflict(null); setLastSync(null); setStatus("disconnected"); setMessage(null);
    try { await logoutGoogle(); }
    catch { setMessage("Se desconectó la sincronización. Google no pudo cerrar su sesión nativa; reintentá antes de cambiar de cuenta."); }
  };

  return <CloudContext.Provider value={{ user, status, message, lastSync, conflict, login, logout,
    sync: (resolution) => { if (!resolution) stopped.current = false; return sync(resolution); } }}>{children}</CloudContext.Provider>;
}

export function useCloud(): CloudValue {
  const cloud = useContext(CloudContext);
  if (!cloud) throw new Error("useCloud necesita CloudProvider");
  return cloud;
}
