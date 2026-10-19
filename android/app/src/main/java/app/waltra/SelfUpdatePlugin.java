package app.waltra;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;

/**
 * Waltra se actualiza sola: baja el APK publicado y se lo pasa al instalador
 * de Android, sin navegador ni carpeta de descargas.
 *
 * Desde Android 12, una app que se actualiza a si misma no necesita que se
 * confirme cada vez si tiene el permiso de instalar apps (el usuario lo da una
 * vez) y declara UPDATE_PACKAGES_WITHOUT_USER_ACTION. Si Android igual pide
 * confirmar (una version anterior, o un fabricante que no lo respeta), el
 * receptor muestra el dialogo del sistema.
 *
 * Android solo instala el APK encima si esta firmado con la misma clave: uno
 * alterado no puede reemplazar a Waltra. Igual se compara la huella que
 * publica GitHub, y solo se baja del release de Waltra.
 */
@CapacitorPlugin(name = "SelfUpdate")
public class SelfUpdatePlugin extends Plugin {

    /** Solo el release de Waltra: el WebView no puede pedir instalar otra cosa. */
    static final String ALLOWED = "https://github.com/mjlascar/Waltra/releases/download/";
    private static final long MAX_BYTES = 100L * 1024 * 1024;
    private static SelfUpdatePlugin current;

    @Override
    public void load() {
        current = this;
    }

    /** Si ya tiene el permiso, y si Android puede instalar sin preguntar. */
    @PluginMethod
    public void status(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("allowed", getContext().getPackageManager().canRequestPackageInstalls());
        ret.put("silent", Build.VERSION.SDK_INT >= Build.VERSION_CODES.S);
        call.resolve(ret);
    }

    /** La pantalla del sistema donde se da el permiso de instalar apps. */
    @PluginMethod
    public void openSettings(PluginCall call) {
        Intent intent = new Intent(
            Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
            Uri.parse("package:" + getContext().getPackageName())
        );
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    @PluginMethod
    public void install(PluginCall call) {
        String url = call.getString("url");
        String sha256 = call.getString("sha256");
        if (url == null || !url.startsWith(ALLOWED) || url.contains("..")) {
            call.reject("Esa dirección no es la de las versiones de Waltra.");
            return;
        }
        if (!getContext().getPackageManager().canRequestPackageInstalls()) {
            call.reject("Falta el permiso para instalar apps.", "PERMISSION");
            return;
        }
        new Thread(() -> download(call, url, sha256), "waltra-actualizacion").start();
    }

    /** Baja el APK directo a una sesion del instalador, sin pasar por un archivo. */
    private void download(PluginCall call, String url, String sha256) {
        Context context = getContext();
        PackageInstaller installer = context.getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(
            PackageInstaller.SessionParams.MODE_FULL_INSTALL
        );
        params.setAppPackageName(context.getPackageName());
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED);
        }
        int sessionId = -1;
        try {
            sessionId = installer.createSession(params);
            try (PackageInstaller.Session session = installer.openSession(sessionId)) {
                HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setConnectTimeout(20_000);
                conn.setReadTimeout(30_000);
                // GitHub redirige a su servidor de archivos, tambien por https.
                conn.setInstanceFollowRedirects(true);
                long done = 0;
                MessageDigest digest = MessageDigest.getInstance("SHA-256");
                try {
                    int code = conn.getResponseCode();
                    if (code != 200) throw new IOException("GitHub respondió " + code + ".");
                    long total = conn.getContentLengthLong();
                    if (total > MAX_BYTES) throw new IOException("El archivo publicado es demasiado grande.");
                    try (InputStream in = conn.getInputStream(); OutputStream out = session.openWrite("waltra.apk", 0, total)) {
                        byte[] buffer = new byte[64 * 1024];
                        long lastNotice = 0;
                        int n;
                        while ((n = in.read(buffer)) != -1) {
                            done += n;
                            if (done > MAX_BYTES) throw new IOException("El archivo publicado es demasiado grande.");
                            out.write(buffer, 0, n);
                            digest.update(buffer, 0, n);
                            long now = System.currentTimeMillis();
                            if (now - lastNotice > 250) {
                                lastNotice = now;
                                progress(done, total);
                            }
                        }
                        session.fsync(out);
                    }
                    progress(done, total);
                } finally {
                    conn.disconnect();
                }
                if (sha256 != null && !sha256.isEmpty() && !sha256.equalsIgnoreCase(hex(digest.digest()))) {
                    throw new IOException("La descarga no coincide con la versión publicada.");
                }
                Intent intent = new Intent(context, SelfUpdateReceiver.class).setAction(SelfUpdateReceiver.ACTION_STATUS);
                int flags = PendingIntent.FLAG_UPDATE_CURRENT;
                // El instalador agrega el resultado al intent: tiene que poder modificarlo.
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) flags |= PendingIntent.FLAG_MUTABLE;
                PendingIntent pending = PendingIntent.getBroadcast(context, sessionId, intent, flags);
                session.commit(pending.getIntentSender());
            }
            call.resolve();
        } catch (Exception e) {
            if (sessionId != -1) {
                try {
                    installer.abandonSession(sessionId);
                } catch (Exception ignored) {
                    // La sesion ya no existe: no hay nada que limpiar.
                }
            }
            call.reject(e.getMessage() != null ? e.getMessage() : "No se pudo bajar la actualización.");
        }
    }

    private void progress(long done, long total) {
        JSObject data = new JSObject();
        data.put("done", done);
        data.put("total", total);
        notifyListeners("progress", data);
    }

    /** El instalador rechazo la version nueva. Si salio bien, la app ya se cerro. */
    static void failed(int status, String message) {
        SelfUpdatePlugin plugin = current;
        if (plugin == null) return;
        JSObject data = new JSObject();
        data.put("status", status);
        data.put("message", message != null ? message : "");
        plugin.notifyListeners("failed", data);
    }

    private static String hex(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) sb.append(String.format("%02x", b));
        return sb.toString();
    }
}
