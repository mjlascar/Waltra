import { NextResponse } from "next/server";

/**
 * Si el deploy define WALTRA_ACCESS_KEY, las rutas /api exigen ese valor en
 * la cabecera. Sirve para que una app publicada en internet no quede con los
 * endpoints abiertos (sobre todo el de insights, que gasta creditos).
 *
 * Sin la variable, la app funciona sin friccion: el caso normal es correrla
 * en la red local o en un deploy privado.
 */
export function checkAccess(request: Request): NextResponse | null {
  const expected = process.env.WALTRA_ACCESS_KEY;
  if (!expected) return null;
  const provided = request.headers.get("x-waltra-key");
  if (provided && timingSafeEqual(provided, expected)) return null;
  return NextResponse.json({ error: "Clave de acceso invalida." }, { status: 401 });
}

/** Comparacion de tiempo constante para no filtrar la clave caracter a caracter. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
