import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool.js';
import { requireRole } from '../../middleware/auth.js';

export const auditRouter = Router();

const querySchema = z.object({
  projectId: z.string().uuid().optional(),
  entityType: z.string().max(40).optional(),
  entityId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  before: z.coerce.number().int().optional(), // paginación por id descendente
});

auditRouter.get('/', requireRole('admin'), async (req, res) => {
  const q = querySchema.parse(req.query);
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (col: string, v: unknown) => {
    if (v === undefined) return;
    params.push(v);
    where.push(`${col} = $${params.length}`);
  };
  add('a.project_id', q.projectId);
  add('a.entity_type', q.entityType);
  add('a.entity_id', q.entityId);
  add('a.user_id', q.userId);
  if (q.before) {
    params.push(q.before);
    where.push(`a.id < $${params.length}`);
  }
  params.push(q.limit);
  const { rows } = await pool.query(
    `SELECT a.*, a.id::int AS id, coalesce(u.name, a.user_email) AS user_name, p.name AS project_name
     FROM audit_log a
     LEFT JOIN users u ON u.id = a.user_id
     LEFT JOIN projects p ON p.id = a.project_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY a.id DESC LIMIT $${params.length}`,
    params,
  );
  res.json(rows);
});
