#!/usr/bin/env bash
#
# Genera la clave con la que se firma el APK y deja listos los cuatro secretos
# del repositorio.
#
# Por que existe: Android identifica una app por su paquete Y su firma. Sin una
# clave estable, cada compilacion de CI usa una descartable distinta, el APK
# nuevo no se instala encima del viejo, hay que desinstalar, y desinstalar
# BORRA TODOS LOS MOVIMIENTOS. Esto se hace una sola vez y el problema no
# vuelve.
#
#   ./scripts/firma.sh              # deja la clave en ~/waltra-firma/
#   ./scripts/firma.sh /otra/ruta   # o donde vos quieras
#
set -euo pipefail

DESTINO="${1:-$HOME/waltra-firma}"
ARCHIVO="$DESTINO/waltra.keystore"
ALIAS="waltra"

# El repositorio es publico: la clave no puede terminar adentro ni por error.
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ABS_DESTINO="$(mkdir -p "$DESTINO" && cd "$DESTINO" && pwd)"
case "$ABS_DESTINO/" in
  "$REPO"/*)
    echo "ERROR: $ABS_DESTINO esta adentro del repositorio, que es publico." >&2
    echo "Elegi una carpeta de afuera, por ejemplo ~/waltra-firma." >&2
    exit 1
    ;;
esac

# Pisar un keystore existente es perder la clave: si ya firmaste un APK con
# ella, ninguna version futura se instala encima nunca mas.
if [ -e "$ARCHIVO" ]; then
  echo "Ya hay una clave en $ARCHIVO." >&2
  echo "No la piso: si es la que usaste para firmar, perderla te obliga a" >&2
  echo "desinstalar la app (y perder los movimientos) para actualizar." >&2
  echo "Si de verdad queres una nueva, movela o borrala a mano primero." >&2
  exit 1
fi

if ! command -v keytool >/dev/null 2>&1; then
  echo "Falta keytool, que viene con el JDK." >&2
  echo "En Debian/Ubuntu: sudo apt install default-jdk-headless" >&2
  echo "En macOS con Homebrew: brew install openjdk" >&2
  exit 1
fi

# Contrasena al azar: no hay que recordarla, vive en los secretos del repo y
# en el archivo que guardes vos.
if command -v openssl >/dev/null 2>&1; then
  PASS="$(openssl rand -base64 24 | tr -d '\n/+=' | cut -c1-24)"
else
  PASS="$(head -c 32 /dev/urandom | base64 | tr -d '\n/+=' | cut -c1-24)"
fi

umask 077
keytool -genkeypair \
  -keystore "$ARCHIVO" \
  -alias "$ALIAS" \
  -keyalg RSA -keysize 4096 \
  -validity 10000 \
  -storepass "$PASS" -keypass "$PASS" \
  -dname "CN=Waltra, OU=Personal, O=Waltra, L=Buenos Aires, C=AR" \
  >/dev/null 2>&1

if base64 --help 2>&1 | grep -q -- "-w"; then
  B64="$(base64 -w0 "$ARCHIVO")"     # GNU coreutils
else
  B64="$(base64 -i "$ARCHIVO" | tr -d '\n')"  # macOS
fi

SALIDA="$DESTINO/secretos-github.txt"
{
  echo "ANDROID_KEYSTORE_BASE64"
  echo "$B64"
  echo
  echo "ANDROID_KEYSTORE_PASSWORD"
  echo "$PASS"
  echo
  echo "ANDROID_KEY_ALIAS"
  echo "$ALIAS"
  echo
  echo "ANDROID_KEY_PASSWORD"
  echo "$PASS"
} > "$SALIDA"
chmod 600 "$SALIDA"

cat <<FIN

Clave creada en $ARCHIVO
Los cuatro valores quedaron en $SALIDA

Que hacer ahora, una sola vez:

  1. Abri  https://github.com/mjlascar/Waltra/settings/secrets/actions
  2. "New repository secret", cuatro veces, con los nombres y valores que
     estan en $SALIDA
  3. Volve a pushear cualquier cosa para que CI compile firmando con ella

Desde ese momento cada APK nuevo se instala ENCIMA del anterior y los
movimientos quedan donde estan.

IMPORTANTE

  - Guarda $ARCHIVO fuera de la compu tambien (Drive, un pendrive, donde sea).
    Si se pierde, la unica salida es desinstalar la app, y eso borra la base.
  - No lo copies adentro del repositorio: es publico.
  - La primera actualizacion despues de configurar esto TODAVIA pide
    desinstalar, porque la version que tenes hoy esta firmada con otra clave.
    Exporta el backup antes: Ajustes -> Tus datos -> Exportar.

FIN
