package app.waltra;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import androidx.core.content.IntentCompat;

/**
 * La respuesta del instalador de Android a una actualizacion.
 *
 * No esta exportado: solo le llega el intent que arma SelfUpdatePlugin. Si
 * otra app pudiera mandarle uno con "falta confirmar", lo haria abrir la
 * actividad que quisiera.
 */
public class SelfUpdateReceiver extends BroadcastReceiver {

    static final String ACTION_STATUS = "app.waltra.SELF_UPDATE_STATUS";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (!ACTION_STATUS.equals(intent.getAction())) return;
        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            // Android pide confirmar: muestra su dialogo. Pasa la primera vez en
            // algunos telefonos, y siempre antes de Android 12.
            Intent confirm = IntentCompat.getParcelableExtra(intent, Intent.EXTRA_INTENT, Intent.class);
            if (confirm != null) {
                confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(confirm);
            }
            return;
        }
        if (status != PackageInstaller.STATUS_SUCCESS) {
            SelfUpdatePlugin.failed(status, intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE));
        }
    }
}
