/**
 * Genera los iconos de la PWA sin dependencias: rasteriza el trazo del logo y
 * escribe el PNG a mano (zlib viene con Node).
 *
 * El logo es una W angular dibujada con segmentos rectos: misma gramatica que
 * el resto de la app, cero esquinas redondeadas.
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";

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

function render(size, { padding = 0.22, stroke = 0.1, transparent = false, height = size } = {}) {
  const width = size;
  const rgba = Buffer.alloc(width * height * 4);
  // La marca se dibuja dentro del cuadrado centrado del lienzo: asi el mismo
  // codigo sirve para un icono y para un splash apaisado.
  const box = Math.min(width, height);
  const inset = box * padding;
  const span = box - inset * 2;
  const half = (box * stroke) / 2;
  const dx0 = (width - box) / 2;
  const dy0 = (height - box) / 2;

  // W angular: cuatro segmentos, brazo derecho mas alto (gesto ascendente).
  const pts = [
    [inset, inset + span * 0.05],
    [inset + span * 0.26, inset + span],
    [inset + span * 0.5, inset + span * 0.42],
    [inset + span * 0.74, inset + span],
    [inset + span, inset],
  ].map(([x, y]) => [x + dx0, y + dy0]);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      let dist = Infinity;
      for (let i = 0; i < pts.length - 1; i++) {
        dist = Math.min(dist, distToSegment(px, py, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]));
      }
      // Un pixel de transicion: suficiente para que no se vea dentado.
      const coverage = Math.max(0, Math.min(1, half - dist + 0.5));
      const offset = (y * width + x) * 4;
      if (transparent) {
        // El primer plano de un icono adaptativo lleva el fondo aparte: aca
        // va solo el trazo, con el alfa haciendo el suavizado.
        for (let c = 0; c < 3; c++) rgba[offset + c] = FG[c];
        rgba[offset + 3] = Math.round(coverage * 255);
      } else {
        for (let c = 0; c < 3; c++) {
          rgba[offset + c] = Math.round(BG[c] + (FG[c] - BG[c]) * coverage);
        }
        rgba[offset + 3] = 255;
      }
    }
  }
  return encodePng(width, height, rgba);
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

/* --- Android ---------------------------------------------------------------
 *
 * El APK necesita los mismos pixeles en otras carpetas: el lanzador por
 * densidad, el primer plano del icono adaptativo (que va sin fondo, porque el
 * fondo lo pone el sistema) y la pantalla de arranque.
 *
 * Si no existe android/, esto no hace nada: el proyecto nativo se genera con
 * `npx cap add android` y no esta en todos los arboles de trabajo.
 */
const ANDROID = "android/app/src/main/res";
if (existsSync(ANDROID)) {
  // Densidades del lanzador: 48dp en mdpi y de ahi para arriba.
  const densidades = [
    ["mdpi", 48],
    ["hdpi", 72],
    ["xhdpi", 96],
    ["xxhdpi", 144],
    ["xxxhdpi", 192],
  ];
  for (const [densidad, lado] of densidades) {
    const dir = `${ANDROID}/mipmap-${densidad}`;
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}/ic_launcher.png`, render(lado));
    writeFileSync(`${dir}/ic_launcher_round.png`, render(lado));
    // El primer plano adaptativo se recorta fuerte: la marca va mas adentro.
    writeFileSync(
      `${dir}/ic_launcher_foreground.png`,
      render(Math.round(lado * 2.25), { padding: 0.33, stroke: 0.075, transparent: true }),
    );
  }

  // El fondo del icono adaptativo, que el template deja en blanco.
  writeFileSync(
    `${ANDROID}/values/ic_launcher_background.xml`,
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#0a0a0b</color>\n</resources>\n`,
  );

  // Pantalla de arranque, vertical y apaisada, en cada densidad.
  const splashes = [
    ["mdpi", 320, 480],
    ["hdpi", 480, 800],
    ["xhdpi", 720, 1280],
    ["xxhdpi", 960, 1600],
    ["xxxhdpi", 1280, 1920],
  ];
  for (const [densidad, corto, largo] of splashes) {
    const vertical = render(corto, { height: largo, padding: 0.36, stroke: 0.055 });
    const apaisado = render(largo, { height: corto, padding: 0.36, stroke: 0.055 });
    for (const [orientacion, png] of [["port", vertical], ["land", apaisado]]) {
      const dir = `${ANDROID}/drawable-${orientacion}-${densidad}`;
      mkdirSync(dir, { recursive: true });
      writeFileSync(`${dir}/splash.png`, png);
    }
  }
  writeFileSync(`${ANDROID}/drawable/splash.png`, render(480, { height: 800, padding: 0.36, stroke: 0.055 }));

  // El icono de la barra de notificaciones va monocromo y recortado a su
  // silueta: Android lo pinta del color que quiere, asi que un PNG con fondo
  // sale como un cuadrado blanco. Un vector con solo el trazo se ve bien.
  mkdirSync(`${ANDROID}/drawable`, { recursive: true });
  writeFileSync(
    `${ANDROID}/drawable/ic_stat_waltra.xml`,
    `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="64"
    android:viewportHeight="64">
    <path
        android:pathData="M14,15 L20.6,49 L32,31.9 L43.4,49 L50,14"
        android:fillColor="#00000000"
        android:strokeColor="#FFFFFFFF"
        android:strokeWidth="6.4"
        android:strokeLineJoin="miter"
        android:strokeLineCap="butt" />
</vector>
`,
  );
  console.log("iconos de Android generados en " + ANDROID);
}

console.log("iconos generados en public/");
