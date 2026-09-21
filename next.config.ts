import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // El globo de desarrollo se monta encima de la barra inferior.
  devIndicators: false,
  // El navegador de pruebas entra por 127.0.0.1 y por la IP de la red local
  // (asi se abre desde el telefono). Sin esto, el dev server bloquea el
  // cliente de recarga en caliente y la pagina nunca llega a hidratarse.
  allowedDevOrigins: ["127.0.0.1", "localhost", "192.168.0.0/16", "10.0.0.0/8"],
  // The app is a local-first PWA: everything the phone needs is static except
  // the /api routes that proxy market data and Claude.
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
};

export default nextConfig;
