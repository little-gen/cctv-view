# Despliegue en producción (Proxmox VE + Debian 12 + Docker)

Guía completa para instalar PlanosCámaras desde cero en una máquina virtual de Proxmox y publicarlo en **https://cctv.midominio.com**.

> Sustituye en todos los comandos: `cctv.midominio.com` (dominio), `192.168.10.50` (IP de la VM), `192.168.10.1` (puerta de enlace), `192.168.10.0/24` (red de administración), `120` (ID de la VM) y `git@git.midominio.com:infra/planos-camaras.git` (repositorio).

---

## 1. Arquitectura

```
                 Internet
                    │  80/443 (NAT del router/firewall perimetral)
┌───────────────────▼────────────────────────── Proxmox VE ───────────────────────────────┐
│  VM cctv-prod · Debian 12 · IP fija 192.168.10.50 · UFW + fail2ban                       │
│                                                                                          │
│   ┌──────────────── Docker · red "app" ─────────────────┐   ┌──── red "db" (internal) ──┐│
│   │ nginx :80/:443  ──/──────► frontend :8080 (SPA)     │   │                            ││
│   │  TLS Let's Encrypt  └─/api► backend  :4000 ─────────┼───┼──► postgres :5432          ││
│   │  gzip · cabeceras · rate limit                      │   │        ▲                   ││
│   │ certbot (renovación cada 12 h)                      │   │ backup (cron 03:00) ───────┤│
│   └─────────────────────────────────────────────────────┘   └────────────────────────────┘│
│   Opcional (red "monitoring", solo 127.0.0.1): Prometheus · Grafana · Uptime Kuma          │
│   node-exporter · cAdvisor · postgres-exporter                                           │
│                                                                                          │
│   Disco 1 (sistema, 40 GB)          Disco 2 → /data (datos, ≥150 GB)                      │
│                                     plans · uploads · documents · postgres · backups     │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

| Contenedor | Imagen | Función |
|---|---|---|
| `nginx` | `nginx:1.30-alpine` | Único servicio expuesto (80/443). TLS, HTTP→HTTPS, gzip, cabeceras de seguridad, limitación de peticiones, proxy a frontend/backend. |
| `frontend` | `cctv-frontend` (build propio, `nginx-unprivileged`) | Ficheros estáticos de la SPA React. |
| `backend` | `cctv-backend` (build propio, `node:24-alpine`) | API Express. Aplica las migraciones al arrancar. Usuario sin privilegios y sistema de ficheros de solo lectura. |
| `postgres` | `postgres:17-alpine` | Base de datos en una red interna sin acceso exterior. |
| `certbot` | `certbot/certbot:v5.8.0` | Renovación automática de certificados. |
| `backup` | `cctv-backup` (build propio) | `pg_dump` diario + instantáneas incrementales de ficheros. |

---

## 2. Requisitos de la VM

| Perfil | vCPU | RAM | Disco sistema (SSD) | Disco datos `/data` (SSD) |
|---|---|---|---|---|
| Mínimo (≤ 20 proyectos, ≤ 1.000 cámaras, ≤ 5 usuarios) | 2 | 4 GB | 32 GB | 50 GB |
| **Recomendado** (cientos de proyectos, ~30.000 cámaras, 20–50 usuarios) | **4** | **8 GB** | **40 GB** | **150–300 GB** |
| + monitorización | +1 | +2 GB | — | +10 GB |

Cómo dimensionar `/data`: lo que más ocupa son las **fotos**.

```
fotos       ≈ nº cámaras × fotos por cámara × 2–3 MB   (30.000 × 2 × 2,5 MB ≈ 150 GB)
planos      ≈ nº planos × 5 MB
documentos  ≈ según uso (fichas técnicas PDF ≈ 1 MB)
backups     ≈ volcados BD (pocos MB) + lo que cambie entre instantáneas (son incrementales)
```

Para el disco de datos conviene empezar con margen y ampliarlo cuando haga falta (§ 13). La configuración de PostgreSQL de `docker-compose.yml` está pensada para 8 GB de RAM: con otra cantidad, ajusta `shared_buffers` al 25% y `effective_cache_size` al 50–75%.

---

## 3. Red y DNS

1. **IP fija** para la VM: `192.168.10.50/24`, puerta de enlace `192.168.10.1`. Se configura con cloud-init (§ 4.1) o en `/etc/network/interfaces` (§ 4.2). Conviene reservarla también en el DHCP.
2. **DNS público**: registro `A` `cctv.midominio.com → <IP pública>` (y `AAAA` si hay IPv6).
3. **Router/firewall perimetral**: NAT de los puertos **80/TCP y 443/TCP** de la IP pública a `192.168.10.50`. El 80 es imprescindible para validar y renovar el certificado de Let's Encrypt. **No publiques el 22.**
4. Comprobación desde fuera: `dig +short cctv.midominio.com` debe devolver la IP pública.

---

## 4. Crear la VM en Proxmox

### 4.1 Con la imagen cloud de Debian 12 (recomendado, en la shell del nodo Proxmox)

```bash
# Variables
VMID=120
STORAGE=local-lvm          # almacenamiento SSD de Proxmox (pvesm status)
BRIDGE=vmbr0
SSHKEY=/root/cctv_admin.pub   # clave pública del administrador (cópiala antes al nodo)

# Imagen oficial Debian 12 "genericcloud"
cd /var/lib/vz/template/iso
wget -O debian-12-genericcloud-amd64.qcow2 \
  https://cloud.debian.org/images/cloud/bookworm/latest/debian-12-genericcloud-amd64.qcow2

# VM: 4 vCPU (tipo host), 8 GB sin balloon, VirtIO SCSI single, agente QEMU
qm create $VMID --name cctv-prod --ostype l26 --machine q35 \
  --cpu host --cores 4 --memory 8192 --balloon 0 \
  --net0 virtio,bridge=$BRIDGE,firewall=1 \
  --scsihw virtio-scsi-single --agent enabled=1,fstrim_cloned_disks=1 \
  --serial0 socket --vga serial0 --onboot 1

# Disco del sistema (40 GB) a partir de la imagen
qm disk import $VMID debian-12-genericcloud-amd64.qcow2 $STORAGE
qm set $VMID --scsi0 $STORAGE:vm-$VMID-disk-0,discard=on,ssd=1,iothread=1 --boot order=scsi0
qm disk resize $VMID scsi0 40G

# Disco de datos (/data), 200 GB
qm set $VMID --scsi1 $STORAGE:200,discard=on,ssd=1,iothread=1

# cloud-init: usuario, clave SSH e IP FIJA
qm set $VMID --ide2 $STORAGE:cloudinit
qm set $VMID --ciuser deploy --sshkeys $SSHKEY \
  --ipconfig0 ip=192.168.10.50/24,gw=192.168.10.1 \
  --nameserver "192.168.10.1 1.1.1.1" --searchdomain midominio.com

qm start $VMID
```

A los 30–60 s la VM es accesible con `ssh deploy@192.168.10.50`. El usuario `deploy` tiene `sudo` sin contraseña (cloud-init). El disco de datos aparece como `/dev/sdb`.

### 4.2 Alternativa: instalación desde la ISO de Debian 12

Crea la VM con los mismos parámetros (CPU `host`, VirtIO SCSI single, disco con *Discard* + *SSD emulation* + *IO thread*, segundo disco para datos, *QEMU Guest Agent* activado). Instala Debian sin entorno gráfico, solo con *SSH server* y *standard system utilities*, crea el usuario `deploy` y añádelo a `sudo`. Después, la IP fija:

```bash
sudo nano /etc/network/interfaces
```
```
auto ens18
iface ens18 inet static
    address 192.168.10.50/24
    gateway 192.168.10.1
    dns-nameservers 192.168.10.1 1.1.1.1
```
```bash
sudo systemctl restart networking
# Desde tu equipo: copiar la clave SSH antes de que se desactiven las contraseñas
ssh-copy-id deploy@192.168.10.50
```

### 4.3 Copias de la VM en Proxmox (recomendado)

*Datacenter → Backup → Add*: diario, modo **snapshot**, destino Proxmox Backup Server o NFS externo. Con el agente QEMU se congela el sistema de ficheros durante la instantánea. Esto complementa (no sustituye) las copias lógicas de § 9.

---

## 5. Preparar la VM

```bash
ssh deploy@192.168.10.50

# Repositorio en /opt/cctv. Para repos privados: clave de despliegue de solo lectura
sudo apt-get update && sudo apt-get install -y git
ssh-keygen -t ed25519 -f ~/.ssh/cctv_deploy -N "" -C "cctv-prod deploy key"
cat ~/.ssh/cctv_deploy.pub     # añadirla como "Deploy key" (solo lectura) en GitHub/GitLab/Gitea
printf 'Host git.midominio.com\n  IdentityFile ~/.ssh/cctv_deploy\n  IdentitiesOnly yes\n' >> ~/.ssh/config

sudo mkdir -p /opt/cctv && sudo chown deploy:deploy /opt/cctv
git clone git@git.midominio.com:infra/planos-camaras.git /opt/cctv
cd /opt/cctv

# Sistema, Docker, disco /data, SSH, UFW, fail2ban, logrotate, systemd
sudo ADMIN_CIDR=192.168.10.0/24 DATA_DISK=/dev/sdb ./deploy/scripts/setup-vm.sh

# Volver a entrar para aplicar el grupo docker
exit
ssh deploy@192.168.10.50
docker version && docker compose version
```

Qué hace [`setup-vm.sh`](../deploy/scripts/setup-vm.sh) (es idempotente):
- Actualiza Debian, activa las actualizaciones de seguridad automáticas e instala el agente QEMU, chrony, fail2ban, UFW y rsync.
- Instala Docker Engine y el plugin Compose desde el repositorio oficial. Configura la rotación de logs y `live-restore`.
- Formatea `/dev/sdb` **solo si está vacío**, lo monta en `/data` (por etiqueta, en fstab) y crea la estructura de carpetas con sus permisos.
- Endurece SSH: solo con clave, sin root, `AllowUsers deploy`. Si el usuario no tiene `authorized_keys`, no desactiva las contraseñas.
- Configura UFW: SSH solo desde `ADMIN_CIDR`, y 80/443 abiertos.
- Configura fail2ban para SSH, el login de la aplicación y los abusos del límite de peticiones.
- Instala el timer de actualización (se activa en § 10).

---

## 6. Configuración (`.env`)

```bash
cd /opt/cctv/deploy
cp .env.example .env
chmod 600 .env

# Genera los secretos y pégalos en .env
echo "POSTGRES_PASSWORD=$(openssl rand -hex 32)"
echo "JWT_SECRET=$(openssl rand -hex 48)"
echo "GRAFANA_ADMIN_PASSWORD=$(openssl rand -hex 16)"
echo "POSTGRES_EXPORTER_PASSWORD=$(openssl rand -hex 16)"
nano .env
```

| Variable | Valor |
|---|---|
| `DOMAIN` | `cctv.midominio.com` |
| `LETSENCRYPT_EMAIL` | correo para los avisos de caducidad |
| `LETSENCRYPT_STAGING` | `1` para una primera prueba sin agotar los límites de Let's Encrypt; después `0` |
| `POSTGRES_PASSWORD`, `JWT_SECRET` | secretos generados (solo `[a-f0-9]`, porque van dentro de una URL) |
| `PLAN_MAX_UPLOAD_MB` / `PLAN_MAX_MEGAPIXELS` / `PLAN_MAX_INPUT_MEGAPIXELS` | `200` / `400` / `2000`: tamaño máximo del fichero, resolución de visualización (los planos mayores se reducen para el zoom; el original se conserva) y resolución máxima aceptada. Si se sube el primero, ajustar `client_max_body_size` en la ubicación de subida de planos de `nginx/templates/cctv.conf.template` |
| `BACKUP_SCHEDULE` / `BACKUP_RETENTION_DAYS` | `0 3 * * *` / `14` |
| `DATA_DIR` | `/data` |

El fichero `.env` nunca se sube al repositorio: está en `.gitignore`.

---

## 7. Primer despliegue

```bash
cd /opt/cctv/deploy

# 1. Construir las imágenes propias (5–10 min la primera vez)
docker compose build

# 2. Certificado de Let's Encrypt y arranque de todo el stack
./scripts/init-letsencrypt.sh
#    Si usaste LETSENCRYPT_STAGING=1 y funcionó: pon 0 en .env, borra el certificado de prueba y repite:
#    sudo rm -rf /data/letsencrypt/{live,archive,renewal}/cctv.midominio.com* && ./scripts/init-letsencrypt.sh

# 3. Arrancar el resto de servicios (backup, certbot)
docker compose up -d
docker compose ps          # todos "running" y backend/frontend/nginx/postgres "healthy"

# 4. Crear el administrador (solo la primera vez). La contraseña no queda guardada en ningún fichero.
read -rp "Email admin: " ADMIN_EMAIL; read -rsp "Contraseña (≥12): " ADMIN_PASS; echo
docker compose run --rm -e SEED_ADMIN_EMAIL="$ADMIN_EMAIL" -e SEED_ADMIN_PASSWORD="$ADMIN_PASS" \
  backend node dist/db/seed.js
unset ADMIN_PASS

# 5. Primera copia de seguridad manual
docker compose exec backup backup.sh
```

Verificación:
```bash
curl -I http://cctv.midominio.com            # 301 → https
curl -sI https://cctv.midominio.com | grep -iE 'HTTP/|strict-transport|content-security'
curl -s https://cctv.midominio.com/api/health   # {"ok":true}
```
Después abre https://cctv.midominio.com, inicia sesión y crea los usuarios técnicos y de consulta desde *Usuarios*. La documentación de la API está en `/api/docs`; se puede limitar a la red interna descomentando el bloque correspondiente en `deploy/nginx/templates/cctv.conf.template`.

---

## 8. Estructura de carpetas

### Repositorio (`/opt/cctv`)
```
/opt/cctv
├── backend/Dockerfile               API: build multi-etapa, usuario node, tini, healthcheck
├── frontend/Dockerfile              SPA: build con Vite, servida por nginx-unprivileged
├── frontend/nginx.conf              servidor estático (caché de /assets, fallback SPA)
├── .dockerignore · .gitattributes   (scripts con fin de línea LF)
└── deploy/
    ├── docker-compose.yml           stack de producción
    ├── docker-compose.monitoring.yml  Prometheus · Grafana · Uptime Kuma (opcional)
    ├── .env.example                 plantilla de variables (.env real: chmod 600, no versionado)
    ├── nginx/
    │   ├── nginx.conf               global: gzip, logs, limit_req
    │   ├── templates/cctv.conf.template   servidores 80/443, proxy, CSP (${DOMAIN})
    │   └── snippets/                ssl.conf · security-headers.conf · proxy.conf
    ├── backup/                      Dockerfile · entrypoint.sh (cron) · backup.sh
    ├── scripts/
    │   ├── setup-vm.sh              preparación de Debian 12
    │   ├── init-letsencrypt.sh      primer certificado
    │   ├── update.sh                actualización con rollback
    │   └── restore.sh               restauración de copias
    ├── systemd/                     cctv-update.service · cctv-update.timer
    ├── fail2ban/                    jail.d/cctv.local · filter.d/*.conf
    ├── logrotate/cctv-nginx
    └── monitoring/                  prometheus/{prometheus,alerts}.yml · grafana/provisioning
```

### Datos (`/data`, disco dedicado)
```
/data
├── plans/         imágenes de planos (versiones incluidas)    1000:1000  → backend:/data/plans
│   └── tiles/     niveles de zoom (teselas WebP; regenerables, no se copian en los backups)
├── uploads/       fotografías de cámaras                      1000:1000  → backend:/data/uploads
├── documents/     documentación (PDF, Office…)                1000:1000  → backend:/data/documents
├── postgres/      datos de PostgreSQL (volumen Docker "pgdata")
├── backups/
│   ├── db/        cctv-AAAAMMDD-HHMMSS.dump        (pg_dump custom, 14 días)
│   ├── files/     AAAAMMDD-HHMMSS/{plans,uploads,documents}  (instantáneas incrementales)
│   └── metrics/   backup.prom (para Prometheus)
├── letsencrypt/   certificados
├── certbot-www/   desafíos ACME
├── logs/nginx/    access.log · error.log (fail2ban + logrotate)
└── monitoring/    prometheus · grafana · uptime-kuma
```

---

## 9. Copias de seguridad y restauración

**Automáticas**: el contenedor `backup` se ejecuta cada día a las 03:00 (`BACKUP_SCHEDULE`) y hace lo siguiente:
1. `pg_dump` en formato *custom* comprimido, comprobando que el volcado se puede leer (`pg_restore --list`). Retención: `BACKUP_RETENTION_DAYS`.
2. Instantánea de `plans`, `uploads` y `documents` con `rsync --link-dest`. Cada instantánea se ve completa, pero los ficheros que no han cambiado son enlaces duros y no ocupan espacio. Retención: `BACKUP_FILES_RETENTION_DAYS`.
3. Escribe las métricas en `backups/metrics/backup.prom` (alertas «BackupAntiguo» y «BackupFallido» en Prometheus).

```bash
docker compose exec backup backup.sh          # copia manual inmediata
docker compose logs --tail 50 backup          # resultado de las copias
sudo ./scripts/restore.sh --list              # copias disponibles
```

**Restauración** (pide escribir `RESTAURAR`; antes copia el estado actual):
```bash
cd /opt/cctv/deploy
sudo ./scripts/restore.sh --db latest                                   # solo BD, última copia
sudo ./scripts/restore.sh --db cctv-20261020-030000.dump --files 20261020-030000   # BD + ficheros de esa fecha
sudo ./scripts/restore.sh --files latest                                # solo ficheros
```

**Copia fuera de la VM** (muy recomendable; las copias en `/data` no sirven si se pierde el disco):
```bash
# Opción A: Proxmox Backup Server / vzdump de la VM completa (§ 4.3)
# Opción B: sincronizar /data/backups con un NAS (cron del host, 05:00)
echo '0 5 * * * root rsync -aH --delete /data/backups/ backup@nas.midominio.com:/volume1/cctv/' | sudo tee /etc/cron.d/cctv-offsite
```

**Prueba de restauración**: al menos una vez al trimestre, restaura la última copia en una VM clonada (*Proxmox → Clone*) y comprueba que la aplicación arranca con los datos.

---

## 10. Actualizaciones

[`update.sh`](../deploy/scripts/update.sh) sigue estos pasos:
1. `git fetch` de la rama actual. Si hay cambios locales sin confirmar en la VM, se detiene.
2. `docker compose pull` de las imágenes de terceros (postgres, nginx, certbot), para recibir parches de seguridad dentro de la misma versión mayor.
3. Si hay commits nuevos: **copia de seguridad previa**, `git merge --ff-only` y `docker compose build --pull`. Las imágenes actuales se conservan como `:rollback` y las nuevas se etiquetan también con el commit.
4. `docker compose up -d`: Compose solo recrea los contenedores cuya imagen o configuración ha cambiado. El backend aplica las migraciones al arrancar y nginx se valida (`nginx -t`) y se recarga.
5. Espera a que backend, frontend y nginx estén *healthy* (hasta 4 min).
6. Si algo falla, **rollback** automático al commit y a las imágenes anteriores.

```bash
./scripts/update.sh            # manual
./scripts/update.sh --force    # reconstruir aunque no haya commits nuevos (p. ej. parches de node/nginx)

# Automática cada día a las 04:30 (después de la copia de las 03:00)
sudo systemctl enable --now cctv-update.timer
systemctl list-timers cctv-update.timer
journalctl -u cctv-update -n 100          # historial
```

El corte durante una actualización con cambios en el backend dura unos segundos, mientras se recrea el contenedor. Si una versión incluye migraciones que el rollback no puede deshacer, hay que restaurar la copia previa con `sudo ./scripts/restore.sh --db latest`.

Las **versiones mayores** (PostgreSQL 17 → 18, nginx 1.30 → 1.32) se cambian a mano en `docker-compose.yml`, después de leer sus notas de versión. Pasar a otra versión mayor de PostgreSQL requiere volcar y restaurar los datos (`pg_dump` → `restore.sh`).

---

## 11. Monitorización (opcional)

```bash
cd /opt/cctv/deploy
# Usuario de solo lectura para postgres-exporter
docker compose exec postgres psql -U "$(grep ^POSTGRES_USER .env | cut -d= -f2)" -d postgres -c \
  "CREATE ROLE monitoring LOGIN PASSWORD '$(grep ^POSTGRES_EXPORTER_PASSWORD .env | cut -d= -f2)' IN ROLE pg_monitor;"

docker compose -f docker-compose.yml -f docker-compose.monitoring.yml up -d
echo 1 > .monitoring        # update.sh también actualizará estos servicios
```

Acceso por túnel SSH (los paneles solo escuchan en 127.0.0.1):
```bash
ssh -L 3000:127.0.0.1:3000 -L 3001:127.0.0.1:3001 -L 9090:127.0.0.1:9090 deploy@192.168.10.50
```
| Servicio | URL (con el túnel) | Uso |
|---|---|---|
| Grafana | http://localhost:3000 (admin / `GRAFANA_ADMIN_PASSWORD`) | Importar los paneles **1860** (Node Exporter Full), **19792** (cAdvisor) y **9628** (PostgreSQL). La fuente Prometheus ya viene configurada. |
| Prometheus | http://localhost:9090 | Métricas y reglas (*Alerts*): copias antiguas o fallidas, disco > 85%, memoria, PostgreSQL caído, reinicios. |
| Uptime Kuma | http://localhost:3001 | Crea la cuenta y añade monitores: `https://cctv.midominio.com/api/health` (HTTP, palabra clave `ok`), el certificado TLS (aviso a 14 días), `http://backend:4000/api/health` (interno) y TCP `postgres:5432`. Configura las notificaciones (correo, Telegram, Teams). |

Para ver los paneles desde la LAN de administración sin túnel: pon `MONITORING_BIND=192.168.10.50` y añade `sudo ufw allow from 192.168.10.0/24 to any port 3000,3001 proto tcp`. Ojo: los puertos publicados por Docker no pasan por las reglas de UFW, así que la restricción efectiva es la IP de enlace.

---

## 12. Seguridad (lista de comprobación)

- [x] **Exposición mínima**: solo 80/443 publicados. PostgreSQL en una red Docker `internal` sin puertos. Monitorización ligada a 127.0.0.1.
- [x] **SSH**: solo con clave, sin root, `AllowUsers deploy`, UFW limitado a la red de administración y fail2ban.
- [x] **TLS**: Let's Encrypt (ECDSA), TLS 1.2/1.3 (perfil *intermediate* de Mozilla), HSTS de 2 años y rechazo del *handshake* para hosts desconocidos.
- [x] **Cabeceras**: CSP, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy, COOP y `X-Robots-Tag: noindex`.
- [x] **Fuerza bruta**: nginx limita el login a 5 peticiones por minuto e IP, y fail2ban bloquea en `DOCKER-USER` a quien acumula 401 o 429.
- [x] **Contenedores**: `no-new-privileges`, `cap_drop: ALL`, raíz de solo lectura en backend y frontend, usuarios sin privilegios y logs rotados.
- [x] **Secretos** en `.env` (chmod 600, no versionado). El backend no arranca con un `JWT_SECRET` por defecto o corto, y el seed de producción no crea usuarios de demo.
- [x] **Parches**: `unattended-upgrades` en el sistema y `update.sh` en las imágenes.
- [ ] Revisa cada mes `sudo fail2ban-client status cctv-login`, `docker compose ps` y el espacio libre (`df -h /data`).
- [ ] Opcional: limita `/api/docs` a la red interna. Si los usuarios están siempre en la LAN o VPN, puedes restringir 443 por IP en el firewall perimetral.

---

## 13. Operación y resolución de problemas

```bash
cd /opt/cctv/deploy
docker compose ps                              # estado y salud
docker compose logs -f --tail 100 backend      # logs de un servicio
docker compose restart backend                 # reinicio de un servicio
docker compose exec postgres psql -U cctv cctv # consola SQL
docker compose exec nginx nginx -t             # validar la configuración de nginx
docker compose run --rm --entrypoint certbot certbot certificates   # caducidad de los certificados
sudo fail2ban-client status cctv-login         # IP bloqueadas
sudo fail2ban-client set cctv-login unbanip 1.2.3.4
df -h /data && sudo du -sh /data/*             # espacio
docker system df                               # espacio usado por Docker
```

| Síntoma | Causa probable / solución |
|---|---|
| `init-letsencrypt.sh` falla en la validación | El DNS no apunta a la IP pública, o el puerto 80 no llega a la VM. Prueba con `curl http://cctv.midominio.com/.well-known/acme-challenge/x` desde fuera (debe dar 404 de nginx, no un timeout). |
| 502 Bad Gateway | El backend no está sano: `docker compose logs backend` (¿`JWT_SECRET` corto? ¿la BD no arranca?). |
| `Error: JWT_SECRET debe configurarse` | `JWT_SECRET` vacío o con menos de 32 caracteres en `.env`. |
| No se pueden subir ficheros (500) | Permisos: `sudo chown -R 1000:1000 /data/{plans,uploads,documents}`. |
| 413 Request Entity Too Large | Planos: `PLAN_MAX_UPLOAD_MB` (.env) y `client_max_body_size` de la ubicación `/api/plans/…/image` (cctv.conf.template). Fotos/documentos: `MAX_UPLOAD_MB` y `client_max_body_size` de nginx.conf. |
| Un plano tarda en aparecer la primera vez | Planos subidos antes de la versión con teselas: se procesan al abrirlos (unos segundos). Para hacerlo de antemano: `docker compose exec backend node dist/db/generate-tiles.js`. |
| Ampliar `/data` | En Proxmox: `qm disk resize 120 scsi1 +100G`. En la VM: `sudo resize2fs /dev/sdb` (en caliente). |
| La actualización hizo rollback | `journalctl -u cctv-update -n 200` y `docker compose logs backend` de la versión fallida. |
