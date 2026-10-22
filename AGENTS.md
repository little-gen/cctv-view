# Contexto para asistentes de código

Aplicación PlanosCámaras: backend Node/Express/TypeScript (`backend/`), frontend React/Vite
(`frontend/`), despliegue con Docker Compose (`deploy/`). Documentación en `docs/` (ver README).

## Producción

Está desplegada en una VM interna de Teku Systems. **Antes de tocar `deploy/` o cualquier cosa que
afecte al despliegue, lee [docs/instalacion-tekusys.md](docs/instalacion-tekusys.md)**: recoge la
instalación real (IP, usuario, certificado, pendientes), que difiere de la guía genérica
`docs/despliegue-produccion.md`.

Puntos clave:
- URL `https://cctv.tekusys.local`, solo red interna/VPN. **Sin Let's Encrypt**: el certificado
  lo emite una CA interna con `deploy/scripts/init-internal-cert.sh`. No uses ni recomiendes
  `init-letsencrypt.sh` para esta instalación.
- VM 121 `cctv-prod` (10.10.33.133/23) en Proxmox `server03`. Usuario `cctv_admin`, no `deploy`.
- La VM se actualiza con `git pull` desde GitHub (`deploy/scripts/update.sh`). No se edita código
  en la VM: los cambios se hacen aquí, se suben y la VM los descarga.
- Los scripts `.sh` deben tener LF (`.gitattributes`) y modo ejecutable en git
  (`git update-index --chmod=+x`), porque se editan desde Windows.
- Nunca subas `.env` ni claves (`.gitignore`).
