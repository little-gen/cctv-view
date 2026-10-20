import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool.js';
import { EDITOR_ROLES } from '../../domain.js';
import { requireRole } from '../../middleware/auth.js';
import { HttpError, notFound } from '../../middleware/error.js';
import { buildUpdate } from '../../lib/sql.js';
import { idParam, optText } from '../../lib/validation.js';
import { audit, diff } from '../audit/audit.service.js';

export const nvrsRouter = Router();

const nvrSchema = z.object({
  name: z.string().trim().min(1).max(120),
  brand: optText(80),
  model: optText(80),
  ip_address: z.preprocess((v) => (v === '' ? null : v), z.string().ip().nullable()).optional(),
  channels: z.number().int().positive().nullable().optional(),
  location: optText(200),
  notes: optText(2000),
});

const COLS = 'id, project_id, name, brand, model, host(ip_address) AS ip_address, channels, location, notes, created_at, updated_at';

nvrsRouter.get('/projects/:id/nvrs', async (req, res) => {
  const { id } = idParam.parse(req.params);
  const { rows } = await pool.query(
    `SELECT ${COLS}, (SELECT count(*)::int FROM cameras c WHERE c.nvr_id = nvrs.id) AS camera_count
     FROM nvrs WHERE project_id = $1 ORDER BY name`,
    [id],
  );
  res.json(rows);
});

nvrsRouter.post('/projects/:id/nvrs', requireRole(...EDITOR_ROLES), async (req, res) => {
  const { id: projectId } = idParam.parse(req.params);
  const d = nvrSchema.parse(req.body);
  const { rows } = await pool.query(
    `INSERT INTO nvrs (project_id, name, brand, model, ip_address, channels, location, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${COLS}`,
    [projectId, d.name, d.brand ?? null, d.model ?? null, d.ip_address ?? null, d.channels ?? null, d.location ?? null, d.notes ?? null],
  );
  await audit(req, { action: 'create', entityType: 'nvr', entityId: rows[0].id, projectId, changes: rows[0] });
  res.status(201).json(rows[0]);
});

nvrsRouter.patch('/nvrs/:id', requireRole(...EDITOR_ROLES), async (req, res) => {
  const { id } = idParam.parse(req.params);
  const before = await pool.query(`SELECT ${COLS} FROM nvrs WHERE id = $1`, [id]);
  if (!before.rows[0]) throw notFound('NVR');
  const upd = buildUpdate(nvrSchema.partial().parse(req.body), 2);
  if (!upd.count) throw new HttpError(400, 'Nada que actualizar');
  const { rows } = await pool.query(`UPDATE nvrs SET ${upd.sql} WHERE id = $1 RETURNING ${COLS}`, [id, ...upd.values]);
  await audit(req, { action: 'update', entityType: 'nvr', entityId: id, projectId: rows[0].project_id, changes: diff(before.rows[0], rows[0]) });
  res.json(rows[0]);
});

nvrsRouter.delete('/nvrs/:id', requireRole(...EDITOR_ROLES), async (req, res) => {
  const { id } = idParam.parse(req.params);
  const { rows } = await pool.query(`DELETE FROM nvrs WHERE id = $1 RETURNING ${COLS}`, [id]);
  if (!rows[0]) throw notFound('NVR');
  await audit(req, { action: 'delete', entityType: 'nvr', entityId: id, projectId: rows[0].project_id, changes: rows[0] });
  res.status(204).end();
});
