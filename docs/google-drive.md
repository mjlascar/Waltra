# Google y sincronización sin servidor

Waltra guarda la cartera en IndexedDB y, si el usuario conecta Google, sincroniza
una copia en **su propio Google Drive**. No necesita Firebase, un backend, una
base de datos compartida ni alojar un servicio para guardar carteras. El APK
sigue ejecutándose completamente en el teléfono. La versión web conserva su
forma habitual de ejecución; esta integración no exige desplegarla.

## Configuración única de la aplicación

Esto lo hace quien distribuye Waltra una sola vez, no cada usuario:

1. Crear un proyecto en [Google Cloud Console](https://console.cloud.google.com/)
   y habilitar **Google Drive API**. El proyecto identifica la aplicación OAuth;
   no aloja los datos de los usuarios.
2. En Google Auth Platform, configurar Branding, Audience y Data Access.
   Solicitar únicamente `openid`, `email`, `profile` y
   `https://www.googleapis.com/auth/drive.appdata`. En modo Testing, agregar las
   cuentas que van a probar a Test users. Para distribuir a otros usuarios,
   publicar la aplicación OAuth y completar los requisitos que indique Google.
3. Crear un cliente OAuth de tipo **Web application**. Para probar la web,
   registrar los orígenes exactos usados, por ejemplo `http://localhost:3000`
   y `http://127.0.0.1:3000`. El cliente Web también se usa como audiencia del
   login Android. No hace falta configurar un servidor de callback para este flujo.
4. Copiar `.env.example` a `.env.local` y completar
   `NEXT_PUBLIC_GOOGLE_CLIENT_ID` con ese cliente Web. No usar el ID de Android.
   No agregar un client secret ni una cuenta de servicio.
5. Para Android, crear además un cliente OAuth de tipo **Android** en el mismo
   proyecto: paquete `app.waltra` y SHA-1 del certificado que realmente firma
   el APK. Registrar cada firma que se vaya a usar: debug, release y Play App
   Signing si corresponde. El ID de Android solo se registra en Google Cloud.
   No se necesita `google-services.json` ni Firebase.
6. Reiniciar el servidor de desarrollo o recompilar. `NEXT_PUBLIC_*` queda
   incluido al compilar, también en el APK. Para Actions, configurar la variable
   del repositorio `GOOGLE_CLIENT_ID`; el workflow la pasa a los builds.
7. Abrir **Ajustes → Cuenta y sincronización → Conectar Google Drive** y aceptar
   el acceso al espacio de Waltra. Cada usuario elige su cuenta y sus datos se
   guardan exclusivamente en ella.

Para obtener la SHA-1 desde un APK firmado:

```powershell
keytool -printcert -jarfile ruta/al/waltra.apk
```

Para preparar el APK después de configurar Google:

```powershell
$env:WALTRA_NATIVE = '1'
npx next build
npx cap sync android
```

Después se compila Android con JDK 21 y el SDK que ya requiere el repositorio.
La firma debe ser estable: una firma descartable exige registrar una nueva
SHA-1 y también impide actualizar un APK anterior conservando sus datos.

## Qué se guarda y cuándo

- Se sincronizan cuentas, activos, movimientos, perfil, preferencias e informes.
  Las eliminaciones forman parte de la copia completa.
- Las claves de Anthropic, Gemini y de acceso al servidor nunca se incluyen.
  Los precios y cotizaciones se regeneran en cada equipo, sin subir su caché.
- Se sincroniza al conectar, después de editar datos, al recuperar conexión y
  al volver a la app. Mientras está visible se revisa Drive cada minuto. No hay
  ejecución de sincronización con el APK cerrado.
- En web, el token OAuth solo vive en memoria. Al recargar, cerrar la app o
  vencer el token, hay que reconectar desde un toque del usuario. Google no
  ofrece renovación automática de este flujo sin servidor.
- Android puede restaurar una sesión vigente mediante el SDK nativo. Si el
  permiso vence o se revoca, la app pide reconectar; los cambios quedan locales.
- Se conserva **un archivo de hasta 5 MiB por usuario**, sin historial remoto.
  Se comprueba el tamaño UTF-8 antes de consultar/subir y durante la descarga,
  incluso si Google no envía `Content-Length`. Los metadatos admiten hasta 64 KiB.
  Si se supera el límite o Drive rechaza el pedido, se conservan los datos locales.

## Conflictos y recuperación

La copia es `waltra.json` en la **carpeta oculta `appDataFolder` del Drive del
usuario**. No aparece en Mi unidad ni se comparte con otras personas.
Al sincronizar se sobrescribe ese mismo archivo mediante Drive API v2,
`files.update` con `newRevision=false` y `pinned=false`: reemplaza el contenido
actual sin crear archivos ni revisiones por cada edición. Se usa v2 porque v3
no expone la opción para reemplazar el blob sin generar una revisión.

El ETag identifica la revisión leída. La subida lleva `If-Match`; si otro equipo
modificó el archivo, una respuesta 412 deja los cambios pendientes y obliga a
releer. Una resolución de conflicto también comprueba el ETag, aunque siga
siendo el mismo archivo. La configuración real debe validar este contrato con Google.

Drive no ofrece una creación única por nombre. Si dos instalaciones crean la
primera copia exactamente a la vez, pueden existir duplicados temporales. Se
detectan al releer y se consolidan después de elegir una versión, con borrado
condicionado a sus ETags. No se publica automáticamente sobre datos distintos.
Se examinan hasta tres copias (máximo 15 MiB de contenido en ese caso excepcional);
si hay más o hay páginas adicionales, se detiene sin subir ni borrar. Este
control no representa una cuota atómica del proveedor frente a creaciones simultáneas.

Si la base local y Drive cambiaron desde la última sincronización, la app pausa
la sincronización. El usuario elige conservar el dispositivo o una versión de
Drive. Una decisión se vuelve a comprobar contra las versiones actuales antes
de aplicarla. Elegir una versión completa no combina movimientos de las otras.

Antes de reemplazar datos locales, se guarda una copia sin credenciales en
IndexedDB. Se conserva **una sola copia de recuperación**, reemplazable y de
hasta 5 MiB; se puede exportar desde la pantalla de cuenta e importar desde Tus
datos, incluidos los informes. Sigue siendo recomendable
exportar un archivo propio antes de resolver un conflicto.

No se conservan versiones anteriores en Drive. El usuario puede borrar los datos
de Waltra desde la administración de aplicaciones de Drive. Si la copia ya
sincronizada desaparece, Waltra pregunta antes de recrearla.

La primera cuenta queda vinculada a esta instalación. Conectar otra cuenta no
sube la cartera anterior a ella. Para empezar con otra cuenta, exportar antes
los datos y limpiar el almacenamiento de la aplicación/navegador. Desconectar
por sí solo pausa la sincronización y conserva la cartera en el dispositivo;
no es un bloqueo de acceso local. Borrar datos desde Tus datos, estando conectado,
sincroniza la cartera vacía, reemplazando la copia remota anterior.

## Validación y límites

Los tests de `src/lib/cloud/__tests__` ejercitan IndexedDB y el contrato HTTP de
Drive con respuestas controladas. Protegen credenciales, conflictos, cambios en
vuelo, desconexión y separación de cuentas. No sustituyen probar Google real.

Para validar la configuración completa: conectar una cuenta de prueba, cargar un
movimiento, abrir un segundo equipo con esa misma cuenta, comprobar descarga,
editar sin conexión, reconectar y resolver un cambio simultáneo. Repetir en un
APK firmado con su SHA-1 registrada. El cliente OAuth, su consentimiento y las
llamadas reales a Google requieren configuración externa.

Referencias: [datos privados de la app en Drive](https://developers.google.com/workspace/drive/api/guides/appdata),
[OAuth sin backend en el navegador](https://developers.google.com/identity/oauth2/web/guides/use-token-model),
[sobrescritura sin revisiones](https://developers.google.com/workspace/drive/api/reference/rest/v2/files/update),
[login Google en Android](https://capgo.app/docs/plugins/social-login/google/android/).
