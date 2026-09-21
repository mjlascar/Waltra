import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // La app es para alguien que vive en Argentina y carga movimientos de
    // noche: los tests corren en esa zona horaria para que los bugs de fecha
    // aparezcan acá y no en su teléfono.
    env: { TZ: "America/Argentina/Buenos_Aires" },
  },
});
