/**
 * En que envoltorio esta corriendo la app.
 *
 * Se decide en tiempo de compilacion, no de ejecucion, y eso es a proposito:
 * el build nativo y el build web son dos builds distintos, y resolverlo como
 * constante deja que el empaquetador borre del bundle web todo el camino
 * nativo (el SDK de Anthropic, entre otras cosas, que pesa de mas para una
 * PWA). Tambien evita la carrera de "todavia no se si soy nativo" en el primer
 * refresco, que con una deteccion asincronica al arrancar seria inevitable.
 */
export const NATIVE = process.env.NEXT_PUBLIC_WALTRA_NATIVE === "1";

/**
 * De donde salen los datos de mercado y los insights.
 *
 * - `server`: la app le pega a sus propias rutas /api, que hacen el trabajo.
 *   Es el modo web y el de desarrollo.
 * - `device`: el telefono habla directo con los proveedores y con Anthropic.
 *   No hay servidor de Waltra en el medio porque en el APK no existe.
 */
export const BACKEND: "server" | "device" = NATIVE ? "device" : "server";
