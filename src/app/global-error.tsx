"use client";

/** Ultimo recurso: se usa si falla el layout raiz, sin estilos cargados. */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="es-AR">
      <body
        style={{
          background: "#0a0a0b",
          color: "#f3f3f5",
          fontFamily: "system-ui, sans-serif",
          padding: 24,
          margin: 0,
        }}
      >
        <h1 style={{ fontSize: 20, marginBottom: 12 }}>Waltra no pudo abrir</h1>
        <p style={{ fontSize: 14, lineHeight: 1.6, color: "#a2a2ad" }}>
          Tus datos siguen guardados en este teléfono. Probá recargar.
        </p>
        <pre style={{ fontSize: 11, color: "#6b6b78", whiteSpace: "pre-wrap", marginTop: 16 }}>
          {error.message}
        </pre>
        <button
          onClick={reset}
          style={{
            marginTop: 16,
            padding: "12px 20px",
            background: "#f3f3f5",
            color: "#0a0a0b",
            border: 0,
            borderRadius: 0,
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          Reintentar
        </button>
      </body>
    </html>
  );
}
