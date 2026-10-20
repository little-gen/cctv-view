# Contenedor de copias de seguridad: pg_dump (misma versión mayor que el servidor) + rsync + cron
FROM postgres:17-alpine
RUN apk add --no-cache rsync tzdata
COPY entrypoint.sh backup.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/entrypoint.sh /usr/local/bin/backup.sh
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
