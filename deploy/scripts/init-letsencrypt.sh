#!/usr/bin/env bash
# =============================================================================
# Primer certificado de Let's Encrypt (solo la primera vez; luego renueva el
# contenedor certbot). Requisitos: DNS de DOMAIN apuntando a la IP pública y
# puertos 80/443 redirigidos a la VM.
#   cd /opt/cctv/deploy && ./scripts/init-letsencrypt.sh
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a

DATA_DIR=${DATA_DIR:-/data}
LIVE="$DATA_DIR/letsencrypt/live/$DOMAIN"
STAGING_ARG=""
[ "${LETSENCRYPT_STAGING:-0}" = "1" ] && STAGING_ARG="--staging"

if [ -f "$LIVE/fullchain.pem" ] && ! grep -q 'dummy' "$LIVE/.origin" 2>/dev/null; then
  echo "Ya existe un certificado para $DOMAIN. Para forzar: borra $LIVE y vuelve a ejecutar."
  exit 0
fi

echo "==> Certificado temporal autofirmado (para que nginx pueda arrancar)"
sudo mkdir -p "$LIVE"
sudo openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
  -keyout "$LIVE/privkey.pem" -out "$LIVE/fullchain.pem" -subj "/CN=$DOMAIN" 2>/dev/null
echo dummy | sudo tee "$LIVE/.origin" >/dev/null

echo "==> Arrancando la aplicación y nginx"
docker compose up -d --build nginx

echo "==> Borrando el certificado temporal"
sudo rm -rf "$DATA_DIR/letsencrypt/live/$DOMAIN" "$DATA_DIR/letsencrypt/archive/$DOMAIN" \
  "$DATA_DIR/letsencrypt/renewal/$DOMAIN.conf"

echo "==> Solicitando certificado a Let's Encrypt para $DOMAIN ${STAGING_ARG:+(STAGING)}"
docker compose run --rm --entrypoint certbot certbot certonly \
  --webroot -w /var/www/certbot \
  -d "$DOMAIN" \
  --email "$LETSENCRYPT_EMAIL" --agree-tos --no-eff-email \
  --key-type ecdsa \
  $STAGING_ARG

echo "==> Recargando nginx"
docker compose exec nginx nginx -s reload
docker compose up -d certbot

echo "Listo: https://$DOMAIN"
