#!/usr/bin/env bash
# =============================================================================
# Certificado TLS con una CA interna (instalaciones sin acceso desde Internet,
# donde Let's Encrypt no puede validar). Sustituye a init-letsencrypt.sh.
#
#   cd /opt/cctv/deploy && sudo ./scripts/init-internal-cert.sh
#
# Variables opcionales:
#   EXTRA_NAMES  nombres DNS adicionales separados por espacios (p. ej. "cctv.tekusys.io")
#   EXTRA_IPS    IP incluidas en el certificado (por defecto, la IP principal de la VM; "" = ninguna)
#   CERT_DAYS    validez del certificado del servidor (por defecto 825)
#
# La CA se crea solo la primera vez y se reutiliza: renovar o añadir nombres no
# obliga a reinstalar la CA en los equipos. Distribuir solo internal-ca/ca.crt.
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."
[ "$(id -u)" -eq 0 ] || { echo "Ejecutar con sudo" >&2; exit 1; }
# Se leen solo las variables necesarias: el .env no se puede cargar con "." porque
# BACKUP_SCHEDULE=0 3 * * * no es sintaxis de shell válida
env_get() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- | tr -d '"'"'"'\r'; }
DOMAIN=$(env_get DOMAIN)
[ -n "$DOMAIN" ] || { echo "DOMAIN no está definido en .env" >&2; exit 1; }
DATA_DIR=$(env_get DATA_DIR); DATA_DIR=${DATA_DIR:-/data}
CA_DIR="$DATA_DIR/letsencrypt/internal-ca"
LIVE="$DATA_DIR/letsencrypt/live/$DOMAIN"
CERT_DAYS=${CERT_DAYS:-825}
EXTRA_NAMES=${EXTRA_NAMES:-}
# Por defecto, la IP principal de la VM (la de la ruta por defecto; excluye las redes de Docker)
EXTRA_IPS=${EXTRA_IPS-$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i=1; i<NF; i++) if ($i == "src") print $(i+1)}')}

mkdir -p "$CA_DIR" "$LIVE"
chmod 700 "$CA_DIR"

if [ ! -f "$CA_DIR/ca.key" ]; then
  echo "==> Creando la CA interna (10 años)"
  openssl req -x509 -new -nodes -newkey rsa:4096 -sha256 -days 3650 \
    -keyout "$CA_DIR/ca.key" -out "$CA_DIR/ca.crt" \
    -subj "/O=Teku Systems/CN=Teku Systems CCTV Internal CA" \
    -addext "basicConstraints=critical,CA:TRUE" \
    -addext "keyUsage=critical,keyCertSign,cRLSign"
  chmod 600 "$CA_DIR/ca.key"
else
  echo "==> Reutilizando la CA existente ($CA_DIR/ca.crt)"
fi

SAN="DNS:$DOMAIN"
for n in $EXTRA_NAMES; do SAN="$SAN,DNS:$n"; done
for ip in $EXTRA_IPS; do SAN="$SAN,IP:$ip"; done

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
printf 'subjectAltName=%s\nbasicConstraints=CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth\n' "$SAN" > "$TMP/ext"

echo "==> Certificado del servidor: $SAN ($CERT_DAYS días)"
openssl req -new -nodes -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 \
  -keyout "$TMP/privkey.pem" -out "$TMP/req.csr" -subj "/CN=$DOMAIN"
openssl x509 -req -in "$TMP/req.csr" -CA "$CA_DIR/ca.crt" -CAkey "$CA_DIR/ca.key" -CAcreateserial \
  -out "$TMP/cert.pem" -days "$CERT_DAYS" -sha256 -extfile "$TMP/ext" 2>/dev/null

cat "$TMP/cert.pem" "$CA_DIR/ca.crt" > "$LIVE/fullchain.pem"
install -m 600 "$TMP/privkey.pem" "$LIVE/privkey.pem"
echo internal-ca > "$LIVE/.origin"

openssl x509 -in "$LIVE/fullchain.pem" -noout -subject -ext subjectAltName -enddate

if docker compose ps --status running --services 2>/dev/null | grep -qx nginx; then
  echo "==> Recargando nginx"
  docker compose exec -T nginx nginx -s reload
fi

echo "Listo. CA para instalar en los equipos: $CA_DIR/ca.crt"
