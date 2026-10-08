import { NATIVE } from "@/lib/platform";
import { exportBackup, type BackupFile, type WaltraDB } from "@/lib/db";

/**
 * Copias automaticas en el telefono.
 *
 * Los movimientos viven en la base del WebView, y esa base puede perderse sin
 * que la app haga nada: el sistema la limpia si falta lugar, se corrompe, o
 * alguien toca «Borrar datos» del navegador del sistema. Pasó: la app abrio
 * un dia vacia, despues de semanas de uso, y el ultimo backup era de dos
 * semanas antes.
 *
 * Una vez por dia, si hay movimientos y cambiaron, se escribe un backup en la
 * carpeta privada de la app, que es otro lugar que la base: sobrevive a que
 * la base se pierda (no a desinstalar, eso borra todo). Se guardan los ultimos
 * siete dias. Mismo archivo que el backup manual, sin claves.
 */
const CARPETA = "copias";
const GUARDAR = 7;

async function fs() {
  const { Filesystem, Directory, Encoding } = await import("@capacitor/filesystem");
  return { Filesystem, Directory, Encoding };
}

export interface AutoBackup {
  /** Donde vive: la carpeta de copias automaticas o la cache del backup manual. */
  where: "copias" | "cache";
  name: string;
  /** El dia de la copia, del nombre del archivo. */
  day: string;
  transactions: number | null;
}

function huella(b: BackupFile): string {
  // Lo que cambia cuando se carga, edita o borra algo. Barato y suficiente.
  const ultima = b.transactions.reduce((m, t) => (t.updatedAt > m ? t.updatedAt : m), "");
  return `${b.transactions.length}|${b.assets.length}|${ultima}`;
}

/** Escribe la copia de hoy si hace falta. Nunca tira: una copia que falla no es un error para el usuario. */
export async function autoBackup(db: WaltraDB): Promise<void> {
  if (!NATIVE) return;
  try {
    const backup = await exportBackup(db);
    // Una base vacia no se copia: pisaria la ultima copia buena con nada.
    if (backup.transactions.length === 0) return;
    const { Filesystem, Directory, Encoding } = await fs();
    const dia = new Date().toISOString().slice(0, 10);
    const nombre = `${CARPETA}/waltra-${dia}.json`;
    const marca = `${CARPETA}/ultima.txt`;
    const actual = huella(backup);
    try {
      const previa = await Filesystem.readFile({ path: marca, directory: Directory.Data, encoding: Encoding.UTF8 });
      if (previa.data === `${dia}|${actual}`) return;
    } catch {
      // Primera vez.
    }
    await Filesystem.writeFile({
      path: nombre,
      data: JSON.stringify(backup),
      directory: Directory.Data,
      encoding: Encoding.UTF8,
      recursive: true,
    });
    await Filesystem.writeFile({
      path: marca,
      data: `${dia}|${actual}`,
      directory: Directory.Data,
      encoding: Encoding.UTF8,
      recursive: true,
    });
    // Las de mas de siete dias se van.
    const { files } = await Filesystem.readdir({ path: CARPETA, directory: Directory.Data });
    const copias = files
      .map((f) => f.name)
      .filter((n) => /^waltra-\d{4}-\d{2}-\d{2}\.json$/.test(n))
      .sort()
      .reverse();
    for (const viejo of copias.slice(GUARDAR)) {
      await Filesystem.deleteFile({ path: `${CARPETA}/${viejo}`, directory: Directory.Data });
    }
  } catch {
    // Sin lugar o sin permiso: se intenta mañana.
  }
}

/**
 * Las copias que hay para recuperar: las automaticas y los backups manuales
 * que quedaron en la cache (el boton Exportar los escribe ahi antes de
 * compartirlos). De la mas nueva a la mas vieja.
 */
export async function listBackups(): Promise<AutoBackup[]> {
  if (!NATIVE) return [];
  const { Filesystem, Directory } = await fs();
  const out: AutoBackup[] = [];
  const lugares: { where: AutoBackup["where"]; path: string; dir: (typeof Directory)[keyof typeof Directory] }[] = [
    { where: "copias", path: CARPETA, dir: Directory.Data },
    { where: "cache", path: "", dir: Directory.Cache },
  ];
  for (const lugar of lugares) {
    try {
      const { files } = await Filesystem.readdir({ path: lugar.path, directory: lugar.dir });
      for (const f of files) {
        const m = f.name.match(/^waltra-(\d{4}-\d{2}-\d{2})\.json$/);
        if (!m) continue;
        out.push({ where: lugar.where, name: f.name, day: m[1], transactions: null });
      }
    } catch {
      // La carpeta no existe todavia.
    }
  }
  // Cuantos movimientos tiene cada una: es lo que se compara para elegir.
  for (const b of out) {
    try {
      b.transactions = (await readBackup(b)).transactions.length;
    } catch {
      b.transactions = null;
    }
  }
  return out.sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
}

export async function readBackup(b: AutoBackup): Promise<BackupFile> {
  const { Filesystem, Directory, Encoding } = await fs();
  const { data } = await Filesystem.readFile({
    path: b.where === "copias" ? `${CARPETA}/${b.name}` : b.name,
    directory: b.where === "copias" ? Directory.Data : Directory.Cache,
    encoding: Encoding.UTF8,
  });
  return JSON.parse(typeof data === "string" ? data : await data.text()) as BackupFile;
}
