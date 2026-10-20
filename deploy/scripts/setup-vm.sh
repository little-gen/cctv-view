#!/usr/bin/env bash
# =============================================================================
# Preparación de una VM Debian 12 limpia para PlanosCámaras (ejecutar como root):
#   sudo ADMIN_CIDR=192.168.10.0/24 DATA_DISK=/dev/sdb ./setup-vm.sh
#
# Variables:
#   DEPLOY_USER  usuario que administrará la app (por defecto: el que ejecuta sudo)
#   ADMIN_CIDR   red desde la que se permite SSH (vacío = cualquiera, con límite de intentos)
#   DATA_DISK    disco para /data (p. ej. /dev/sdb). Solo se formatea si está VACÍO.
#   TZ           zona horaria (por defecto Europe/Madrid)
# Es idempotente: se puede volver a ejecutar.
# =============================================================================
set -euo pipefail

DEPLOY_USER=${DEPLOY_USER:-${SUDO_USER:-}}
ADMIN_CIDR=${ADMIN_CIDR:-}
DATA_DISK=${DATA_DISK:-}
TZ_NAME=${TZ:-Europe/Madrid}
REPO_DIR=$(cd "$(dirname "$0")/../.." && pwd)

log() { echo -e "\n\033[1;34m==> $*\033[0m"; }
die() { echo -e "\033[1;31mERROR: $*\033[0m" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "Ejecuta como root (sudo)"
grep -q 'VERSION_CODENAME=bookworm' /etc/os-release || die "Este script es para Debian 12 (bookworm)"
[ -n "$DEPLOY_USER" ] && id "$DEPLOY_USER" >/dev/null 2>&1 || die "Define DEPLOY_USER (usuario existente con clave SSH)"

# ------------------------------------------------------------------ Sistema
log "Actualizando el sistema"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get -yq full-upgrade
apt-get -yq install ca-certificates curl gnupg git ufw fail2ban python3-systemd unattended-upgrades apt-listchanges \
  qemu-guest-agent rsync logrotate openssl htop jq chrony
systemctl enable --now qemu-guest-agent chrony
timedatectl set-timezone "$TZ_NAME"

log "Actualizaciones de seguridad automáticas"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF

# Ajustes de kernel para un servidor con Docker
cat > /etc/sysctl.d/90-cctv.conf <<'EOF'
vm.swappiness = 10
vm.overcommit_memory = 1
net.core.somaxconn = 1024
fs.inotify.max_user_watches = 524288
EOF
sysctl --system >/dev/null

# ------------------------------------------------------------------ Docker
if ! command -v docker >/dev/null; then
  log "Instalando Docker Engine + Compose (repositorio oficial)"
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian bookworm stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get -yq install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
cat > /etc/docker/daemon.json <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "5" },
  "live-restore": true,
  "no-new-privileges": true
}
EOF
systemctl enable docker
systemctl restart docker
usermod -aG docker "$DEPLOY_USER"

# ------------------------------------------------------------ Disco /data
if [ -n "$DATA_DISK" ]; then
  [ -b "$DATA_DISK" ] || die "$DATA_DISK no es un dispositivo de bloques"
  if ! blkid "$DATA_DISK" >/dev/null 2>&1; then
    log "Formateando $DATA_DISK (vacío) como ext4 para /data"
    mkfs.ext4 -L cctv-data -m 1 "$DATA_DISK"
  else
    echo "$DATA_DISK ya tiene sistema de ficheros: no se formatea"
  fi
  mkdir -p /data
  grep -q 'LABEL=cctv-data' /etc/fstab || echo 'LABEL=cctv-data /data ext4 defaults,noatime,nofail 0 2' >> /etc/fstab
  systemctl daemon-reload
  mountpoint -q /data || mount /data
fi

log "Estructura de /data"
mkdir -p /data/{uploads,plans,documents,backups,postgres,letsencrypt,certbot-www,logs/nginx} \
         /data/monitoring/{prometheus,grafana,uptime-kuma}
chown -R 1000:1000 /data/uploads /data/plans /data/documents     # usuario "node" del backend
chown -R 65534:65534 /data/monitoring/prometheus                   # nobody (Prometheus)
chown -R 472:0 /data/monitoring/grafana                            # grafana
chmod 700 /data/backups /data/postgres

# --------------------------------------------------------------------- SSH
log "Endureciendo SSH"
AUTH_KEYS=$(getent passwd "$DEPLOY_USER" | cut -d: -f6)/.ssh/authorized_keys
if [ -s "$AUTH_KEYS" ]; then
  cat > /etc/ssh/sshd_config.d/90-cctv-hardening.conf <<EOF
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
AuthenticationMethods publickey
MaxAuthTries 3
LoginGraceTime 30
X11Forwarding no
AllowAgentForwarding no
# "local" permite túneles ssh -L para acceder a Grafana/Prometheus/Uptime Kuma
AllowTcpForwarding local
ClientAliveInterval 300
ClientAliveCountMax 2
AllowUsers $DEPLOY_USER
EOF
  sshd -t && systemctl reload ssh
else
  echo "AVISO: $DEPLOY_USER no tiene authorized_keys; NO se desactiva el acceso por contraseña."
fi

# --------------------------------------------------------------- Firewall
log "Configurando UFW"
ufw --force reset >/dev/null
ufw default deny incoming
ufw default allow outgoing
if [ -n "$ADMIN_CIDR" ]; then
  ufw allow from "$ADMIN_CIDR" to any port 22 proto tcp comment 'SSH administracion'
else
  ufw limit 22/tcp comment 'SSH (con limite de intentos)'
fi
ufw allow 80/tcp comment 'HTTP (Lets Encrypt + redireccion)'
ufw allow 443/tcp comment 'HTTPS'
ufw --force enable
# Nota: los puertos publicados por Docker no pasan por las reglas INPUT de UFW. Este stack
# solo publica 80/443 (públicos de todos modos) y la monitorización se liga a 127.0.0.1.

# --------------------------------------------------------------- fail2ban
log "Configurando fail2ban (SSH + login de la aplicación)"
install -m 644 "$REPO_DIR/deploy/fail2ban/filter.d/cctv-login.conf" /etc/fail2ban/filter.d/cctv-login.conf
install -m 644 "$REPO_DIR/deploy/fail2ban/filter.d/cctv-ratelimit.conf" /etc/fail2ban/filter.d/cctv-ratelimit.conf
install -m 644 "$REPO_DIR/deploy/fail2ban/jail.d/cctv.local" /etc/fail2ban/jail.d/cctv.local
touch /data/logs/nginx/access.log /data/logs/nginx/error.log
systemctl enable fail2ban
systemctl restart fail2ban

# -------------------------------------------------------------- logrotate
install -m 644 "$REPO_DIR/deploy/logrotate/cctv-nginx" /etc/logrotate.d/cctv-nginx

# ------------------------------------------------- Actualización automática
log "Instalando servicios systemd (se activan tras el primer despliegue)"
sed "s#__USER__#$DEPLOY_USER#g; s#__REPO__#$REPO_DIR#g" "$REPO_DIR/deploy/systemd/cctv-update.service" \
  > /etc/systemd/system/cctv-update.service
install -m 644 "$REPO_DIR/deploy/systemd/cctv-update.timer" /etc/systemd/system/cctv-update.timer
systemctl daemon-reload

chown -R "$DEPLOY_USER:$DEPLOY_USER" "$REPO_DIR"

log "Listo. Cierra la sesión y vuelve a entrar para que $DEPLOY_USER pertenezca al grupo docker."
echo "Siguiente paso: cd $REPO_DIR/deploy && cp .env.example .env && nano .env"
