import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { NATIVE } from "@/lib/platform";
import { StoreProvider } from "@/lib/store";
import { Nav } from "@/components/Nav";
import { ServiceWorker } from "@/components/ServiceWorker";
import { PullToRefresh } from "@/components/PullToRefresh";
import { NativeShell } from "@/components/NativeShell";
import { AlertsMirror } from "@/components/AlertsMirror";
import { ThemeSync } from "@/components/ThemeSync";
import { HapticTouch } from "@/components/HapticTouch";
import { PageTransition } from "@/components/PageTransition";

// Pone el tema antes de que se pinte nada: sin esto, quien usa blanco y negro
// ve la app en color un instante al abrirla. La clave es la de `ThemeSync`.
const TEMA_TEMPRANO = `try{if(localStorage.getItem("waltra.theme")==="mono")document.documentElement.dataset.theme="mono"}catch(e){}`;

export const metadata: Metadata = {
  title: "Waltra",
  description: "Seguimiento unificado de inversiones en Cocos Capital y Binance.",
  applicationName: "Waltra",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Waltra", statusBarStyle: "black-translucent" },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0b",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  // La app tiene tipografia fija pensada para un telefono; el zoom por pellizco
  // se deja habilitado igual porque bloquearlo es un problema de accesibilidad.
  maximumScale: 5,
  /**
   * En la web, `cover` deja que la app pinte hasta el borde y el muesca se
   * resuelve con env(safe-area-inset-*). En el APK eso mismo hacia que la
   * barra de estado tapara los rotulos de arriba y la barra de navegacion de
   * Android se comiera los botones de abajo: el WebView de Android informa
   * esos margenes de forma inconsistente, asi que en vez de pelearle, la
   * ventana se queda adentro de las barras y las respeta el sistema.
   */
  viewportFit: NATIVE ? "auto" : "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // El script de abajo cambia un atributo de <html> antes de que React
    // hidrate; sin esto, React lo toma por un error.
    <html lang="es-AR" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: TEMA_TEMPRANO }} />
      </head>
      <body>
        <StoreProvider>
          <PullToRefresh />
          <main className="shell pt-3">
            <PageTransition>{children}</PageTransition>
          </main>
          <Nav />
          <ServiceWorker />
          <NativeShell />
          <AlertsMirror />
          <ThemeSync />
          <HapticTouch />
        </StoreProvider>
      </body>
    </html>
  );
}
