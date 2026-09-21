import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/** Configuracion plana de ESLint (Next 16 ya exporta configuraciones planas). */
const config = [
  { ignores: [".next/**", "node_modules/**", "screenshots/**", "docs/**", "public/sw.js"] },
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
