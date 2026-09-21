import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/** Configuracion plana de ESLint (Next 16 ya exporta configuraciones planas). */
const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "screenshots/**",
      "docs/**",
      "public/sw.js",
      // El vigia de precios corre en un motor sin modulos: es JavaScript
      // plano a proposito y no sigue las reglas de este proyecto. Se prueba
      // aparte, en src/lib/alerts/__tests__/runner.test.ts.
      "public/runners/**",
      // La exportacion estatica y su copia adentro del proyecto Android.
      "out/**",
      "android/**",
    ],
  },
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Las variables de descarte con guion bajo son intencionales.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
];

export default config;
