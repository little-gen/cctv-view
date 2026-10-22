#!/usr/bin/env bash
# =============================================================================
# Restauración de copias de seguridad (ejecutar con sudo desde /opt/cctv/deploy)
#
#   sudo ./scripts/restore.sh --list
#   sudo ./scripts/restore.sh --db latest
#   sudo ./scripts/restore.sh --db cctv-20261020-030000.dump --files 20261020-030000
#   sudo ./scripts/restore.sh --files latest            (solo ficheros)
#
# Antes de restaurar se hace una copia de seguridad del estado actual.
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."
# Lee variables de .env sin ejecutarlo como shell (valores como "0 3 * * *" romperían un "source")
env_get() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- | tr -d '"'"'"'\r'; }
DATA_DIR=$(env_get DATA_DIR); DATA_DIR=${DATA_DIR:-/data}
POSTGRES_DB=$(env_get POSTGRES_DB)
POSTGRES_USER=$(env_get POSTGRES_USER)
[ -n "$POSTGRES_DB" ] && [ -n "$POSTGRES_USER" ] || { echo "Faltan POSTGRES_DB / POSTGRES_USER en .env" >&2; exit 1; }
BK="$DATA_DIR/backups"
COMPOSE=(docker compose)

# Los nombres llevan la fecha (AAAAMMDD-HHMMSS): el orden del glob es cronológico
list_dumps() { local f; for f in "$BK"/db/cctv-*.dump; do [ -e "$f" ] && basename "$f"; done; }
list_snaps() { local d; for d in "$BK"/files/2*/; do d=${d%/}; case "$d" in *.partial) ;; *) [ -d "$d" ] && basename "$d" ;; esac; done; }

DB="" FILES="" YES=0
while [ $# -gt 0 ]; do
  case "$1" in
    --db) DB=$2; shift 2 ;;
    --files) FILES=$2; shift 2 ;;
    --yes|-y) YES=1; shift ;;
    --list)
      echo "Volcados de BD ($BK/db):";                      list_dumps | tail -n 30
      echo; echo "Instantáneas de ficheros ($BK/files):"; list_snaps | tail -n 30
      exit 0 ;;
    *) echo "Uso: $0 [--list] [--db <fichero|latest>] [--files <instantánea|latest>] [--yes]"; exit 1 ;;
  esac
done
[ "$(id -u)" = 0 ] || { echo "Ejecuta con sudo"; exit 1; }
[ -n "$DB$FILES" ] || { echo "Indica --db y/o --files (o --list)"; exit 1; }

[ "$DB" = "latest" ] && DB=$(list_dumps | tail -n 1)
[ "$FILES" = "latest" ] && FILES=$(list_snaps | tail -n 1)
[ -z "$DB" ] || [ -f "$BK/db/$DB" ] || { echo "No existe $BK/db/$DB"; exit 1; }
[ -z "$FILES" ] || [ -d "$BK/files/$FILES" ] || { echo "No existe $BK/files/$FILES"; exit 1; }

echo "Se va a restaurar:"
[ -n "$DB" ] && echo "  Base de datos:  $DB   (SE BORRA la base de datos actual \"$POSTGRES_DB\")"
[ -n "$FILES" ] && echo "  Ficheros:       $FILES (SE SUSTITUYEN plans, uploads y documents)"
if [ $YES = 0 ]; then
  read -r -p "Escribe RESTAURAR para continuar: " answer
  [ "$answer" = "RESTAURAR" ] || { echo "Cancelado"; exit 1; }
fi

echo "==> Copia de seguridad del estado actual"
"${COMPOSE[@]}" exec -T backup backup.sh || echo "AVISO: no se pudo hacer la copia previa"

echo "==> Deteniendo el backend"
"${COMPOSE[@]}" stop backend

if [ -n "$DB" ]; then
  echo "==> Restaurando la base de datos desde $DB"
  "${COMPOSE[@]}" exec -T backup sh -ec "
    psql -d postgres -v ON_ERROR_STOP=1 \
      -c 'DROP DATABASE IF EXISTS \"$POSTGRES_DB\" WITH (FORCE);' \
      -c 'CREATE DATABASE \"$POSTGRES_DB\" OWNER \"$POSTGRES_USER\";'
    pg_restore --no-owner --role=\"$POSTGRES_USER\" --exit-on-error -d \"$POSTGRES_DB\" /backups/db/$DB
  "
fi

if [ -n "$FILES" ]; then
  echo "==> Restaurando ficheros desde la instantánea $FILES"
  for d in plans uploads documents; do
    [ -d "$BK/files/$FILES/$d" ] && rsync -a --delete "$BK/files/$FILES/$d/" "$DATA_DIR/$d/"
  done
  chown -R 1000:1000 "$DATA_DIR/plans" "$DATA_DIR/uploads" "$DATA_DIR/documents"
fi

echo "==> Arrancando el backend (aplica migraciones pendientes)"
"${COMPOSE[@]}" up -d backend
for _ in $(seq 1 40); do
  status=$(docker inspect -f '{{.State.Health.Status}}' "$("${COMPOSE[@]}" ps -q backend)" 2>/dev/null || true)
  [ "$status" = "healthy" ] && { echo "Restauración completada"; exit 0; }
  sleep 3
done
echo "El backend no está sano: docker compose logs backend"; exit 1
