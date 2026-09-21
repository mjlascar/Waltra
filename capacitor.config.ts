import type { CapacitorConfig } from "@capacitor/cli";

/**
 * El APK.
 *
 * `webDir` apunta a la exportacion estatica que deja `npm run build:native`.
 * No hay servidor remoto configurado a proposito: la app se sirve entera
 * desde el telefono y anda sin conexion, igual que la PWA.
 */
const config: CapacitorConfig = {
  appId: "app.waltra",
  appName: "Waltra",
  webDir: "out",
  android: {
    // El fondo detras del WebView, para que no pegue un flash blanco al abrir.
    backgroundColor: "#0a0a0b",
  },
  plugins: {
    /**
     * El vigia de precios. Android no garantiza el intervalo: 30 minutos es
     * lo que se pide, y el sistema lo corre cuando le parece, nunca antes de
     * los 15. La app lo dice en pantalla en vez de prometer puntualidad.
     */
    BackgroundRunner: {
      label: "app.waltra.alertas",
      src: "runners/alerts.js",
      event: "checkPrices",
      repeat: true,
      interval: 30,
      autoStart: true,
    },
    LocalNotifications: {
      // Monocromo y recortado a su silueta: Android pinta este icono del
      // color que quiere, y un PNG con fondo sale como un cuadrado blanco.
      smallIcon: "ic_stat_waltra",
      iconColor: "#E9E9EE",
    },
    SplashScreen: {
      backgroundColor: "#0a0a0b",
      showSpinner: false,
      launchAutoHide: true,
    },
  },
};

export default config;
