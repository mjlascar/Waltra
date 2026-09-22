/**
 * Cuantas capas modales hay abiertas.
 *
 * Existe por un choque concreto: el gesto de "tirar para actualizar" escucha
 * en todo el documento y cancela el desplazamiento cuando el dedo va hacia
 * abajo con la pagina arriba de todo. Con una hoja abierta el `body` no
 * scrollea, asi que la pagina SIEMPRE esta arriba de todo, y entonces cada
 * intento de subir el contenido de la hoja (que es arrastrar el dedo hacia
 * abajo) se lo comia el refresco.
 *
 * Es un contador y no un booleano porque una hoja puede abrir otra encima.
 */
let abiertas = 0;

export function overlayOpened(): void {
  abiertas += 1;
}

export function overlayClosed(): void {
  abiertas = Math.max(0, abiertas - 1);
}

export function overlayOpen(): boolean {
  return abiertas > 0;
}
