#!/usr/bin/env bash
# Revisa que no se cuele ninguna credencial en los archivos versionados.
# Este repositorio es publico: se corre antes de cada commit.
set -u
PATTERN='sk-ant-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY|ghp_[A-Za-z0-9]{30,}|xox[baprs]-[A-Za-z0-9-]{10,}'
hits=$(git ls-files -z | xargs -0 grep -InE "$PATTERN" 2>/dev/null)
if [ -n "$hits" ]; then
  echo "Posibles credenciales en archivos versionados:"
  echo "$hits"
  exit 1
fi
# En el ejemplo de entorno, todo lo que huela a credencial va vacio.
# Un valor por defecto que no es secreto (el nombre del modelo) puede quedar.
if [ -f .env.example ] && grep -qE '^[A-Z_]*(KEY|TOKEN|SECRET|PASSWORD|PASS)[A-Z_]*=.+' .env.example; then
  echo ".env.example tiene una credencial cargada; deberia ir vacia."
  exit 1
fi
if git ls-files --error-unmatch .env .env.local >/dev/null 2>&1; then
  echo "Hay un archivo .env versionado."
  exit 1
fi
echo "Sin credenciales en el arbol versionado."
