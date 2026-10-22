# PlanosCámaras

Aplicación web responsive para documentar cámaras de videovigilancia sobre planos de naves industriales: colocar cámaras sobre el plano, orientar su cono de visión, guardar su ficha técnica con fotos y documentos, analizar la cobertura y exportar planos, informes e inventario.

- **Frontend**: React 19 · TypeScript · Tailwind CSS 4 · Vite · react-konva · TanStack Query · Zustand
- **Backend**: Node.js · Express 5 · TypeScript · Zod · PDFKit · ExcelJS
- **Base de datos**: PostgreSQL 17
- **API REST** documentada con OpenAPI 3.1 (Swagger UI en `/api/docs`)

Documentación: [arquitectura](docs/arquitectura.md) · [modelo de datos](docs/modelo-datos.md) · [pantallas](docs/pantallas.md) · [búsqueda global](docs/busqueda-global.md) · **[despliegue en producción (Proxmox + Docker)](docs/despliegue-produccion.md)** · **[instalación real en Teku Systems](docs/instalacion-tekusys.md)**

## Puesta en marcha

Requisitos: Node.js ≥ 20 y Docker (o un PostgreSQL ≥ 13 propio).

```bash
npm install                       # instala backend y frontend (npm workspaces)
cp backend/.env.example backend/.env
npm run db:up                     # PostgreSQL en Docker (localhost:5432)
npm run db:migrate                # crea el esquema
npm run db:seed                   # usuarios de demo
npm run dev                       # API :4000 + web :5173
```

Abre http://localhost:5173. Usuarios de demo:

| Rol | Correo | Contraseña |
|---|---|---|
| Administrador | admin@example.com | Admin123! |
| Técnico | tecnico@example.com | Tecnico123! |
| Solo lectura | lectura@example.com | Lectura123! |

Flujo básico: crear proyecto → crear plano (nombre y ancho real en metros) → subir imagen o PDF → arrastrar cámaras desde la paleta → completar la ficha.

Otros comandos:
- `npm run typecheck`, `npm run build`
- `npm run smoke -w backend`: prueba end-to-end de la API (con la API arrancada y la BD migrada + seed).
- `npm run seed:bulk -w backend -- 300 100`: 300 proyectos × 100 cámaras de demo (`-- --clean` para borrarlos).
- `npm run search-check -w backend`: pruebas funcionales y de rendimiento de la búsqueda global (requiere `seed:bulk`).

La migración `002` necesita las extensiones `pg_trgm` y `unaccent` (incluidas en PostgreSQL; el usuario `planos` de Docker puede crearlas).

## Estructura

```
PlanosCamaras/
├── docker-compose.yml            PostgreSQL de desarrollo
├── package.json                  workspaces + scripts globales
├── docs/                         arquitectura, modelo de datos, pantallas
├── backend/
│   ├── migrations/001_init.sql   esquema (ENUM, tablas, índices, triggers)
│   ├── openapi.yaml              especificación de la API
│   ├── scripts/smoke.mjs         prueba de humo end-to-end
│   └── src/
│       ├── index.ts · app.ts · config.ts · domain.ts
│       ├── db/                   pool, migrador, seed
│       ├── middleware/           auth (JWT + roles), errores, subidas
│       ├── storage/              StorageDriver (disco local; S3 en el futuro)
│       ├── lib/                  helpers SQL y validación
│       └── modules/
│           ├── auth/ users/ projects/ plans/ nvrs/
│           ├── cameras/          esquemas Zod, repositorio y rutas
│           ├── attachments/      fotos y documentos
│           ├── exports/          PDF del plano, informe PDF, Excel
│           └── audit/            servicio de auditoría + consulta
└── frontend/
    └── src/
        ├── main.tsx · App.tsx · index.css (tema)
        ├── api/                  cliente fetch + hooks React Query
        ├── auth/                 contexto de sesión y permisos
        ├── store/                estado del editor (Zustand)
        ├── lib/                  tipos de cámara, filtros, cobertura, PDF→PNG
        ├── components/
        │   ├── plan/             PlanCanvas, CameraMarker, paleta, subida, modales
        │   ├── cameras/          panel lateral, ficha, iconos
        │   ├── stats/            estadísticas
        │   └── ui/               modal, menú desplegable
        └── pages/                Login, Proyectos, Workspace, Usuarios, Auditoría
```

## API (resumen)

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/auth/login` | Login → JWT |
| GET/POST | `/api/projects` | Proyectos |
| GET | `/api/projects/:id` | Proyecto con planos |
| GET | `/api/projects/:id/stats` | Estadísticas |
| POST | `/api/projects/:id/plans` | Nuevo plano |
| PUT | `/api/plans/:id/image` | Subir/sustituir imagen (conserva cámaras) |
| GET/POST | `/api/projects/:id/cameras` | Listar (filtros `status`, `type`, `brand`, `q`) / crear |
| GET/PATCH/DELETE | `/api/cameras/:id` | Ficha de cámara |
| GET | `/api/cameras/:id/history` | Historial de cambios |
| GET/POST | `/api/cameras/:id/attachments` | Fotos y documentos |
| GET/POST | `/api/projects/:id/nvrs` | NVR |
| GET | `/api/plans/:id/export/pdf` | Plano con cámaras (PDF A3) |
| GET | `/api/projects/:id/export/report.pdf` | Informe técnico |
| GET | `/api/projects/:id/export/inventory.xlsx` | Inventario Excel |
| GET | `/api/search` | Búsqueda global en todos los proyectos (texto + filtros, agrupada, con estadísticas) |
| GET | `/api/audit` | Auditoría (admin) |

Detalle completo en http://localhost:4000/api/docs.

## Estado

Implementado en esta base inicial: todo lo descrito arriba, incluida la cobertura (mapa de calor, zonas sin cobertura y % cubierto) y la auditoría. Próximos pasos en [docs/arquitectura.md § Evolución prevista](docs/arquitectura.md#evolución-prevista): ONVIF, obstáculos y zona a vigilar en el cálculo de cobertura, almacenamiento S3, PWA offline y tests automatizados.
