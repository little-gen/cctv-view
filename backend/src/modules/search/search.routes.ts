import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool.js';
import { CAMERA_STATUSES, CAMERA_TYPES, type CameraStatus, type CameraType } from '../../domain.js';
import { csvList } from '../../lib/validation.js';

export const searchRouter = Router();

const querySchema = z.object({
  q: z.string().trim().max(100).default(''),
  projectId: z.string().uuid().optional(),
  type: csvList([...CAMERA_TYPES]),
  status: csvList([...CAMERA_STATUSES]),
  brand: z.string().max(300).optional(), // lista separada por comas, sin distinguir mayúsculas
  nvrId: z.string().uuid().optional(),
  perProject: z.coerce.number().int().min(1).max(200).default(8),
  limit: z.coerce.number().int().min(1).max(500).default(150),
});

type SearchQuery = z.infer<typeof querySchema>;

const MAX_TOKENS = 6;
const escapeLike = (s: string) => s.replace(/[\\%_]/g, '\\$&');

/**
 * Construye el WHERE. Cada palabra de la consulta debe aparecer (AND) en
 * search_text: "hik almacen" = Hikvision ubicadas en el almacén.
 * `withFilters=false` se usa para las facetas (opciones de los filtros).
 */
function buildWhere(q: SearchQuery, withFilters: boolean) {
  const where: string[] = [];
  const params: unknown[] = [];
  const p = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };

  const tokens = q.q.split(/\s+/).filter(Boolean).slice(0, MAX_TOKENS);
  for (const t of tokens) {
    where.push(`c.search_text LIKE '%' || search_norm(${p(escapeLike(t))}) || '%'`);
  }
  if (withFilters) {
    if (q.projectId) where.push(`c.project_id = ${p(q.projectId)}`);
    if (q.type?.length) where.push(`c.type = ANY(${p(q.type)}::camera_type[])`);
    if (q.status?.length) where.push(`c.status = ANY(${p(q.status)}::camera_status[])`);
    if (q.brand) where.push(`lower(c.brand) = ANY(${p(q.brand.split(',').map((b) => b.trim().toLowerCase()).filter(Boolean))})`);
    if (q.nvrId) where.push(`c.nvr_id = ${p(q.nvrId)}`);
  }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params, p };
}

export interface SearchHit {
  id: string;
  project_id: string;
  project_name: string;
  floor_plan_id: string;
  plan_name: string;
  code: string;
  name: string;
  type: CameraType;
  status: CameraStatus;
  ip_address: string | null;
  physical_location: string | null;
  brand: string | null;
  model: string | null;
  nvr_name: string | null;
  notes: string | null;
  project_hits: number;
}

/**
 * GET /api/search?q=&projectId=&type=&status=&brand=&nvrId=
 * Busca en todos los proyectos. Devuelve estadísticas del total de coincidencias,
 * resultados agrupados por proyecto (hasta `perProject` por proyecto) y facetas.
 */
searchRouter.get('/', async (req, res) => {
  const started = performance.now();
  const q = querySchema.parse(req.query);
  const perProject = q.projectId ? q.limit : q.perProject;

  const filtered = buildWhere(q, true);
  const textOnly = buildWhere(q, false);

  // Relevancia dentro de cada proyecto: coincidencia exacta de código/IP,
  // después nombre que empieza por la consulta, después el resto.
  const qExact = filtered.p(q.q);
  const qPrefix = filtered.p(escapeLike(q.q));
  const rank = `CASE
      WHEN lower(c.code) = lower(${qExact}) OR host(c.ip_address) = ${qExact} THEN 0
      WHEN search_norm(c.name) LIKE search_norm(${qPrefix}) || '%' THEN 1
      ELSE 2 END`;
  const perProjectParam = filtered.p(perProject);
  const limitParam = filtered.p(q.limit);

  const nvrFacetWhere = q.projectId ? `WHERE t.project_id = $${textOnly.params.push(q.projectId)}` : '';

  const [rows, stats, facets] = await Promise.all([
    pool.query<SearchHit>(
      `WITH m AS (
         SELECT c.id, c.project_id, c.code, ${rank} AS rank FROM cameras c ${filtered.sql}
       ), ranked AS (
         SELECT m.*,
           row_number() OVER (PARTITION BY project_id ORDER BY rank, code) AS rn,
           count(*) OVER (PARTITION BY project_id)::int AS project_hits
         FROM m
       )
       SELECT c.id, c.project_id, p.name AS project_name, c.floor_plan_id, f.name AS plan_name,
              c.code, c.name, c.type, c.status, host(c.ip_address) AS ip_address, c.physical_location,
              c.brand, c.model, n.name AS nvr_name, left(c.notes, 300) AS notes, r.project_hits
       FROM ranked r
       JOIN cameras c ON c.id = r.id
       JOIN projects p ON p.id = c.project_id
       JOIN floor_plans f ON f.id = c.floor_plan_id
       LEFT JOIN nvrs n ON n.id = c.nvr_id
       WHERE r.rn <= ${perProjectParam}
       ORDER BY r.project_hits DESC, p.name, r.project_id, r.rank, c.code
       LIMIT ${limitParam}`,
      filtered.params,
    ),
    pool.query<{ total: number; projects: number; by_type: Record<string, number>; by_status: Record<string, number> }>(
      `WITH m AS (SELECT c.project_id, c.type, c.status FROM cameras c ${buildWhere(q, true).sql})
       SELECT (SELECT count(*)::int FROM m) AS total,
              (SELECT count(DISTINCT project_id)::int FROM m) AS projects,
              (SELECT coalesce(json_object_agg(type, n), '{}') FROM (SELECT type, count(*)::int n FROM m GROUP BY type) t) AS by_type,
              (SELECT coalesce(json_object_agg(status, n), '{}') FROM (SELECT status, count(*)::int n FROM m GROUP BY status) s) AS by_status`,
      buildWhere(q, true).params,
    ),
    // Facetas: opciones de filtro según el texto buscado (sin aplicar los propios filtros)
    pool.query<{ projects: unknown; brands: unknown; nvrs: unknown }>(
      `WITH t AS (SELECT c.project_id, c.brand, c.nvr_id FROM cameras c ${textOnly.sql})
       SELECT
         (SELECT coalesce(json_agg(x ORDER BY x.name), '[]') FROM (
            SELECT p.id, p.name, count(*)::int AS count FROM t JOIN projects p ON p.id = t.project_id GROUP BY p.id, p.name
          ) x) AS projects,
         (SELECT coalesce(json_agg(x ORDER BY x.count DESC, x.brand), '[]') FROM (
            SELECT min(t.brand) AS brand, count(*)::int AS count FROM t WHERE t.brand IS NOT NULL GROUP BY lower(t.brand) ORDER BY 2 DESC LIMIT 100
          ) x) AS brands,
         (SELECT coalesce(json_agg(x ORDER BY x.project_name, x.name), '[]') FROM (
            SELECT n.id, n.name, p.name AS project_name, count(*)::int AS count
            FROM t JOIN nvrs n ON n.id = t.nvr_id JOIN projects p ON p.id = n.project_id ${nvrFacetWhere}
            GROUP BY n.id, n.name, p.name LIMIT 300
          ) x) AS nvrs`,
      textOnly.params,
    ),
  ]);

  // Agrupar por proyecto conservando el orden de la consulta
  const groups: { project: { id: string; name: string }; hits: number; cameras: Omit<SearchHit, 'project_hits'>[] }[] = [];
  for (const { project_hits, ...hit } of rows.rows) {
    let g = groups[groups.length - 1];
    if (!g || g.project.id !== hit.project_id) {
      g = { project: { id: hit.project_id, name: hit.project_name }, hits: project_hits, cameras: [] };
      groups.push(g);
    }
    g.cameras.push(hit);
  }

  const s = stats.rows[0];
  res.json({
    total: s.total,
    projectCount: s.projects,
    byType: s.by_type,
    byStatus: s.by_status,
    shown: rows.rows.length,
    truncated: rows.rows.length < s.total,
    groups,
    facets: facets.rows[0],
    tookMs: Math.round(performance.now() - started),
  });
});
