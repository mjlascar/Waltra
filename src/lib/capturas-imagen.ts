/**
 * Preparar capturas para mandarlas a leer.
 *
 * Una captura de telefono mide 1080 × 2280 o mas. Los modelos achican lo que
 * pasa de cerca de un megapixel, y una captura larga achicada entera deja los
 * numeros en ocho pixeles de alto: ahi se confunde un 8 con un 3. Asi que una
 * captura larga se parte en pedazos casi cuadrados, con un poco de
 * solapamiento para que ninguna fila quede cortada al medio, y cada pedazo va
 * en JPEG. El pedido le avisa al modelo que puede ver una fila repetida.
 */

export interface Pedazo {
  mime: "image/jpeg";
  /** Base64, sin el prefijo `data:`. */
  data: string;
}

/** El lado mas largo que un modelo lee sin achicar. */
const MAX_LADO = 1568;
/** El area que lee sin achicar. */
const MAX_PIXELES = 1_150_000;
/**
 * Lo que se repite entre un pedazo y el siguiente, en pixeles de la captura.
 * Mas que una fila de la lista de un broker (150 a 250 px en un telefono):
 * una fila cortada al medio en un pedazo esta entera en el otro.
 */
const SOLAPA = 300;
/** Mas pedazos que esto por pedido no conviene: se lee en dos tandas. */
export const MAX_PEDAZOS = 40;

/**
 * Como se parte una captura de `w` × `h`: el comienzo y el alto de cada
 * pedazo. Todos del mismo alto, repartidos parejo: sin una franja finita al
 * final que no tiene nada que leer.
 */
export function cortes(w: number, h: number): { y: number; alto: number }[] {
  const maxAlto = Math.round(w * 1.2);
  // Una imagen angosta no se parte: el solapamiento no le entraria.
  if (h <= maxAlto * 1.1 || maxAlto <= SOLAPA * 2) return [{ y: 0, alto: h }];
  const n = Math.ceil((h - SOLAPA) / (maxAlto - SOLAPA));
  const alto = Math.ceil((h + (n - 1) * SOLAPA) / n);
  return Array.from({ length: n }, (_, i) => ({ y: Math.min(i * (alto - SOLAPA), h - alto), alto }));
}

export async function prepararCapturas(files: File[]): Promise<Pedazo[]> {
  const out: Pedazo[] = [];
  for (const file of files) {
    const bmp = await createImageBitmap(file);
    try {
      for (const { y, alto } of cortes(bmp.width, bmp.height)) {
        const escala = Math.min(1, MAX_LADO / Math.max(bmp.width, alto), Math.sqrt(MAX_PIXELES / (bmp.width * alto)));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(bmp.width * escala));
        canvas.height = Math.max(1, Math.round(alto * escala));
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("El teléfono no dejó preparar la imagen.");
        // Fondo blanco: una captura con transparencia pasada a JPEG quedaria negra.
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(bmp, 0, y, bmp.width, alto, 0, 0, canvas.width, canvas.height);
        out.push({ mime: "image/jpeg", data: canvas.toDataURL("image/jpeg", 0.88).split(",")[1] ?? "" });
      }
    } finally {
      bmp.close();
    }
  }
  return out.filter((p) => p.data.length > 0);
}
