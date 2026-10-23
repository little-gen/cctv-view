# Arquitectura

## Visión general

```
┌──────────────────────────── Navegador (PC / tablet / móvil) ────────────────────────────┐
│ React 19 + TypeScript + Tailwind 4 (Vite)                                                │
│                                                                                          │
│  Páginas ─► componentes ─► hooks React Query (api/hooks.ts) ─► api/client.ts (fetch+JWT) │
│                │                                                                         │
│                ├─ PlanCanvas (react-konva): zoom, pan, pinch, drag&drop, rotación, conos │
│                ├─ lib/coverage.ts: rejilla de cobertura → mapa de calor / zonas ciegas   │
│                ├─ lib/pdfToImage.ts: PDF → PNG con pdf.js (en el cliente)                │
│                └─ store/editorStore.ts (Zustand): selección, filtros, capas              │
└──────────────────────────────────────────┬───────────────────────────────────────────────┘
                                           │ HTTPS · REST JSON · multipart · Bearer JWT
┌──────────────────────────────────────────▼───────────────────────────────────────────────┐
│ Node.js + Express 5 (TypeScript, ESM)                                                    │
│                                                                                          │
│  middleware: helmet · cors · authenticate (JWT) · requireRole · multer · errorHandler    │
│  modules/   auth · users · projects · plans · nvrs · cameras · attachments · exports ·   │
│             audit            (rutas + validación Zod + SQL parametrizado)                │
│  storage/   StorageDriver (local hoy; S3/MinIO mañana)                                   │
│  exports/   PDFKit (plano A3 + informe) · ExcelJS (inventario)                           │
│  /api/docs  Swagger UI ← openapi.yaml                                                    │
└───────────────┬──────────────────────────────────────────────┬───────────────────────────┘
                │ pg (pool)                                    │ fs
        ┌───────▼────────┐                             ┌───────▼────────┐
        │ PostgreSQL 17  │                             │ storage/       │
        │ (ENUM, inet,   │                             │ planos, fotos, │
        │  jsonb audit)  │                             │ documentos     │
        └────────────────┘                             └────────────────┘
```

## Decisiones clave

| Decisión | Motivo |
|---|---|
| **Coordenadas normalizadas (0..1)** respecto a la imagen | Sustituir el plano (nueva revisión, otra resolución) conserva la configuración. Si cambia la proporción, la API devuelve un `warning`. |
| **Escala por plano (`width_m`)** | Los alcances se guardan en metros (dato técnico real) y se convierten a píxeles al dibujar. |
| **Ángulos**: 0° = derecha, sentido horario | Coincide con el sistema de canvas/Konva/PDFKit (eje Y hacia abajo): no hay conversiones. |
| **Konva (canvas)** en vez de SVG/DOM | Rinde con cientos de cámaras; arrastre y gestos táctiles nativos. Zoom/desplazamiento agrupados en un render por fotograma y marcadores memorizados. |
| **Plano por teselas** (Deep Zoom, `sharp`/libvips) | Al subir un plano se genera una pirámide de teselas WebP de 512 px y una vista previa de 2048 px. El navegador solo descarga y dibuja las teselas visibles al nivel del zoom, descodificadas con `createImageBitmap` (fuera del hilo principal) en una caché LRU acotada. Dibujar la imagen original completa (decenas de Mpx) bloqueaba el navegador varios segundos. Los planos antiguos se procesan la primera vez que se abren (o con `generate-tiles`). |
| **Iconos de tamaño constante** | Los marcadores se escalan con `1/zoom`: legibles con cualquier nivel de zoom. |
| **Tipo = forma + etiqueta + color** | Con 5 colores repartidos por el plano no hay paleta distinguible para todos los pares (validado, también con daltonismo); la forma y la etiqueta garantizan la identificación. Estado = color del borde, siempre con texto en la ficha y la lista. |
| **PDF → imagen en el cliente** (pdf.js) | El servidor solo recibe imágenes (PNG/JPEG/TIFF/WebP): sin Ghostscript ni poppler. Se rasteriza a la mayor resolución que admita el navegador (64 → 32 → 16 Mpx). |
| **Ficheros vía `fetch` + `blob:`** | Las imágenes y adjuntos requieren JWT; no se exponen URLs públicas ni tokens en la query string. |
| **Actualización optimista** (React Query) | Mover/rotar una cámara se refleja al instante; si el servidor falla, se revierte. |
| **Cobertura calculada en el cliente** | Interactiva (se recalcula al mover cámaras). Modelo 2D sin obstáculos; ver «Evolución». |
| **SQL directo + Zod** (sin ORM) | Esquema explícito, tipos PostgreSQL ricos (`inet`, `macaddr`, ENUM, `jsonb`) y consultas legibles. |
| **Auditoría en la misma transacción** | Cada alta/modificación/baja deja un registro coherente con el cambio (`diff` campo a campo). |

## Seguridad

- **Contraseñas**: bcrypt de coste 12; los hashes antiguos se actualizan al iniciar sesión. Política de al menos 12 caracteres, sin palabras obvias ni el propio usuario. Las contraseñas que fija el administrador son temporales: el usuario debe cambiarlas al entrar.
- **Sesiones**: JWT HS256 con caducidad (8 h) y versión de sesión. En cada petición se comprueba en la BD (con una caché de 5 s) que el usuario sigue activo y que la versión coincide. Cambiar la contraseña, el rol o el estado, restablecer el acceso o cerrar sesión invalida todos sus tokens. El rol se lee de la BD, no del token.
- **Bloqueo por cuenta**: tras 5 fallos seguidos, 1 min, y duplicando con cada fallo hasta 60 min. A esto se suman el límite por IP de nginx (5 por minuto) y fail2ban. Para no revelar qué cuentas existen, se ejecuta bcrypt también cuando el email no existe.
- **Restablecimiento de acceso por el administrador**: enlace de un solo uso con caducidad de 24 h. Solo se guarda el hash SHA-256 del token, y el token va en el fragmento `#` de la URL, así que no llega a los logs.
- En producción el servidor no arranca con un `JWT_SECRET` por defecto o corto.
- Autorización por rol en cada ruta (`requireRole`). Matriz:

| Acción | admin | tecnico | lectura |
|---|:-:|:-:|:-:|
| Consultar proyectos, planos, cámaras, adjuntos, historial de cámara | ✔ | ✔ | ✔ |
| Exportar PDF / Excel | ✔ | ✔ | ✔ |
| Crear/editar planos, cámaras, NVR, adjuntos | ✔ | ✔ | — |
| Eliminar planos | ✔ | — | — |
| Crear/editar/eliminar proyectos | ✔ | — | — |
| Usuarios y auditoría global | ✔ | — | — |

- Validación estricta de entrada (Zod) y SQL siempre parametrizado; las columnas de los `UPDATE` salen de listas blancas.
- **Subidas**: el tipo se comprueba por **contenido** (firma del fichero con `file-type`; los planos, decodificándolos con `sharp`) y se guarda el tipo real. Hay límites de tamaño, nombres generados (UUID) y protección contra *path traversal*. **Descargas**: solo las imágenes se muestran en el navegador; el resto se descarga como fichero (`attachment`). Todas llevan `nosniff` y una CSP `sandbox`.
- **API**: `Cache-Control: no-store` (salvo las teselas, que son inmutables), CSP `default-src 'none'`, sin ETag, y Swagger desactivado en producción (`API_DOCS`). Los errores de cliente (JSON o multipart mal formado) devuelven 4xx, nunca 500.
- **Base de datos**: la aplicación se conecta con el rol `cctv_app`, que no es superusuario ni puede cambiar el esquema. El registro de auditoría es de solo inserción para ese rol. Las migraciones usan el propietario.
- **nginx**: límites específicos para login y contraseñas, exportaciones, subidas, descargas y teselas; `/api/health` solo desde `HEALTH_ALLOW`.
- **Decisión de diseño (P-02)**: todos los usuarios son de Teku Systems y ven todos los proyectos; la autorización es por rol. Si en el futuro hay usuarios externos, harán falta permisos por proyecto.
- Pendiente: token en cookie `HttpOnly` (L-01; la CSP estricta ya mitiga el robo por XSS), inicio de sesión con Entra ID y antivirus para adjuntos.

## Evolución prevista

1. **ONVIF**: ya existen `onvif_url` y `onvif_username` en `cameras`. Añadir un módulo `onvif` (paquete `onvif` de npm) con *discovery* WS en la LAN del NVR, lectura de `GetDeviceInformation` (marca, modelo, firmware, MAC) para autocompletar la ficha, *snapshot* para la foto de referencia y comprobación periódica del estado (job → `status`): será el «estado de conexión» real de la ficha y de la pantalla de NVR, que hoy muestran el estado manual. Requiere que la VM llegue por red a las cámaras (puertos 80/554). Las credenciales irían a un almacén de secretos, no a la tabla.
2. **Cobertura realista**: polígonos de «zona a vigilar» y de obstáculos (muros, estanterías) por plano; *raycasting* desde cada cámara. Se puede mover a un Web Worker si crece el número de cámaras.
3. **Almacenamiento S3/MinIO**: implementar `StorageDriver` y elegirlo por variable de entorno.
4. **Multi-planta**: el modelo ya admite varios planos por proyecto; añadir vistas por edificio o planta.
5. **Offline en tablet** (PWA): caché de planos y cola de cambios para trabajar en nave sin cobertura.
6. **Tests**: Vitest para `coverage.ts`/`filters.ts`, Supertest para la API y Playwright para el editor.
