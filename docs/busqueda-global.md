# Búsqueda global de cámaras

Barra de búsqueda siempre visible en la cabecera que busca **en todos los proyectos a la vez**, con autocompletado, filtros avanzados, estadísticas y navegación directa a la cámara en su plano.

## 1. Interfaz

### Cabecera (todas las pantallas)
```
┌ ◉ │ 🔍 Buscar cámaras: nombre, ID, IP, marca, NVR, ubicación…  ⟳ ✕ ⚙² Ctrl K │ 👥 🕘 │ ⎋ ┐
```
- **Ctrl/⌘ + K** o **/** enfocan el buscador desde cualquier pantalla.
- ⟳ indica búsqueda en curso, ✕ borra el texto y ⚙ abre los filtros avanzados (con el número de filtros activos).
- Se busca a partir de **2 caracteres** o con algún filtro activo. Debounce de 120 ms y cancelación de la petición anterior: los resultados se actualizan mientras se escribe sin saturar el servidor.

### Panel de resultados (desplegable en escritorio; pantalla completa en móvil)
```
┌──────────────────────────────────────────────────────────────────────────────┐
│ [Todos los proyectos ▾]   [Todos los fabricantes ▾]   [Todos los NVR ▾]       │  ← filtros
│ (● D Domo)(▬ B Bullet)(⬡ PTZ)(◆ T Térmica)(■ LPR) │ (●Operativa)(●Averiada)… │    avanzados
├──────────────────────────────────────────────────────────────────────────────┤
│ 1.300 coincidencias · 300 proyectos · ●260 ▬260 ⬡260 ◆260 ■260 · ●41 averiadas│  ← estadísticas
├──────────────────────────────────────────────────────────────────────────────┤
│ ▣ DEMO 002 · Puerto Seco                         6 cámaras                    │  ← grupo por
│  ● Almacén 2              CAM-002                                             │    proyecto
│    Domo · ● Operativa · 192.168.2.3 · 📍 Almacén, columna 2 · Planta baja     │
│    Marca: Hikvision                                                           │  ← campo que
│  ▬ Almacén 8              CAM-008                                     ›       │    coincide
│ ▣ DEMO 007 · Almacén Central                    100 cámaras   Ver las 100     │
│  …                                                                            │
│                Mostrando 150 de 1.300. Afina la búsqueda o filtra…            │
└──────────────────────────────────────────────────────────────────────────────┘
```
- **Agrupado por proyecto**, con los proyectos con más coincidencias primero. Se muestran hasta 8 cámaras por proyecto; «Ver las N» filtra por ese proyecto y las lista todas.
- **Cada resultado** muestra el proyecto (cabecera del grupo), el nombre y el ID de la cámara, el tipo (forma + texto), el estado (punto + texto), la IP, la ubicación y el plano. Las coincidencias se **resaltan**, también sin tilde ("almacen" → **Almacén**).
- Si la coincidencia está en un campo que no se muestra (marca, modelo, NVR u observaciones), aparece debajo un fragmento de ese campo.
- Teclado: ↑/↓ para moverse, Intro para abrir y Esc para cerrar. Accesible como `combobox` + `listbox`.

### Al elegir un resultado
1. Se abre el proyecto y el plano de la cámara (`/projects/:id/plans/:planId?camera=:camId`).
2. Si los filtros locales del panel lateral la ocultaban, se quitan.
3. El plano se **centra en la cámara** y hace **zoom** hasta que su alcance ocupa ~40% de la vista.
4. La cámara se **resalta** con anillos expansivos durante unos segundos y queda dibujada por encima del resto.
5. En escritorio y tablet se abre su ficha. En móvil no, para no tapar el plano: basta con tocar el icono para abrirla.

El texto y los filtros se conservan, así que se puede volver a abrir el buscador (Ctrl+K) y pasar al siguiente resultado.

## 2. Modelo de datos

Migración [`backend/migrations/002_global_search.sql`](../backend/migrations/002_global_search.sql).

| Elemento | Descripción |
|---|---|
| Extensiones `pg_trgm`, `unaccent` | Trigramas para `LIKE '%…%'` indexado y eliminación de acentos. |
| `f_unaccent(text)` | Envoltorio `IMMUTABLE` de `unaccent` (requisito para usarlo en índices). |
| `search_norm(text)` | `lower(f_unaccent(...))`: misma normalización para datos y consultas. |
| `cameras.search_text` | Texto desnormalizado: código, nombre, IP, MAC, marca, modelo, ubicación, observaciones, **nombre del NVR** y **nombre del proyecto**. |
| Trigger `cameras_search` | Recalcula `search_text` en cada alta o modificación de la cámara. |
| Triggers `projects_search` / `nvrs_search` | Al renombrar un proyecto o un NVR, recalculan el texto de sus cámaras. |
| `cameras_updated` | Ahora `WHEN (pg_trigger_depth() = 0)`: las actualizaciones en cascada no alteran `updated_at`. |
| Índice `cameras_search_trgm` | `GIN (search_text gin_trgm_ops)`. |
| Índices de filtros globales | `(status, type)`, `(lower(brand))`, `(nvr_id)`. Los anteriores llevaban `project_id` delante y no servían para buscar en todos los proyectos. |

¿Por qué desnormalizar en vez de hacer `JOIN` con proyectos y NVR? Porque un `OR` entre columnas de tablas distintas impide usar un único índice. Con todo el texto en una columna, cada palabra se resuelve con un *bitmap index scan* sobre el índice de trigramas. El coste es actualizar las N cámaras al renombrar un proyecto, que es una operación rara.

## 3. API

`GET /api/search` (cualquier rol autenticado)

| Parámetro | Ejemplo | Descripción |
|---|---|---|
| `q` | `hik almacen` | Palabras separadas por espacios; deben aparecer **todas** (AND), en cualquier campo y de forma parcial. Sin distinguir mayúsculas ni acentos. `%` y `_` se tratan como texto. |
| `projectId` | uuid | Filtro por proyecto (lista todas sus coincidencias). |
| `type` | `ptz,lpr` | Tipos, separados por comas. |
| `status` | `averiada` | Estados. |
| `brand` | `axis,dahua` | Fabricantes, sin distinguir mayúsculas. |
| `nvrId` | uuid | NVR asociado. |
| `perProject` | `8` | Resultados máximos por proyecto (1–200). |
| `limit` | `150` | Resultados máximos totales (1–500). |

Respuesta:
```jsonc
{
  "total": 1300, "projectCount": 300,                 // del total de coincidencias, no de lo mostrado
  "byType": { "domo": 260, "ptz": 260, … }, "byStatus": { "averiada": 41, … },
  "shown": 150, "truncated": true,
  "groups": [{ "project": { "id": "…", "name": "…" }, "hits": 6,
               "cameras": [{ "id", "code", "name", "type", "status", "ip_address", "physical_location",
                             "brand", "model", "nvr_name", "notes", "floor_plan_id", "plan_name", … }] }],
  "facets": {                                          // opciones para los filtros según el texto buscado
    "projects": [{ "id", "name", "count" }], "brands": [{ "brand", "count" }],
    "nvrs": [{ "id", "name", "project_name", "count" }]
  },
  "tookMs": 18
}
```

Ejecuta tres consultas en paralelo:
1. **Resultados**: CTE con las coincidencias, ranking por proyecto con `row_number() OVER (PARTITION BY project_id)` y `LIMIT`. Relevancia dentro del proyecto: código o IP exactos, después nombre que empieza por la consulta, después el resto.
2. **Estadísticas** sobre el conjunto completo.
3. **Facetas**, calculadas solo con el texto, para que los desplegables ofrezcan opciones con su recuento sin quedarse vacíos al filtrar.

## 4. Frontend

| Fichero | Cambio |
|---|---|
| `components/search/GlobalSearch.tsx` | Input, atajos, debounce, teclado y navegación. |
| `components/search/SearchFilters.tsx` | Filtros de proyecto, fabricante, NVR, tipo y estado (opciones desde las facetas). |
| `components/search/SearchStats.tsx` | Coincidencias, proyectos y desglose por tipo y estado. |
| `components/search/SearchResults.tsx` | Lista agrupada, resaltado y campo que coincide. |
| `store/searchStore.ts` | Texto y filtros (persisten al navegar). |
| `lib/text.ts` | Normalización sin acentos, resaltado y fragmentos. |
| `api/hooks.ts` | `useGlobalSearch` (React Query, `keepPreviousData`, cancelación con `AbortSignal`). Las mutaciones de cámaras invalidan la búsqueda. |
| `layout/AppShell.tsx` | Buscador en la cabecera. |
| `pages/WorkspacePage.tsx` | Procesa `?camera=`. |
| `plan/PlanCanvas.tsx`, `plan/CameraMarker.tsx` | Foco pendiente hasta que el plano está listo, zoom al alcance y pulso de resaltado. |
| `cameras/CameraSidebar.tsx` | El buscador lateral pasa a «Filtrar este plano». |

## 5. Rendimiento medido

Con `npm run seed:bulk -w backend -- 300 100` (**300 proyectos, 30.000 cámaras**) y `npm run search-check -w backend`:

- Consulta selectiva (`bascula`): *Bitmap Index Scan* sobre `cameras_search_trgm`, **1,2 ms** en la BD.
- Términos muy frecuentes (`nocturno`, 11% de las filas): PostgreSQL elige un *seq scan*, que es lo correcto con esa selectividad: ~13 ms.
- API completa (3 consultas + JSON), 30 búsquedas variadas: **p50 72 ms, p95 177 ms**.

Estas cifras salen de PGlite: PostgreSQL 17 compilado a WebAssembly, con una sola conexión, de modo que las 3 consultas se ejecutaron en serie. En un PostgreSQL nativo con pool deberían ser bastante menores, pero conviene volver a medir en el entorno real con `search-check`.

Si el volumen creciera mucho más (cientos de miles de cámaras):
- Limitar o cachear las facetas cuando no hay texto.
- Calcular `total` con un límite (`count` sobre `LIMIT 10001` → «más de 10.000»).
- Pasar a búsqueda de texto completo (`tsvector`) para palabras completas, manteniendo los trigramas para IP y códigos parciales.
