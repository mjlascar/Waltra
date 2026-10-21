"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { getDb, type BinanceConnection } from "@/lib/db";

/**
 * La conexion con Binance, en vivo: `undefined` mientras se lee, `null` si no
 * hay. Despues de Desconectar la fila queda sin clave (para recordar lo que
 * se borro) y cuenta como que no hay. La pantalla nunca muestra la clave; la
 * lee solo para saber si esta.
 */
export function useBinanceConnection(): BinanceConnection | null | undefined {
  const db = getDb();
  return useLiveQuery(async () => {
    if (!db) return null;
    const conn = await db.connections.get("binance");
    return conn?.apiKey ? conn : null;
  }, [db]);
}
