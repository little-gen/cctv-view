# Instalación real en Teku Systems (producción interna)

Estado de la instalación de PlanosCámaras en la infraestructura de Teku Systems, con los cambios
respecto a la guía genérica [despliegue-produccion.md](despliegue-produccion.md). **Si hay
diferencias entre ambos documentos, este es el que refleja lo que está desplegado.**

Última actualización: 22/10/2026.

---

## 1. Datos de la instalación

| Dato | Valor |
|---|---|
| Clúster / nodo Proxmox | `tekusys-cluster` / `server03` (10.10.33.113) · Proxmox VE 9.2.2 |
| VM | ID **121**, nombre `cctv-prod`. El ID 120 lo usa un CT (VMs y CTs comparten numeración). |
| Sistema | Debian 12 *genericcloud* (kernel `cloud-amd64`), máquina `q35`, CPU `host` |
| Recursos | 4 vCPU · 8 GB RAM |
| Discos (almacenamiento `iscsi-shared`, LVM sobre iSCSI, qcow2) | `scsi0` sistema 32 GB · `scsi1` datos 200 GB → `/dev/sdb` → `/data` (ext4, etiqueta `cctv-data`) · `scsi2` cloud-init |
| Red | `vmbr0`, sin VLAN · IP fija **10.10.33.133/23** · puerta de enlace y DNS **10.10.33.1** · dominio de búsqueda `tekusys.io` |
| Red de administración (SSH) | `10.10.32.0/23` |
| Usuario de administración | `cctv_admin` (UID 1000, `sudo` sin contraseña, solo clave SSH). **No existe el usuario `deploy`** de la guía. |
| Repositorio | `git@github.com:little-gen/cctv-view.git`, clonado en `/opt/cctv` con una *deploy key* de solo lectura (`~/.ssh/cctv_deploy` de `cctv_admin`) |
| URL de la aplicación | **https://cctv.tekusys.local** (solo red interna y VPN, **no se publica en Internet**) |
| DNS | Registro `A` `cctv.tekusys.local → 10.10.33.133` en el DNS que usan los equipos (10.10.33.1) |
| Certificado TLS | CA interna propia (ver § 4), **no Let's Encrypt** |
| Administrador de la aplicación | `iescudero@tekusys.io` |

---

## 2. Diferencias con la guía genérica

| Guía genérica | Instalación real | Motivo |
|---|---|---|
| VM 120, usuario `deploy`, red `192.168.10.0/24` | VM 121, usuario `cctv_admin`, red `10.10.32.0/23` | Datos reales. |
| `qm disk import` + `--scsi0 …vm-ID-disk-0` | `--scsi0 iscsi-shared:0,import-from=<imagen>` | En `iscsi-shared` (LVM + qcow2) el volumen se llama `vm-ID-disk-N.qcow2`; fijar el nombre a mano falla. |
| Disco cloud-init en `ide2` | Disco cloud-init en **`scsi2`** | Con `q35`, la imagen *genericcloud* no lee cloud-init en IDE: arrancaba como `localhost`, sin IP ni clave SSH. |
| Publicación en Internet con Let's Encrypt | Solo red interna + VPN, certificado de CA interna | Decisión de diseño: no se expone a Internet. |
| `./scripts/init-letsencrypt.sh` | **No se usa** | Borraría el certificado interno e intentaría validar contra Let's Encrypt. Usar `scripts/init-internal-cert.sh`. |
| NAT 80/443 en el router | Sin NAT | No hay acceso desde Internet. El acceso remoto es por la VPN del firewall. |

El contenedor `certbot` sigue arrancando con el stack, pero no hace nada: no hay certificados de
Let's Encrypt que renovar. `LETSENCRYPT_*` en `.env` no tienen efecto.

---

## 3. Lo que se ha hecho (orden real)

1. **VM** creada en `server03` con `/tmp/create-cctv-vm.sh` (equivale a § 4.1 de la guía con las
   diferencias de § 2). Clave pública del administrador copiada a `/root/cctv_admin.pub` del nodo.
2. **Repositorio**: subido desde el PC (`C:\Proyectos\PlanosCamaras`) a GitHub y clonado en la VM
   en `/opt/cctv` con la *deploy key*.
3. **`setup-vm.sh`**:
   `sudo DEPLOY_USER=cctv_admin ADMIN_CIDR=10.10.32.0/23 DATA_DISK=/dev/sdb bash deploy/scripts/setup-vm.sh`.
   Formateó `/dev/sdb` y lo montó en `/data`. Docker 29.9.1, Compose v5.6.0, UFW (22 solo desde
   10.10.32.0/23; 80/443 abiertos) y fail2ban.
4. **`.env`** (`/opt/cctv/deploy/.env`, chmod 600): secretos generados con `openssl rand` dentro
   del fichero, `DOMAIN=cctv.tekusys.local`, `LETSENCRYPT_EMAIL=iescudero@tekusys.io`.
5. **`docker compose build`** y **certificado interno** (§ 4).
6. **`docker compose up -d`**: backend, frontend, nginx y postgres `healthy`. Migraciones
   `001_init.sql` y `002_global_search.sql` aplicadas.
7. **Administrador** creado con `seed.js` (`iescudero@tekusys.io`; la contraseña exige ≥ 12 caracteres).
8. **DNS** `cctv.tekusys.local → 10.10.33.133` y **CA** importada en el PC del administrador.

---

## 4. Certificado TLS interno

- CA: `/data/letsencrypt/internal-ca/ca.crt` (clave `ca.key`, solo root, chmod 600).
  *Teku Systems CCTV Internal CA*, RSA 4096, válida 10 años.
- Certificado del servidor: `/data/letsencrypt/live/cctv.tekusys.local/{fullchain,privkey}.pem`
  (la ruta que espera `nginx/templates/cctv.conf.template`). ECDSA P-256, 825 días
  (caduca el **22/01/2029**). SAN: `DNS:cctv.tekusys.local`, `IP:10.10.33.133`.
- Se genera y renueva con [`deploy/scripts/init-internal-cert.sh`](../deploy/scripts/init-internal-cert.sh).
  Reutiliza la CA si ya existe, así que renovar o añadir nombres no obliga a reinstalar la CA en los equipos:
  ```bash
  cd /opt/cctv/deploy
  sudo ./scripts/init-internal-cert.sh                                # renovar
  sudo EXTRA_NAMES="cctv.tekusys.io" ./scripts/init-internal-cert.sh  # añadir nombres
  ```
- **La CA debe estar instalada en cada equipo antes de abrir la web.** nginx envía HSTS, así que
  sin la CA el navegador no deja saltarse el aviso.
  - Windows: `Import-Certificate -FilePath teku-cctv-ca.crt -CertStoreLocation Cert:\LocalMachine\Root`
    (como administrador), o distribuirla por GPO a *Entidades de certificación raíz de confianza*.
  - iPhone: abrir el `.crt` → *Ajustes → Perfil descargado → Instalar* y después
    *Ajustes → General → Información → Ajustes de confianza de certificados* → activar la CA.
  - Firefox usa su propio almacén (o `security.enterprise_roots.enabled`).
- **Solo se puede entrar por el nombre, no por la IP.** El bloque `default_server` de 443 tiene
  `ssl_reject_handshake on`: sin SNI (p. ej. `https://10.10.33.133`) nginx corta la conexión y el
  navegador muestra `ERR_SSL_PROTOCOL_ERROR`.

---

## 5. Acceso remoto por VPN (iPhone)

- La VPN del firewall llega a la VM (ping correcto desde el iPhone).
- Por IP falla (§ 4, `ERR_SSL_PROTOCOL_ERROR`). Hay que entrar por `https://cctv.tekusys.local`, con
  la VPN entregando el DNS 10.10.33.1.
- iOS reserva `.local` para mDNS/Bonjour y puede no preguntar al DNS de la VPN. Si no resuelve:
  - **Opción A (recomendada):** segundo nombre interno sin `.local` (p. ej. `cctv.tekusys.io` solo
    en el DNS interno) y regenerar el certificado con
    `EXTRA_NAMES=cctv.tekusys.io` (§ 4). No requiere cambios de código. Ojo: `CORS_ORIGIN` del
    backend es `https://${DOMAIN}`; si se usa un segundo nombre, comprobar que la API no rechaza
    peticiones desde él.
  - **Opción B:** permitir entrar por IP cambiando el `default_server` de 443 en
    `cctv.conf.template` para que sirva la aplicación (el certificado ya incluye la IP).

---

## 6. Pendiente

- [ ] **Permiso de ejecución de los scripts en git.** Se subieron desde Windows con modo `100644`.
      `cctv-update.service` ejecuta `update.sh` directamente y fallaría con *Permission denied*.
      Desde el PC: `git update-index --chmod=+x deploy/scripts/*.sh deploy/backup/*.sh`, commit y
      `git pull` en la VM.
- [ ] **`restore.sh` (y `init-letsencrypt.sh`) cargan el `.env` con `. ./.env`**, que falla con
      `BACKUP_SCHEDULE=0 3 * * *` (bash intenta ejecutar `3`). Corregir antes de necesitar una
      restauración: leer las variables como `init-internal-cert.sh` (`env_get`) o poner comillas al
      valor en `.env` y `.env.example`. Probarlo con `sudo ./scripts/restore.sh --list`.
- [ ] Resolver el acceso desde iPhone (§ 5).
- [ ] Primera copia manual: `docker compose exec backup backup.sh`.
- [ ] Activar la actualización automática: `sudo systemctl enable --now cctv-update.timer` (después
      del punto 1).
- [ ] Copia de la VM 121 en Proxmox (*Datacenter → Backup*, modo snapshot, a `DIARIAS`/`SEMANALES` o PBS).
- [ ] Copia de `/data/backups` fuera de la VM (NAS). Los discos de datos y de sistema están en el
      mismo almacenamiento iSCSI.
- [ ] Copia de seguridad de la CA (`/data/letsencrypt/internal-ca/`) en un sitio seguro fuera de la VM.
- [ ] Ajustes de la VM no aplicados al crearla: en `server03`,
      `qm set 121 --balloon 0 --agent enabled=1,fstrim_cloned_disks=1` y reiniciar.
- [ ] Distribuir la CA por GPO a los equipos del dominio.
- [ ] Quitar la línea de `cctv.tekusys.local` del fichero `hosts` del PC si se añadió para pruebas.

---

## 7. Notas de operación

- Los puertos publicados por Docker (80/443) **no pasan por UFW**: son accesibles desde cualquier
  red que llegue a 10.10.33.133. La protección efectiva es que no hay NAT desde Internet.
  Si hay que limitar por subred, hacerlo en el firewall o en la cadena `DOCKER-USER`.
- `update.sh` hace `git fetch`/`merge --ff-only` en `/opt/cctv`: **no editar ficheros del repo en
  la VM**. Los cambios se hacen en el PC, se suben a GitHub y la VM los descarga.
- Ampliar discos: `qm disk resize 121 scsi1 +100G` y en la VM `sudo resize2fs /dev/sdb`.
  Sistema: `qm disk resize 121 scsi0 +10G`, y `sudo growpart /dev/sda 1 && sudo resize2fs /dev/sda1`.
- Consola de Proxmox: es serie (`serial0`); pulsar Enter para ver el login. `cctv_admin` no tiene
  contraseña salvo que se haya puesto con `qm set 121 --cipassword`.
