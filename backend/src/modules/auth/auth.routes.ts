import bcrypt from 'bcryptjs';
import { createHash } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool.js';
import type { Role } from '../../domain.js';
import { assertPasswordForUser, DUMMY_HASH, hashPassword, needsRehash } from '../../lib/password.js';
import { authenticateForPasswordChange, currentUser, invalidateSession, signToken } from '../../middleware/auth.js';
import { HttpError } from '../../middleware/error.js';
import { audit } from '../audit/audit.service.js';

export const authRouter = Router();

/** Bloqueo por cuenta (hallazgo M-03): tras 5 fallos seguidos, 1 min; cada fallo más lo duplica, hasta 60 min. */
const LOCK_AFTER = 5;
const LOCK_MAX_MINUTES = 60;
const lockMinutes = (failures: number) => Math.min(LOCK_MAX_MINUTES, 2 ** (failures - LOCK_AFTER));

export const hashResetToken = (token: string) => createHash('sha256').update(token).digest('hex');

const publicUser = (u: { id: string; email: string; name: string; role: Role; must_change_password: boolean }) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role,
  mustChangePassword: u.must_change_password,
});

interface LoginRow {
  id: string;
  email: string;
  name: string;
  role: Role;
  password_hash: string;
  active: boolean;
  token_version: number;
  must_change_password: boolean;
  failed_logins: number;
  locked_until: Date | null;
}

const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(200),
});

authRouter.post('/login', async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);
  const { rows } = await pool.query<LoginRow>(
    `SELECT id, email, name, role, password_hash, active, token_version, must_change_password, failed_logins, locked_until
     FROM users WHERE lower(email) = lower($1)`,
    [email],
  );
  const user = rows[0];

  if (user?.locked_until && user.locked_until > new Date()) {
    const minutes = Math.ceil((user.locked_until.getTime() - Date.now()) / 60_000);
    throw new HttpError(
      429,
      `Cuenta bloqueada temporalmente por intentos fallidos. Inténtalo dentro de ${minutes} min o pide al administrador que restablezca tu acceso.`,
    );
  }

  // Siempre se ejecuta bcrypt (también si el email no existe) para no revelar cuentas por tiempo
  const valid = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !user.active || !valid) {
    if (user) {
      const failures = user.failed_logins + 1;
      await pool.query(
        `UPDATE users SET failed_logins = $2,
           locked_until = CASE WHEN $2 >= ${LOCK_AFTER} THEN now() + make_interval(mins => $3) ELSE locked_until END
         WHERE id = $1`,
        [user.id, failures, failures >= LOCK_AFTER ? lockMinutes(failures) : 0],
      );
      invalidateSession(user.id);
    }
    await audit(req, {
      action: 'login_failed',
      entityType: 'user',
      entityId: user?.id ?? null,
      actor: { email },
      changes: { reason: !user ? 'unknown_email' : !user.active ? 'inactive' : 'bad_password', failures: user ? user.failed_logins + 1 : undefined },
    });
    throw new HttpError(401, 'Credenciales incorrectas');
  }

  // Éxito: se reinician los contadores y se actualiza el hash si usa un coste antiguo
  const newHash = needsRehash(user.password_hash) ? await hashPassword(password) : null;
  await pool.query(
    `UPDATE users SET last_login_at = now(), failed_logins = 0, locked_until = NULL,
       password_hash = coalesce($2, password_hash)
     WHERE id = $1`,
    [user.id, newHash],
  );
  req.user = { ...publicUser(user) };
  await audit(req, { action: 'login', entityType: 'user', entityId: user.id });
  res.json({ token: signToken({ id: user.id, tokenVersion: user.token_version }), user: publicUser(user) });
});

authRouter.get('/me', authenticateForPasswordChange, (req, res) => {
  res.json(currentUser(req));
});

/** Cambio de la propia contraseña. Cierra las demás sesiones y devuelve un token nuevo para esta. */
authRouter.post('/change-password', authenticateForPasswordChange, async (req, res) => {
  const { currentPassword, newPassword } = z
    .object({ currentPassword: z.string().min(1).max(200), newPassword: z.string() })
    .parse(req.body);
  const me = currentUser(req);
  const { rows } = await pool.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [me.id]);
  if (!rows[0] || !(await bcrypt.compare(currentPassword, rows[0].password_hash))) {
    throw new HttpError(400, 'La contraseña actual no es correcta');
  }
  if (currentPassword === newPassword) throw new HttpError(400, 'La nueva contraseña debe ser distinta de la actual');
  assertPasswordForUser(newPassword, me.email);

  const { rows: updated } = await pool.query<LoginRow>(
    `UPDATE users SET password_hash = $2, must_change_password = false, password_changed_at = now(),
       token_version = token_version + 1, failed_logins = 0, locked_until = NULL
     WHERE id = $1
     RETURNING id, email, name, role, token_version, must_change_password`,
    [me.id, await hashPassword(newPassword)],
  );
  invalidateSession(me.id);
  await audit(req, { action: 'password_change', entityType: 'user', entityId: me.id });
  const u = updated[0];
  res.json({ token: signToken({ id: u.id, tokenVersion: u.token_version }), user: publicUser(u) });
});

/** Cierre de sesión en el servidor: invalida todos los tokens del usuario (P-06). */
authRouter.post('/logout', authenticateForPasswordChange, async (req, res) => {
  const me = currentUser(req);
  await pool.query('UPDATE users SET token_version = token_version + 1 WHERE id = $1', [me.id]);
  invalidateSession(me.id);
  await audit(req, { action: 'logout', entityType: 'user', entityId: me.id });
  res.status(204).end();
});

/**
 * Restablecimiento con el enlace de un solo uso que genera el administrador.
 * Público (el usuario no puede entrar); nginx lo limita como el login.
 */
authRouter.post('/reset-password', async (req, res) => {
  const { token, password } = z.object({ token: z.string().min(20).max(200), password: z.string() }).parse(req.body);
  const { rows } = await pool.query<{ id: string; email: string }>(
    `SELECT id, email FROM users
     WHERE reset_token_hash = $1 AND reset_expires_at > now() AND active`,
    [hashResetToken(token)],
  );
  const user = rows[0];
  if (!user) throw new HttpError(400, 'El enlace no es válido o ha caducado. Pide uno nuevo al administrador.');
  assertPasswordForUser(password, user.email);

  await pool.query(
    `UPDATE users SET password_hash = $2, reset_token_hash = NULL, reset_expires_at = NULL,
       must_change_password = false, password_changed_at = now(), token_version = token_version + 1,
       failed_logins = 0, locked_until = NULL
     WHERE id = $1`,
    [user.id, await hashPassword(password)],
  );
  invalidateSession(user.id);
  await audit(req, { action: 'password_reset', entityType: 'user', entityId: user.id, actor: user, changes: { via: 'enlace' } });
  res.json({ email: user.email });
});
