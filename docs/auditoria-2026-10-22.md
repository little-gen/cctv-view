# Respuesta a la auditoría de seguridad del 22/10/2026

Estado de cada hallazgo del informe de auditoría de caja negra de `cctv.tekusys.local` tras los cambios del bloque A. Cada corrección tiene una prueba automática que la verifica:

- [`backend/scripts/security-check.mjs`](../backend/scripts/security-check.mjs): 58 comprobaciones contra la API y los privilegios de la base de datos.
- [`backend/scripts/smoke.mjs`](../backend/scripts/smoke.mjs): regresión funcional.

## Hallazgos del informe

| ID | Hallazgo | Estado | Corrección |
|---|---|---|---|
| M-01 | Swagger y OpenAPI públicos | **Corregido** | Desactivados en producción (`API_DOCS=false`). `/api/docs` y `/api/openapi.json` → 401. |
| M-02 | Rate limiting insuficiente | **Corregido** | El informe partía de una premisa inexacta: ya existía un límite general de 30 peticiones/s con ráfaga de 60. Lo cierto es que faltaban límites específicos. Ahora hay zonas propias para exportaciones (10/min), subidas (30/min), descargas (10/s), login y contraseñas (5/min) y teselas, además de `limit_conn` por IP. |
| M-03 | Bloqueo solo por IP | **Corregido** | Bloqueo por cuenta: tras 5 fallos, 1 min, y duplicando hasta 60 min. El administrador ve el bloqueo y puede quitarlo. Los fallos se auditan (`login_failed`). nginx responde 429 sin retardo (`nodelay`). |
| M-04 | Sin `Cache-Control` en la API | **Corregido** | `Cache-Control: no-store` y `Pragma: no-cache` en toda la API, y sin ETag. Excepción: las teselas del plano, con caché privada e inmutable porque su URL incluye la versión. |
| M-05 | CA interna sin distribuir; sin OCSP/CRL | **Operación** | Distribuir la CA por GPO (pendiente en `instalacion-tekusys.md`). Con una CA interna de un solo certificado, OCSP y CRL apenas aportan: se recomienda un certificado de 1 año con aviso de renovación y la clave de la CA fuera de la VM. |
| L-01 | JWT en `localStorage` | Aceptado (por ahora) | Mitigado por la CSP estricta (sin `unsafe-inline` ni `unsafe-eval` en scripts) y la revocación de sesiones. El paso a cookie `HttpOnly` queda para una fase posterior. |
| L-02 | `/api/health` público | **Corregido** | Solo desde `HEALTH_ALLOW` (127.0.0.1 por defecto) → 403 desde fuera. El healthcheck de Docker y Uptime Kuma usan la red interna. |
| L-03 | Relajaciones de la CSP | **Corregido** | SPA: `style-src 'self'` y `style-src-attr 'unsafe-inline'` (solo atributos `style`, que React necesita). `wasm-unsafe-eval` se mantiene porque lo necesita pdf.js para convertir planos en PDF. API: `default-src 'none'`. Verificado en el navegador: sin violaciones de CSP en todo el recorrido. |

## Verificaciones que el informe dejó pendientes

| ID | Área | Estado |
|---|---|---|
| P-01 | RBAC | Autorización en el servidor en cada ruta (`requireRole`). Probado: `lectura` no puede escribir, `tecnico` no accede a usuarios ni a la auditoría, y un cambio de rol se aplica al instante. |
| P-02 | IDOR entre proyectos | **Decisión de diseño**: todos los usuarios son de Teku Systems y ven todos los proyectos. Los IDs son UUID v4, no enumerables. Si hubiera usuarios externos, harían falta permisos por proyecto. |
| P-03 | Subida de ficheros | **Corregido**: el tipo se valida por contenido (firma del fichero; los planos, decodificándolos) y se guarda el tipo real. Se rechazan HTML, SVG o ejecutables disfrazados (415). Nombres en UUID, fuera del *webroot*, con límites de tamaño. Los nombres con caracteres de control dan 400 (antes, 500). |
| P-04 | Descarga de ficheros | **Corregido**: requiere sesión. Solo las imágenes se muestran en el navegador; el resto se descarga (`attachment`). Todas llevan `nosniff` y una CSP `sandbox`. |
| P-05 | Inyección | SQL siempre parametrizado. Las columnas de los `UPDATE` salen de listas blancas. Los comodines de `LIKE` se escapan en la búsqueda global. |
| P-06 | Ciclo de vida del token | **Corregido**: el token caduca en 8 h y existe *logout* en el servidor. Cambiar la contraseña, el rol o el estado, o restablecer el acceso, revoca todas las sesiones al instante. |
| P-07 | Hash de contraseñas | **Corregido**: bcrypt de coste 12, con actualización automática de los hashes antiguos. Política de al menos 12 caracteres, sin palabras obvias ni el propio usuario. Contraseñas temporales con cambio obligatorio. |
| P-08 | Auditoría | **Corregido**: el rol de la aplicación solo puede insertar en `audit_log`; no puede modificar, borrar ni vaciar. Se auditan accesos, fallos, cierres de sesión, cambios y restablecimientos de contraseña y exportaciones. |
| P-09 | Transacciones | Altas y cambios de cámara, con su historial, van en una transacción. La imagen de un plano se valida y se procesa antes de confirmar la nueva versión. |
| P-10 | Configuración | Con `NODE_ENV=production`, el servidor no arranca con un `JWT_SECRET` por defecto o de menos de 32 caracteres. Secretos en `.env` con `chmod 600`, fuera del repositorio. |
| P-11 | Base de datos | **Corregido**: PostgreSQL en una red Docker interna sin puertos publicados. La aplicación usa el rol `cctv_app`, sin privilegios de administración ni de esquema. Copias diarias con restauración **probada** con `restore.sh`, que antes fallaba al leer el `.env` y ya está corregido. |

## Otros fallos encontrados durante la corrección

- `restore.sh` e `init-letsencrypt.sh` no podían leer `.env` (`BACKUP_SCHEDULE=0 3 * * *`).
- Las peticiones con JSON o multipart mal formado devolvían 500 en lugar de 400.
- Un usuario desactivado conservaba el acceso hasta 8 h, porque su token seguía siendo válido.
- Cuando nginx limitaba el login, la aplicación mostraba «Error 429»; ahora da un mensaje comprensible.

## Para la segunda ronda (con credenciales)

- Hacerla sobre una copia de la VM (*Clone* en Proxmox), no sobre producción.
- Crear un usuario de cada rol (`admin`, `tecnico`, `lectura`) con contraseñas temporales.
- Ejecutar `security-check.mjs` como punto de partida: el procedimiento está en `instalacion-tekusys.md`.
