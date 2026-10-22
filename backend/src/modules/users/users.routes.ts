import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../../config.js';
import { pool } from '../../db/pool.js';
import { ROLES } from '../../domain.js';
import { assertPasswordForUser, hashPassword } from '../../lib/password.js';
import { currentUser, invalidateSession, requireRole } from '../../middleware/auth.js';
import { HttpError, notFound } from '../../middleware/error.js';
import { buildUpdate } from '../../lib/sql.js';
import { idParam } from '../../lib/validation.js';
import { audit } from '../audit/audit.service.js';
import { hashResetToken } from '../auth/auth.routes.js';

export const usersRouter = Router();
usersRouter.use(requireRole('admin'));

/** Validez del enlace de restablecimiento de acceso */
const RESET_TTL_HOURS = 24;

const PUBLIC_COLS = `id, email, name, role, active, last_login_at, created_at, must_change_password,
  CASE WHEN locked_until > now() THEN locked_until END AS locked_until,
  (reset_expires_at > now()) AS reset_pending`;

const createSchema = z.object({
  email: z.string().trim().email(),
  name: z.string().trim().min(1).max(120),
  password: z.string(),
  role: z.enum(ROLES),
});
const updateSchema = createSchema.partial().extend({ active: z.boolean().optional() });

async function getEmail(id: string) {
  const { rows } = await pool.query<{ email: string }>('SELECT email FROM users WHERE id = $1', [id]);
  if (!rows[0]) throw notFound('Usuario');
  return rows[0].email;
}

usersRouter.get('/', async (_req, res) => {
  const { rows } = await pool.query(`SELECT ${PUBLIC_COLS} FROM users ORDER BY name`);
  res.json(rows);
});

/** Alta: la contraseña inicial es temporal; el usuario deberá cambiarla al entrar. */
usersRouter.post('/', async (req, res) => {
  const { password, ...data } = createSchema.parse(req.body);
  assertPasswordForUser(password, data.email);
  const { rows } = await pool.query(
    `INSERT INTO users (email, name, role, password_hash, must_change_password) VALUES ($1, $2, $3, $4, true)
     RETURNING ${PUBLIC_COLS}`,
    [data.email, data.name, data.role, await hashPassword(password)],
  );
  await audit(req, { action: 'create', entityType: 'user', entityId: rows[0].id, changes: rows[0] });
  res.status(201).json(rows[0]);
});

usersRouter.patch('/:id', async (req, res) => {
  const { id } = idParam.parse(req.params);
  const { password, ...data } = updateSchema.parse(req.body);
  const self = id === currentUser(req).id;
  if (self && ((data.role && data.role !== 'admin') || data.active === false)) {
    throw new HttpError(400, 'No puedes quitarte el rol de administrador ni desactivarte a ti mismo');
  }
  if (self && password) throw new HttpError(400, 'Para cambiar tu propia contraseña usa «Cambiar contraseña»');
  if (password) assertPasswordForUser(password, data.email ?? (await getEmail(id)));

  const extra: Record<string, unknown> = {};
  if (password) {
    // Contraseña fijada por el administrador: temporal, y cierra las sesiones abiertas
    Object.assign(extra, { password_hash: await hashPassword(password), must_change_password: true, failed_logins: 0, locked_until: null });
  }
  const upd = buildUpdate(data, 2, extra);
  if (!upd.count) throw new HttpError(400, 'Nada que actualizar');
  // Cambio de contraseña, rol o estado: se invalidan todas sus sesiones
  const revoke = password || data.role || data.active === false ? ', token_version = token_version + 1' : '';
  const { rows } = await pool.query(`UPDATE users SET ${upd.sql}${revoke} WHERE id = $1 RETURNING ${PUBLIC_COLS}`, [id, ...upd.values]);
  if (!rows[0]) throw notFound('Usuario');
  invalidateSession(id);
  await audit(req, {
    action: 'update',
    entityType: 'user',
    entityId: id,
    changes: { ...data, ...(password ? { password: '(temporal, cambio obligatorio)' } : {}) },
  });
  res.json(rows[0]);
});

/** Baja lógica: se desactiva (y se cierran sus sesiones) para conservar la trazabilidad. */
usersRouter.delete('/:id', async (req, res) => {
  const { id } = idParam.parse(req.params);
  if (id === currentUser(req).id) throw new HttpError(400, 'No puedes desactivarte a ti mismo');
  const { rowCount } = await pool.query('UPDATE users SET active = false, token_version = token_version + 1 WHERE id = $1', [id]);
  if (!rowCount) throw notFound('Usuario');
  invalidateSession(id);
  await audit(req, { action: 'delete', entityType: 'user', entityId: id });
  res.status(204).end();
});

/**
 * Restablecer acceso: genera un enlace de un solo uso (24 h) para que el usuario elija
 * una contraseña nueva. Cierra sus sesiones y lo desbloquea. Solo se guarda el hash.
 * El token va en el fragmento (#) de la URL: el navegador no lo envía al servidor y no
 * queda en los logs de nginx.
 */
usersRouter.post('/:id/reset-access', async (req, res) => {
  const { id } = idParam.parse(req.params);
  if (id === currentUser(req).id) throw new HttpError(400, 'Para tu propia cuenta usa «Cambiar contraseña»');
  const token = randomBytes(32).toString('base64url');
  const { rows } = await pool.query<{ email: string; reset_expires_at: string }>(
    `UPDATE users SET reset_token_hash = $2, reset_expires_at = now() + make_interval(hours => $3),
       token_version = token_version + 1, failed_logins = 0, locked_until = NULL
     WHERE id = $1 AND active
     RETURNING email, reset_expires_at`,
    [id, hashResetToken(token), RESET_TTL_HOURS],
  );
  if (!rows[0]) throw new HttpError(404, 'Usuario no encontrado o desactivado');
  invalidateSession(id);
  await audit(req, { action: 'password_reset', entityType: 'user', entityId: id, changes: { via: 'enlace generado', expires: rows[0].reset_expires_at } });
  res.json({ url: `${config.publicUrl}/restablecer#token=${token}`, email: rows[0].email, expiresAt: rows[0].reset_expires_at });
});

/** Quitar el bloqueo por intentos fallidos sin cambiar la contraseña. */
usersRouter.post('/:id/unlock', async (req, res) => {
  const { id } = idParam.parse(req.params);
  const { rows } = await pool.query(`UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = $1 RETURNING ${PUBLIC_COLS}`, [id]);
  if (!rows[0]) throw notFound('Usuario');
  await audit(req, { action: 'update', entityType: 'user', entityId: id, changes: { unlocked: true } });
  res.json(rows[0]);
});
