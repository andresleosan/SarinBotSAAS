#!/bin/sh
# Start only an existing native Ollama installation; never source an env file.
set -eu

usage() {
  printf '%s\n' 'Uso: sh deploy/macos/serve-ollama.sh [--check] RUTA_ollama.env' >&2
  exit 2
}

check_only=0
if [ "${1-}" = '--check' ]; then check_only=1; shift; fi
[ "$#" -eq 1 ] || usage
[ "$(uname -s)" = 'Darwin' ] || { printf '%s\n' 'Este script requiere macOS y Ollama nativo.' >&2; exit 1; }
ollama_binary=$(command -v ollama 2>/dev/null || true)
case "$ollama_binary" in /*) ;; *) printf '%s\n' 'No se encontro un binario Ollama existente en PATH.' >&2; exit 1 ;; esac
[ -f "$ollama_binary" ] && [ -x "$ollama_binary" ] || { printf '%s\n' 'Ollama no es un archivo ejecutable.' >&2; exit 1; }
ollama_config=$1
[ -f "$ollama_config" ] && [ -r "$ollama_config" ] || { printf '%s\n' 'El archivo de configuracion no existe o no es legible.' >&2; exit 1; }

OLLAMA_HOST=127.0.0.1:11434
OLLAMA_NO_CLOUD=1
OLLAMA_NUM_PARALLEL=4
OLLAMA_MAX_LOADED_MODELS=1
OLLAMA_KEEP_ALIVE=-1
OLLAMA_FLASH_ATTENTION=1
OLLAMA_KV_CACHE_TYPE=q8_0
OLLAMA_CONTEXT_LENGTH=8192
OLLAMA_MAX_QUEUE=4
OLLAMA_DEBUG=0
line_number=0
carriage_return=$(printf '\r')
while IFS= read -r line || [ -n "$line" ]; do
  line_number=$((line_number + 1))
  line=${line%"$carriage_return"}
  case "$line" in ''|'#'*) continue ;; esac
  case "$line" in *=*) ;; *) printf 'Formato invalido en linea %s.\n' "$line_number" >&2; exit 1 ;; esac
  key=${line%%=*}
  value=${line#*=}
  # Every value is validated as data, with no eval, source or shell expansion.
  case "$key:$value" in
    OLLAMA_HOST:127.0.0.1:11434|OLLAMA_NO_CLOUD:1|OLLAMA_NUM_PARALLEL:[1-4]|OLLAMA_MAX_LOADED_MODELS:1|OLLAMA_KEEP_ALIVE:-1|OLLAMA_FLASH_ATTENTION:1|OLLAMA_KV_CACHE_TYPE:q8_0|OLLAMA_DEBUG:0) ;;
    OLLAMA_CONTEXT_LENGTH:4096|OLLAMA_CONTEXT_LENGTH:8192|OLLAMA_CONTEXT_LENGTH:16384) ;;
    OLLAMA_MAX_QUEUE:[1-4]) ;;
    *) printf 'Clave o valor no permitido en linea %s.\n' "$line_number" >&2; exit 1 ;;
  esac
  export "$key=$value"
done < "$ollama_config"

# Defend privacy even if the caller inherited unrelated OLLAMA_* variables.
if [ "$check_only" -eq 1 ]; then
  printf '%s\n' 'Configuracion valida: Ollama nativo, loopback, sin cloud, claves permitidas.'
  exit 0
fi
printf '%s\n' 'Iniciando Ollama nativo en 127.0.0.1:11434. Ctrl+C detiene este proceso.'
# A clean child environment does not inherit cloud keys, proxy configuration,
# debug flags or broad browser origins from the current shell.
exec env -i \
  "PATH=$PATH" "HOME=$HOME" "TMPDIR=${TMPDIR-/tmp}" \
  "OLLAMA_HOST=127.0.0.1:11434" "OLLAMA_NO_CLOUD=1" \
  "OLLAMA_NUM_PARALLEL=$OLLAMA_NUM_PARALLEL" "OLLAMA_MAX_LOADED_MODELS=1" \
  "OLLAMA_KEEP_ALIVE=-1" "OLLAMA_FLASH_ATTENTION=1" "OLLAMA_KV_CACHE_TYPE=q8_0" \
  "OLLAMA_CONTEXT_LENGTH=$OLLAMA_CONTEXT_LENGTH" "OLLAMA_MAX_QUEUE=$OLLAMA_MAX_QUEUE" \
  "OLLAMA_DEBUG=0" "$ollama_binary" serve
