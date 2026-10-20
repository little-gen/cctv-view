#!/usr/bin/env bash
# =============================================================================
# Actualización controlada de PlanosCámaras
#   ./scripts/update.sh            git pull (si hay cambios) + compose pull + up
#   ./scripts/update.sh --force    reconstruye las imágenes aunque no haya cambios
#
#  1. git fetch: ¿hay commits nuevos en la rama?
#  2. docker compose pull: imágenes de terceros (postgres, nginx, certbot)
#  3. Si hay código nuevo: copia de seguridad previa, git pull --ff-only y build
#     (guardando las imágenes actuales como :rollback)
#  4. docker compose up -d: solo se recrean los contenedores que cambian
#  5. Espera a que backend, frontend y nginx estén "healthy"
#  6. Si falla: vuelve al commit y a las imágenes anteriores
# Lo ejecuta el timer systemd cctv-update.timer (04:30) o manualmente.
# =============================================================================
set -euo pipefail

DEPLOY_DIR=$(cd "$(dirname "$0")/.." && pwd)
REPO_DIR=$(dirname "$DEPLOY_DIR")
cd "$DEPLOY_DIR"
COMPOSE=(docker compose)
[ -f docker-compose.monitoring.yml ] && [ "${WITH_MONITORING:-$(cat .monitoring 2>/dev/null || echo 0)}" = "1" ] \
  && COMPOSE+=(-f docker-compose.yml -f docker-compose.monitoring.yml)

log() { echo "[update $(date '+%F %T')] $*"; }
die() { log "ERROR: $*"; exit 1; }

# Una sola ejecución a la vez
exec 9>"/tmp/cctv-update.lock"
flock -n 9 || { log "Ya hay una actualización en curso"; exit 0; }

FORCE=0
[ "${1:-}" = "--force" ] && FORCE=1

wait_healthy() {
  local deadline=$(( $(date +%s) + 240 ))
  for svc in backend frontend nginx; do
    while :; do
      local cid status
      cid=$("${COMPOSE[@]}" ps -q "$svc")
      status=$([ -n "$cid" ] && docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" || echo missing)
      [ "$status" = "healthy" ] && break
      [ "$(date +%s)" -gt "$deadline" ] && { log "$svc no está sano (estado: $status)"; return 1; }
      sleep 5
    done
    log "$svc: healthy"
  done
}

# ------------------------------------------------------------------ 1. git
BRANCH=$(git -C "$REPO_DIR" rev-parse --abbrev-ref HEAD)
[ -z "$(git -C "$REPO_DIR" status --porcelain --untracked-files=no)" ] \
  || die "Hay cambios locales sin confirmar en $REPO_DIR; no se actualiza"
git -C "$REPO_DIR" fetch --quiet origin "$BRANCH"
OLD=$(git -C "$REPO_DIR" rev-parse HEAD)
NEW=$(git -C "$REPO_DIR" rev-parse "origin/$BRANCH")
CODE_CHANGED=0
[ "$OLD" != "$NEW" ] && CODE_CHANGED=1
log "Rama $BRANCH: ${OLD:0:8} -> ${NEW:0:8} $([ $CODE_CHANGED = 1 ] && echo '(hay cambios)' || echo '(sin cambios)')"

# ------------------------------------------------- 2. imágenes de terceros
log "docker compose pull (imágenes de terceros)"
"${COMPOSE[@]}" pull --quiet --ignore-buildable

# --------------------------------------------------- 3. código nuevo: build
if [ $CODE_CHANGED = 1 ] || [ $FORCE = 1 ]; then
  log "Copia de seguridad previa a la actualización"
  "${COMPOSE[@]}" exec -T backup backup.sh || die "La copia previa ha fallado; no se actualiza"

  for img in cctv-backend cctv-frontend; do
    docker image inspect "$img:latest" >/dev/null 2>&1 && docker image tag "$img:latest" "$img:rollback"
  done

  if [ $CODE_CHANGED = 1 ]; then
    git -C "$REPO_DIR" merge --ff-only --quiet "origin/$BRANCH"
  fi
  VERSION=$(git -C "$REPO_DIR" rev-parse --short HEAD)
  log "Construyendo imágenes ($VERSION)"
  "${COMPOSE[@]}" build --pull backend frontend backup
  docker image tag cctv-backend:latest "cctv-backend:$VERSION"
  docker image tag cctv-frontend:latest "cctv-frontend:$VERSION"
fi

# ------------------------------------------------ 4. reinicio controlado
log "docker compose up -d"
"${COMPOSE[@]}" up -d --remove-orphans
if [ $CODE_CHANGED = 1 ]; then
  # La configuración de nginx va montada desde el repo: validar y recargar
  "${COMPOSE[@]}" exec -T nginx nginx -t && "${COMPOSE[@]}" exec -T nginx nginx -s reload
fi

# ----------------------------------------------- 5/6. verificación y rollback
if wait_healthy; then
  docker image prune -f >/dev/null
  log "Actualización completada"
  exit 0
fi

if [ $CODE_CHANGED = 1 ] || [ $FORCE = 1 ]; then
  log "ROLLBACK a ${OLD:0:8} y a las imágenes anteriores"
  git -C "$REPO_DIR" reset --hard --quiet "$OLD"
  for img in cctv-backend cctv-frontend; do
    docker image inspect "$img:rollback" >/dev/null 2>&1 && docker image tag "$img:rollback" "$img:latest"
  done
  "${COMPOSE[@]}" up -d --remove-orphans
  "${COMPOSE[@]}" exec -T nginx nginx -s reload || true
  wait_healthy || log "El rollback tampoco está sano: revisar con 'docker compose ps' y 'docker compose logs'"
  log "Si la nueva versión aplicó migraciones incompatibles, restaurar la copia previa: sudo ./scripts/restore.sh --db latest"
fi
die "La actualización no ha superado las comprobaciones de salud"
