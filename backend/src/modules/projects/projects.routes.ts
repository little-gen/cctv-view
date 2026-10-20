import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool.js';
import { currentUser, requireRole } from '../../middleware/auth.js';
import { HttpError, notFound } from '../../middleware/error.js';
import { buildUpdate } from '../../lib/sql.js';
import { idParam, optText } from '../../lib/validation.js';
import { audit, diff } from '../audit/audit.service.js';

export const projectsRouter = Router();

const projectSchema = z.object({
  name: z.string().trim().min(1).max(150),
  client: optText(150),
  address: optText(300),
  description: optText(2000),
});

projectsRouter.get('/', async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT p.*,
      (SELECT count(*)::int FROM floor_plans f WHERE f.project_id = p.id) AS plan_count,
      (SELECT count(*)::int FROM cameras c WHERE c.project_id = p.id) AS camera_count,
      (SELECT count(*)::int FROM cameras c WHERE c.project_id = p.id AND c.status = 'averiada') AS broken_count
    FROM projects p ORDER BY p.updated_at DESC`);
  res.json(rows);
});

projectsRouter.get('/:id', async (req, res) => {
  const { id } = idParam.parse(req.params);
  const { rows } = await pool.query('SELECT * FROM projects WHERE id = $1', [id]);
  if (!rows[0]) throw notFound('Proyecto');
  const plans = await pool.query(
    `SELECT f.*, (SELECT count(*)::int FROM cameras c WHERE c.floor_plan_id = f.id) AS camera_count
     FROM floor_plans f WHERE f.project_id = $1 ORDER BY sort_order, created_at`,
    [id],
  );
  res.json({ ...rows[0], plans: plans.rows });
});

projectsRouter.post('/', requireRole('admin'), async (req, res) => {
  const data = projectSchema.parse(req.body);
  const { rows } = await pool.query(
    `INSERT INTO projects (name, client, address, description, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [data.name, data.client ?? null, data.address ?? null, data.description ?? null, currentUser(req).id],
  );
  await audit(req, { action: 'create', entityType: 'project', entityId: rows[0].id, projectId: rows[0].id, changes: rows[0] });
  res.status(201).json(rows[0]);
});

projectsRouter.patch('/:id', requireRole('admin'), async (req, res) => {
  const { id } = idParam.parse(req.params);
  const data = projectSchema.partial().parse(req.body);
  const before = await pool.query('SELECT * FROM projects WHERE id = $1', [id]);
  if (!before.rows[0]) throw notFound('Proyecto');
  const upd = buildUpdate(data, 2);
  if (!upd.count) throw new HttpError(400, 'Nada que actualizar');
  const { rows } = await pool.query(`UPDATE projects SET ${upd.sql} WHERE id = $1 RETURNING *`, [id, ...upd.values]);
  await audit(req, { action: 'update', entityType: 'project', entityId: id, projectId: id, changes: diff(before.rows[0], rows[0]) });
  res.json(rows[0]);
});

projectsRouter.delete('/:id', requireRole('admin'), async (req, res) => {
  const { id } = idParam.parse(req.params);
  const { rows } = await pool.query('DELETE FROM projects WHERE id = $1 RETURNING *', [id]);
  if (!rows[0]) throw notFound('Proyecto');
  // Los ficheros quedan huérfanos en el almacenamiento: limpiarlos con una tarea periódica.
  await audit(req, { action: 'delete', entityType: 'project', entityId: id, projectId: id, changes: rows[0] });
  res.status(204).end();
});

/** Estadísticas agregadas del proyecto (opcionalmente de un plano). */
projectsRouter.get('/:id/stats', async (req, res) => {
  const { id } = idParam.parse(req.params);
  const planId = z.string().uuid().optional().parse(req.query.floorPlanId);
  const where = planId ? 'project_id = $1 AND floor_plan_id = $2' : 'project_id = $1';
  const params = planId ? [id, planId] : [id];
  const [totals, byType, byBrand] = await Promise.all([
    pool.query(
      `SELECT count(*)::int AS total,
        count(*) FILTER (WHERE status = 'operativa')::int AS operativas,
        count(*) FILTER (WHERE status = 'averiada')::int AS averiadas,
        count(*) FILTER (WHERE status = 'mantenimiento')::int AS mantenimiento
       FROM cameras WHERE ${where}`,
      params,
    ),
    pool.query(`SELECT type, count(*)::int AS count FROM cameras WHERE ${where} GROUP BY type ORDER BY type`, params),
    pool.query(
      `SELECT coalesce(brand, 'Sin marca') AS brand, count(*)::int AS count FROM cameras WHERE ${where} GROUP BY 1 ORDER BY 2 DESC`,
      params,
    ),
  ]);
  res.json({ ...totals.rows[0], byType: byType.rows, byBrand: byBrand.rows });
});
