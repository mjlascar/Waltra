package app.waltra;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

/**
 * Despues de actualizarse, Android cierra la app y no la vuelve a abrir: no
 * deja que una app arranque sola desde segundo plano. Esta notificacion dice
 * que termino y la abre con un toque, para que no parezca que se cerro sola.
 *
 * Esta exportado porque MY_PACKAGE_REPLACED lo manda el sistema, y es un
 * broadcast protegido: otra app no puede mandarlo. Solo muestra un aviso.
 */
public class UpdatedReceiver extends BroadcastReceiver {

    private static final String CHANNEL = "actualizaciones";
    private static final int ID = 4271;

    @Override
    public void onReceive(Context context, Intent intent) {
        if (!Intent.ACTION_MY_PACKAGE_REPLACED.equals(intent.getAction())) return;
        if (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(CHANNEL, "Actualizaciones", NotificationManager.IMPORTANCE_DEFAULT);
            context.getSystemService(NotificationManager.class).createNotificationChannel(channel);
        }
        Intent open = new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent tap = PendingIntent.getActivity(context, ID, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        String version = "";
        try {
            version = " a la " + context.getPackageManager().getPackageInfo(context.getPackageName(), 0).versionName;
        } catch (PackageManager.NameNotFoundException ignored) {
            // Sin el numero, el aviso igual sirve.
        }
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_waltra)
            .setContentTitle("Waltra se actualizó" + version)
            .setContentText("Tocá para abrirla.")
            .setContentIntent(tap)
            .setAutoCancel(true);
        try {
            NotificationManagerCompat.from(context).notify(ID, builder.build());
        } catch (SecurityException ignored) {
            // Se revoco el permiso de notificaciones justo ahora: no hay aviso.
        }
    }
}
