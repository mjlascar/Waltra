import { NATIVE } from "@/lib/platform";

/**
 * Sacar el backup del telefono.
 *
 * En un navegador alcanza con un enlace de descarga. Adentro de un WebView de
 * Android, no: `<a download>` sobre un blob es de las cosas que simplemente no
 * hacen nada, sin error ni aviso. Y el backup manual es justamente el unico
 * camino que tienen los datos para salir de este telefono, asi que fallar en
 * silencio ahi seria lo peor que puede pasar.
 *
 * En el APK el archivo se escribe en la cache de la app y se abre la hoja de
 * compartir, que es de donde se manda a Drive, a un mail o a donde sea. La
 * cache y no Documentos porque escribir en el almacenamiento compartido pide
 * permisos que cambian con cada version de Android; compartir, no.
 */
export interface BackupResult {
  /** Que contarle al usuario, ya redactado. */
  message: string;
}

export async function saveBackupFile(nombre: string, contenido: string): Promise<BackupResult> {
  if (!NATIVE) {
    const blob = new Blob([contenido], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = nombre;
    link.click();
    URL.revokeObjectURL(url);
    return { message: "Backup descargado. Guardalo fuera del teléfono." };
  }

  const [{ Filesystem, Directory, Encoding }, { Share }] = await Promise.all([
    import("@capacitor/filesystem"),
    import("@capacitor/share"),
  ]);

  const { uri } = await Filesystem.writeFile({
    path: nombre,
    data: contenido,
    directory: Directory.Cache,
    encoding: Encoding.UTF8,
  });

  try {
    await Share.share({
      title: "Backup de Waltra",
      // El archivo va aparte del texto: varias apps ignoran uno de los dos.
      files: [uri],
    });
    return { message: "Backup listo. Guardalo donde puedas recuperarlo después." };
  } catch (err) {
    // Cancelar la hoja de compartir tambien llega como error, y no es uno.
    const detalle = err instanceof Error ? err.message : String(err);
    if (/cancel/i.test(detalle)) {
      return { message: `El backup quedó guardado en el teléfono: ${nombre}` };
    }
    return {
      message: `No se pudo abrir el menú de compartir (${detalle}). El archivo quedó en ${uri}`,
    };
  }
}
