import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool.js';
import { ROLES } from '../../domain.js';
import { currentUser, requireRole } from '../../middleware/auth.js';
import { HttpError, notFound } from '../../middleware/error.js';
import { buildUpdate } from '../../lib/sql.js';
import { idParam } from '../../lib/validation.js';
import { audit } from '../audit/audit.service.js';

export const usersRouter = Router();
usersRouter.use(requireRole('admin'));

const PUBLIC_COLS = 'id, email, name, role, active, last_login_at, created_at';

const createSchema = z.object({
  email: z.string().trim().email(),
  name: z.string().trim().min(1).max(120),
  password: z.string().min(8, 'Mínimo 8 caracteres'),
  role: z.enum(ROLES),
});
const updateSchema = createSchema.partial().extend({ active: z.boolean().optional() });

usersRouter.get('/', async (_req, res) => {
  const { rows } = await pool.query(`SELECT ${PUBLIC_COLS} FROM users ORDER BY name`);
  res.json(rows);
});

usersRouter.post('/', async (req, res) => {
  const { password, ...data } = createSchema.parse(req.body);
  const hash = await bcrypt.hash(password, 10);
  const { rows } = await pool.query(
    `INSERT INTO users (email, name, role, password_hash) VALUES ($1, $2, $3, $4) RETURNING ${PUBLIC_COLS}`,
    [data.email, data.name, data.role, hash],
  );
  await audit(req, { action: 'create', entityType: 'user', entityId: rows[0].id, changes: rows[0] });
  res.status(201).json(rows[0]);
});

usersRouter.patch('/:id', async (req, res) => {
  const { id } = idParam.parse(req.params);
  const { password, ...data } = updateSchema.parse(req.body);
  if (id === currentUser(req).id && (data.role && data.role !== 'admin' || data.active === false)) {
    throw new HttpError(400, 'No puedes quitarte el rol de administrador ni desactivarte a ti mismo');
  }
  const extra = password ? { password_hash: await bcrypt.hash(password, 10) } : {};
  const upd = buildUpdate(data, 2, extra);
  if (!upd.count) throw new HttpError(400, 'Nada que actualizar');
  const { rows } = await pool.query(`UPDATE users SET ${upd.sql} WHERE id = $1 RETURNING ${PUBLIC_COLS}`, [id, ...upd.values]);
  if (!rows[0]) throw notFound('Usuario');
  await audit(req, {
    action: 'update',
    entityType: 'user',
    entityId: id,
    changes: { ...data, ...(password ? { password: '(cambiada)' } : {}) },
  });
  res.json(rows[0]);
});

/** Baja lógica: se desactiva para conservar la trazabilidad en la auditoría. */
usersRouter.delete('/:id', async (req, res) => {
  const { id } = idParam.parse(req.params);
  if (id === currentUser(req).id) throw new HttpError(400, 'No puedes desactivarte a ti mismo');
  const { rowCount } = await pool.query('UPDATE users SET active = false WHERE id = $1', [id]);
  if (!rowCount) throw notFound('Usuario');
  await audit(req, { action: 'delete', entityType: 'user', entityId: id });
  res.status(204).end();
});
