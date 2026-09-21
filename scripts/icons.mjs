/**
 * Genera los iconos de la PWA sin dependencias: rasteriza el trazo del logo y
 * escribe el PNG a mano (zlib viene con Node).
 *
 * El logo es una W angular dibujada con segmentos rectos: misma gramatica que
 * el resto de la app, cero esquinas redondeadas.
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

const BG = [0x0a, 0x0a, 0x0b];
const FG = [0xf3, 0xf3, 0xf5];

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // profundidad
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const offset = y * (width * 4 + 1);
    raw[offset] = 0; // filtro "none"
    rgba.copy(raw, offset + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Distancia de un punto al segmento AB. */
function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function render(size, { padding = 0.22, stroke = 0.1 } = {}) {
  const rgba = Buffer.alloc(size * size * 4);
  const inset = size * padding;
  const span = size - inset * 2;
  const half = (size * stroke) / 2;

  // W angular: cuatro segmentos, brazo derecho mas alto (gesto ascendente).
  const pts = [
    [inset, inset + span * 0.05],
    [inset + span * 0.26, inset + span],
    [inset + span * 0.5, inset + span * 0.42],
    [inset + span * 0.74, inset + span],
    [inset + span, inset],
  ];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      let dist = Infinity;
      for (let i = 0; i < pts.length - 1; i++) {
        dist = Math.min(dist, distToSegment(px, py, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]));
      }
      // Un pixel de transicion: suficiente para que no se vea dentado.
      const coverage = Math.max(0, Math.min(1, half - dist + 0.5));
      const offset = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) {
        rgba[offset + c] = Math.round(BG[c] + (FG[c] - BG[c]) * coverage);
      }
      rgba[offset + 3] = 255;
    }
  }
  return encodePng(size, size, rgba);
}

mkdirSync("public", { recursive: true });
writeFileSync("public/icon-192.png", render(192));
writeFileSync("public/icon-512.png", render(512));
// Maskable: Android recorta hasta un 20% del borde, asi que el trazo va mas adentro.
writeFileSync("public/icon-maskable-512.png", render(512, { padding: 0.3, stroke: 0.085 }));
writeFileSync("public/apple-touch-icon.png", render(180, { padding: 0.24 }));

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" fill="#0a0a0b"/>
  <path d="M14 15 L20.6 49 L32 31.9 L43.4 49 L50 14" fill="none" stroke="#f3f3f5" stroke-width="6.4" stroke-linejoin="miter" stroke-linecap="butt"/>
</svg>`;
writeFileSync("public/icon.svg", svg);

console.log("iconos generados en public/");
