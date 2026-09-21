import type { NextConfig } from "next";

/**
 * Hay dos builds distintos.
 *
 * El normal sirve la app desde un servidor de Next, con sus rutas /api.
 * El nativo (WALTRA_NATIVE=1) exporta HTML estatico para meter adentro del
 * APK: ahi no hay servidor, asi que las rutas /api no solo sobran sino que
 * romperian la exportacion. Se sacan de la ruta quitando `ts` de las
 * extensiones que Next considera paginas, que es la unica manera limpia de
 * excluirlas sin mover archivos de lugar (todas las pantallas son `.tsx`).
 */
const native = process.env.WALTRA_NATIVE === "1";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // El globo de desarrollo se monta encima de la barra inferior.
  devIndicators: false,
  // El navegador de pruebas entra por 127.0.0.1 y por la IP de la red local
  // (asi se abre desde el telefono). Sin esto, el dev server bloquea el
  // cliente de recarga en caliente y la pagina nunca llega a hidratarse.
  allowedDevOrigins: ["127.0.0.1", "localhost", "192.168.0.0/16", "10.0.0.0/8"],
  // La constante llega al cliente para que el empaquetador pueda borrar el
  // camino que no corresponde en cada build.
  env: { NEXT_PUBLIC_WALTRA_NATIVE: native ? "1" : "0" },
  ...(native
    ? {
        output: "export" as const,
        pageExtensions: ["tsx"],
        // El servidor de archivos del WebView resuelve directorios, no
        // "cartera.html": cada pantalla sale como carpeta con su index.
        trailingSlash: true,
        images: { unoptimized: true },
      }
    : {
        // The app is a local-first PWA: everything the phone needs is static
        // except the /api routes that proxy market data and Claude.
        async headers() {
          return [
            {
              source: "/sw.js",
              headers: [
                { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
                { key: "Service-Worker-Allowed", value: "/" },
              ],
            },
          ];
        },
      }),
};

export default nextConfig;
