#!/bin/sh
# Programa backup.sh con el cron de busybox según BACKUP_SCHEDULE (hora local de TZ)
set -eu

SCHEDULE="${BACKUP_SCHEDULE:-0 3 * * *}"
mkdir -p /backups/db /backups/files /backups/metrics

# Exporta el entorno para que el cron lo vea (pg_dump necesita PGHOST, PGPASSWORD...)
env | grep -E '^(PG|BACKUP_|TZ=)' | sed 's/^/export /; s/=\(.*\)$/="\1"/' > /etc/backup.env
chmod 600 /etc/backup.env

echo "$SCHEDULE . /etc/backup.env && /usr/local/bin/backup.sh >> /proc/1/fd/1 2>&1" > /etc/crontabs/root
echo "[backup] programado: '$SCHEDULE' (TZ=${TZ:-UTC}). Copia manual: docker compose exec backup backup.sh"

exec crond -f -l 8
