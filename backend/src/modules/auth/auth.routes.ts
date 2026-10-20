import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool.js';
import type { Role } from '../../domain.js';
import { authenticate, currentUser, signToken } from '../../middleware/auth.js';
import { HttpError } from '../../middleware/error.js';
import { audit } from '../audit/audit.service.js';

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});

authRouter.post('/login', async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);
  const { rows } = await pool.query<{ id: string; email: string; name: string; role: Role; password_hash: string; active: boolean }>(
    'SELECT id, email, name, role, password_hash, active FROM users WHERE lower(email) = lower($1)',
    [email],
  );
  const user = rows[0];
  // Mismo mensaje para usuario inexistente y contraseña incorrecta
  if (!user || !user.active || !(await bcrypt.compare(password, user.password_hash))) {
    throw new HttpError(401, 'Credenciales incorrectas');
  }
  await pool.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
  const authUser = { id: user.id, email: user.email, name: user.name, role: user.role };
  req.user = authUser;
  await audit(req, { action: 'login', entityType: 'user', entityId: user.id });
  res.json({ token: signToken(authUser), user: authUser });
});

authRouter.get('/me', authenticate, (req, res) => {
  res.json(currentUser(req));
});
