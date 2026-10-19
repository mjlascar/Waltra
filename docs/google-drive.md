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

- Se sincronizan cuentas, activos, movimientos —con sus notas y la frase con
  que se cargaron—, perfil, preferencias e informes. La app no cifra la copia
  aparte: la protege la cuenta de Google del usuario, igual que un backup
  exportado a Drive. La pantalla lo dice antes de conectar.
- Las claves de Anthropic, Gemini y de acceso al servidor nunca se incluyen, ni
  lo que es de cada teléfono (`LOCAL_SETTINGS` en `src/lib/cloud/data.ts`): el
  proveedor y el modelo de los informes, que van con esas claves, la apariencia
  y la vibración. Los precios y cotizaciones se regeneran en cada equipo, sin
  subir su caché.
- Se sincroniza al conectar, después de editar datos, al recuperar conexión y
  al volver a la app. Mientras está visible se revisa Drive cada minuto; si la
  revisión de Drive es la misma de la última sincronización, no se baja nada.
  No hay sincronización con el APK cerrado.
- En web, el token OAuth solo vive en memoria. Al recargar, cerrar la app o
  vencer el token hay que reconectar con un toque: sin un servidor, Google no
  da otro token solo. Lo que se cargue mientras tanto se combina al reconectar.
- En el APK la sesión se renueva sola mientras la app está abierta y se retoma
  al abrirla, salvo que el usuario haya tocado _Desconectar_. Usa `refresh` del
  plugin, que no muestra nada si la cuenta ya dio el permiso. Si el permiso se
  revocó, la app pide reconectar; los cambios quedan locales.
- Se conserva **un archivo de hasta 5 MiB por usuario**, sin historial remoto.
  Se comprueba el tamaño UTF-8 antes de consultar/subir y durante la descarga,
  incluso si Google no envía `Content-Length`. Los metadatos admiten hasta 64 KiB.
  Si se supera el límite o Drive rechaza el pedido, se conservan los datos locales.

## Formato y versiones de la app

La copia se valida con un esquema que tiene dos versiones: al subir se
descarta lo que no está en la lista; al bajar se rechaza. Un campo o un valor
desconocido viene de un teléfono con una versión más nueva de Waltra, y
descartarlo y después subir se lo borraría a ese teléfono. Por eso la versión
vieja frena, pide actualizar la app y no toca nada. Un test de paridad no
compila si un tipo sincronizado gana un campo que el esquema no tiene. Un
campo sincronizado no se saca nunca del esquema: las copias que ya lo tienen
se leerían como de una versión más nueva.

## Cómo se combinan dos equipos

Cada instalación guarda la última copia que confirmó con Drive (la _base_).
Al sincronizar, lo que cambió de un solo lado desde la base se toma de ese
lado —altas, ediciones y borrados—, así que cargar movimientos en dos equipos
sin conexión no obliga a elegir entre ellos. La historia es lineal: cada
subida lleva `If-Match` sobre la revisión leída, y un 412 deja los cambios
pendientes para la próxima pasada. La configuración real debe validar este
contrato con Google.

Con el mismo contenido gana la fila de Drive, aunque las marcas de tiempo
difieran: si cada equipo se quedara con la suya, se la subirían uno al otro
para siempre. Y la base tiene que ser siempre el ancestro común: después de
una subida aceptada que no se pudo aplicar en el equipo (hubo cambios mientras
subía, o se desconectó), la base pasa a ser la copia local de la que salió.
Para la respuesta que se pierde o la app que se cierra, el archivo lleva
`chain`, los ids de las últimas subidas que lo produjeron, y cada equipo anota
el id de la suya antes de subir: si después lo encuentra en la cadena, la
subida llegó, aunque otro equipo haya subido encima. Sin eso, lo que se borra
justo después de cargarlo volvería como si lo hubiera agregado otro equipo. La
cadena recuerda 500 subidas y sigue solo cuando lo que se sube sale de esa
copia: quedarse con los datos de un equipo entero empieza una nueva.

La sincronización se pausa y pregunta solo en estos casos:

- **Lo mismo cambió distinto en los dos lados**: un movimiento, una cuenta, un
  activo, un informe o un campo del perfil. Las opciones combinan todo lo demás
  y dejan que un lado gane lo que choca.
- **Un ajuste o un split de un activo que el otro lado también tocó.** Un ajuste
  anota la diferencia de ese día contra el broker y un split reemplaza los del
  activo: sumados a operaciones cargadas en el otro equipo, cuentan las
  unidades dos veces. Ahí lo que choca es el activo entero.
- **Combinar dejaría un movimiento apuntando a una cuenta o un activo que el
  otro lado borró**: se elige un lado entero.
- **Un borrado grande**, en cualquiera de las dos direcciones: el resultado se
  lleva todos los movimientos de una cartera con tres o más, o más de la mitad
  de una con diez o más. Es lo que hace _Borrar todo_, o una base que se perdió
  a medias. Los datos de ejemplo no cuentan: se limpian de a muchos a propósito.
- **La primera conexión, con datos en los dos lados.** (Si uno de los dos está
  vacío, no hay nada que preguntar: baja la copia, o se reemplaza la vacía.)
  Sin una base común, juntar
  puede repetir lo que se cargó por separado en cada uno: se ofrece, pero no se
  hace solo, y solo si nada choca.
- **La copia de Drive desapareció** después de haber sincronizado: no se vuelve
  a crear sin preguntar.

El mismo activo dado de alta sin conexión en los dos equipos (los ids son
aleatorios) queda uno solo —el que ya estaba en Drive—, con los movimientos de
los dos. Una decisión se
vuelve a comprobar contra las versiones actuales antes de aplicarla: si algo
cambió en el medio, se vuelve a preguntar, o se combina solo si ya se puede.

Drive no ofrece una creación única por nombre. Si dos instalaciones crean la
primera copia exactamente a la vez, pueden existir duplicados temporales. Se
detectan al releer y se consolidan después de elegir una versión, con borrado
condicionado a sus ETags. No se publica automáticamente sobre datos distintos.
Se examinan hasta tres copias (máximo 15 MiB de contenido en ese caso excepcional);
si hay más o hay páginas adicionales, se detiene sin subir ni borrar. Este
control no representa una cuota atómica del proveedor frente a creaciones simultáneas.

## Recuperación

La copia es `waltra.json` en la **carpeta oculta `appDataFolder` del Drive del
usuario**. No aparece en Mi unidad ni se comparte con otras personas. Se
sobrescribe ese mismo archivo con Drive API v2, `files.update` con
`newRevision=false` y `pinned=false`: reemplaza el contenido sin crear archivos
ni revisiones por cada edición. Se usa v2 porque v3 no expone la opción para
reemplazar el blob sin generar una revisión.

Como Drive no conserva versiones, antes de pisar algo que se pierde se guarda
una copia en IndexedDB: la del dispositivo antes de reemplazar sus datos, y la
de Drive antes de subir. "Algo que se pierde" es lo que un lado agregó o editó
y el resultado deja afuera, o los datos de un borrado grande que se confirmó;
una combinación que no pierde nada no deja copias, para no desplazar las
útiles. Se conservan **las últimas tres**, sin credenciales. Se exportan desde
la pantalla de cuenta y se importan desde _Tus datos_, que suma sin borrar.

El usuario puede borrar los datos de Waltra desde la administración de
aplicaciones de Drive.

## Cuenta vinculada

La instalación queda vinculada a la cuenta con que sincroniza por primera vez:
su identificador de Google, no el cliente OAuth, así que cambiar de proyecto en
Google Cloud no deja a nadie trabado (el Drive nuevo aparece vacío y se
pregunta). Conectar otra cuenta no sube la cartera a ella.

_Desconectar_ pausa la sincronización y conserva todo. _Desvincular_ olvida la
cuenta y la base: los datos quedan en el dispositivo y en ese Drive, y la
próxima conexión es una primera conexión. _Borrar todo_ no desvincula; con
Google conectado, la app pregunta antes de vaciar también la copia de Drive.

## Validación y límites

Los tests de `src/lib/cloud/__tests__` ejercitan la combinación, IndexedDB y el
contrato HTTP de Drive con respuestas controladas: credenciales, conflictos,
borrados grandes, copias de recuperación, cambios en vuelo, desconexión,
desvinculación y versiones de la app.

`npm run e2e:drive` recorre la pantalla con dos teléfonos contra un Drive en
memoria y un Google simulado: conectar, bajar en un equipo nuevo, combinar,
frenar un _Borrar todo_, resolver un choque y desvincular. Necesita la app
levantada con un cliente de mentira:

```bash
NEXT_PUBLIC_GOOGLE_CLIENT_ID=prueba.apps.googleusercontent.com WALTRA_MOCK=1 npm run dev
```

Nada de eso sustituye probar Google real: conectar una cuenta de prueba, cargar
un movimiento, abrir un segundo equipo con esa misma cuenta, comprobar la
descarga, editar sin conexión en los dos, reconectar y resolver un cambio
simultáneo. Repetirlo en un APK firmado con su SHA-1 registrada, dejándolo
abierto más de una hora para ver la renovación del token.

Referencias: [datos privados de la app en Drive](https://developers.google.com/workspace/drive/api/guides/appdata),
[OAuth sin backend en el navegador](https://developers.google.com/identity/oauth2/web/guides/use-token-model),
[sobrescritura sin revisiones](https://developers.google.com/workspace/drive/api/reference/rest/v2/files/update),
[login Google en Android](https://capgo.app/docs/plugins/social-login/google/android/).
