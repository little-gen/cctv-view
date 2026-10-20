# Modelo de datos

Esquema completo: [`backend/migrations/001_init.sql`](../backend/migrations/001_init.sql).

```
users ─────────────┐ (created_by / updated_by / uploaded_by / audit.user_id)
                   │
projects 1───N floor_plans 1───N floor_plan_images   (histórico de versiones del plano)
   │                   │
   │ 1                 │ 1
   N                   N
  nvrs 1───────N   cameras 1───N attachments (foto | documento)
                  (project_id desnormalizado para filtros y unicidad del código)

audit_log  (entity_type + entity_id + project_id, changes jsonb)
```

## Tablas

### `users`
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| email | text | único sin distinguir mayúsculas (`lower(email)`) |
| name | text | |
| password_hash | text | bcrypt |
| role | `user_role` | `admin` · `tecnico` · `lectura` |
| active | boolean | baja lógica (se conserva la trazabilidad) |
| last_login_at, created_at, updated_at | timestamptz | |

### `projects` (ubicación / instalación)
`id, name, client, address, description, created_by, created_at, updated_at`

### `floor_plans` (nave / planta)
| Campo | Tipo | Notas |
|---|---|---|
| project_id | uuid FK → projects (cascade) | |
| name | text | «Nave 1 – Planta baja» |
| storage_key, mime_type, width_px, height_px | | imagen **vigente** (null hasta la primera subida) |
| width_m | float > 0 | metros reales que abarca el ancho de la imagen (**escala**) |
| version | int | se incrementa al sustituir la imagen |
| sort_order | int | orden de las pestañas |

### `floor_plan_images`
Histórico de cada imagen subida: `floor_plan_id, version, storage_key, mime_type, width_px, height_px, original_name, uploaded_by`. Único `(floor_plan_id, version)`.

### `nvrs`
`project_id, name (único por proyecto), brand, model, ip_address inet, channels, location, notes`.

### `cameras`
| Campo | Tipo | Notas |
|---|---|---|
| project_id | uuid FK | desnormalizado: filtros rápidos y `UNIQUE (project_id, code)` |
| floor_plan_id | uuid FK (cascade) | |
| nvr_id | uuid FK (set null) | NVR asociado |
| code | text | código/ID; autogenerado `CAM-001…` si no se indica |
| name | text | |
| type | `camera_type` | `domo` · `bullet` · `ptz` · `termica` · `lpr` |
| brand, model, resolution, physical_location, notes | text | |
| ip_address | inet | validada; búsqueda por IP con `host()` |
| mac_address | macaddr | |
| status | `camera_status` | `operativa` · `averiada` · `mantenimiento` |
| installed_at | date | |
| pos_x, pos_y | float [0..1] | posición **normalizada** sobre la imagen |
| rotation_deg | float [0..360) | 0° = derecha, sentido horario |
| fov_deg | float (0..360] | ángulo de visión; por defecto según tipo (PTZ = 360) |
| range_m | float > 0 | alcance útil en metros |
| onvif_url, onvif_username | text | preparado para la integración ONVIF |
| created_by, updated_by, created_at, updated_at | | |

| search_text | text | texto de búsqueda normalizado (migración 002, mantenido por triggers; ver [búsqueda global](busqueda-global.md)) |

Índices: `(floor_plan_id)`, `(project_id, status, type)`, `(project_id, lower(brand))`, `(ip_address)`; búsqueda global: `GIN (search_text gin_trgm_ops)`, `(status, type)`, `(lower(brand))`, `(nvr_id)`.

### `attachments`
`camera_id (cascade), kind (foto|documento), original_name, mime_type, size_bytes, storage_key, description, uploaded_by, created_at`. El tipo se deduce del MIME si no se indica.

### `audit_log`
| Campo | Notas |
|---|---|
| id bigserial, occurred_at | |
| user_id, user_email | se conserva el email aunque el usuario se borre |
| action | `create` · `update` · `delete` · `login` · `export` |
| entity_type, entity_id, project_id | `camera`, `floor_plan`, `nvr`, `attachment`, `project`, `user` |
| changes jsonb | `update`: `{campo: {from, to}}`; `create`/`delete`: instantánea completa |
| ip | |

## Convenciones

- Todas las tablas con `updated_at` lo mantienen con el *trigger* `set_updated_at()`.
- Las migraciones son ficheros SQL numerados en `backend/migrations/`, aplicados en orden y registrados en `schema_migrations` (`npm run db:migrate`).
- Borrar un proyecto o un plano borra en cascada sus cámaras y adjuntos en la BD. Los ficheros físicos huérfanos se limpian con una tarea periódica (pendiente).
