#!/bin/sh
# =============================================================================
# Copia de seguridad diaria
#   /backups/db/cctv-AAAAMMDD-HHMMSS.dump   pg_dump formato custom (comprimido)
#   /backups/files/AAAAMMDD-HHMMSS/         instantánea de plans, uploads y documents
#                                          (rsync --link-dest: los ficheros sin cambios
#                                          son enlaces duros, solo ocupa lo nuevo)
#   /backups/metrics/backup.prom            métricas para Prometheus (node-exporter)
# Ejecución manual:  docker compose exec backup backup.sh
# =============================================================================
set -eu

TS=$(date +%Y%m%d-%H%M%S)
DB_DIR=/backups/db
FILES_DIR=/backups/files
METRICS=/backups/metrics/backup.prom
RETENTION=${BACKUP_RETENTION_DAYS:-14}
FILES_RETENTION=${BACKUP_FILES_RETENTION_DAYS:-14}
START=$(date +%s)

log() { echo "[backup $(date '+%F %T')] $*"; }

write_metrics() { # $1 = 1 éxito / 0 fallo
  tmp="$METRICS.$$"
  {
    echo "# HELP cctv_backup_success Resultado de la última copia (1 = correcta)"
    echo "# TYPE cctv_backup_success gauge"
    echo "cctv_backup_success $1"
    echo "# HELP cctv_backup_duration_seconds Duración de la última copia"
    echo "# TYPE cctv_backup_duration_seconds gauge"
    echo "cctv_backup_duration_seconds $(( $(date +%s) - START ))"
    if [ "$1" = 1 ]; then
      echo "# HELP cctv_backup_last_success_timestamp_seconds Fecha de la última copia correcta"
      echo "# TYPE cctv_backup_last_success_timestamp_seconds gauge"
      echo "cctv_backup_last_success_timestamp_seconds $(date +%s)"
      echo "# HELP cctv_backup_db_size_bytes Tamaño del último volcado de la BD"
      echo "# TYPE cctv_backup_db_size_bytes gauge"
      echo "cctv_backup_db_size_bytes $(stat -c %s "$DB_DIR/cctv-$TS.dump")"
    elif [ -f "$METRICS" ]; then
      grep -E '^cctv_backup_(last_success_timestamp_seconds|db_size_bytes) ' "$METRICS" || true
    fi
  } > "$tmp" && mv "$tmp" "$METRICS"
}
trap 'write_metrics 0; log "ERROR: la copia ha fallado"' EXIT

mkdir -p "$DB_DIR" "$FILES_DIR" "$(dirname "$METRICS")"

# --- Base de datos
log "Volcando la base de datos $PGDATABASE…"
pg_dump --format=custom --compress=6 --no-owner --file="$DB_DIR/cctv-$TS.dump.partial"
# Verificación: el índice del volcado debe poder leerse
pg_restore --list "$DB_DIR/cctv-$TS.dump.partial" > /dev/null
mv "$DB_DIR/cctv-$TS.dump.partial" "$DB_DIR/cctv-$TS.dump"
log "BD: $(du -h "$DB_DIR/cctv-$TS.dump" | cut -f1)"

# --- Ficheros (planos, fotos, documentos)
if [ "${BACKUP_FILES:-true}" = "true" ]; then
  LAST=""
  for d in "$FILES_DIR"/2*; do # orden cronológico por el nombre
    case "$d" in *.partial) ;; *) [ -d "$d" ] && LAST=$d ;; esac
  done
  LINK=""
  [ -n "$LAST" ] && LINK="--link-dest=$LAST"
  log "Instantánea de ficheros${LAST:+ (incremental sobre $(basename "$LAST"))}…"
  # Las teselas de zoom (plans/tiles) no se copian: se regeneran desde el original
  # shellcheck disable=SC2086
  rsync -a $LINK --exclude=/plans/tiles/ /data/plans /data/uploads /data/documents "$FILES_DIR/$TS.partial/"
  mv "$FILES_DIR/$TS.partial" "$FILES_DIR/$TS"
  log "Ficheros: $(du -sh "$FILES_DIR/$TS" | cut -f1) (lo nuevo respecto a la anterior)"
fi

# --- Retención
find "$DB_DIR" -name 'cctv-*.dump' -mtime +"$RETENTION" -print -delete | sed 's/^/[backup] eliminado /'
find "$DB_DIR" -name '*.partial' -mmin +360 -delete
# Instantáneas: por la fecha del nombre (rsync -a conserva mtimes y no son fiables)
CUTOFF=$(date -d "@$(( $(date +%s) - FILES_RETENTION * 86400 ))" +%Y%m%d)
for d in "$FILES_DIR"/2*; do
  [ -d "$d" ] || continue
  case "$d" in *.partial) continue ;; esac
  name=$(basename "$d")
  if [ "${name%%-*}" -lt "$CUTOFF" ]; then rm -rf "$d"; log "eliminada instantánea $name"; fi
done
find "$FILES_DIR" -mindepth 1 -maxdepth 1 -type d -name '*.partial' -mmin +360 -exec rm -rf {} +

trap - EXIT
write_metrics 1
log "Copia completada en $(( $(date +%s) - START )) s"
