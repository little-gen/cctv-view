import type { Request, RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { pool } from '../db/pool.js';
import type { Role } from '../domain.js';
import { HttpError } from './error.js';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  mustChangePassword: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/** El token lleva la versión de sesión del usuario (tv): al incrementarla en BD, todos sus tokens caducan. */
export function signToken(user: { id: string; tokenVersion: number }): string {
  return jwt.sign({ sub: user.id, tv: user.tokenVersion }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn as jwt.SignOptions['expiresIn'],
    algorithm: 'HS256',
  });
}

interface SessionRow {
  id: string;
  email: string;
  name: string;
  role: Role;
  active: boolean;
  token_version: number;
  must_change_password: boolean;
}

// Caché breve del estado de la sesión: una carga del plano pide decenas de teselas a la vez.
// Se invalida explícitamente al cambiar el usuario (mismo proceso: el backend es una sola instancia).
const SESSION_TTL_MS = 5_000;
const sessionCache = new Map<string, { row: SessionRow | null; at: number }>();

export function invalidateSession(userId: string) {
  sessionCache.delete(userId);
}

async function loadSession(userId: string): Promise<SessionRow | null> {
  const hit = sessionCache.get(userId);
  if (hit && Date.now() - hit.at < SESSION_TTL_MS) return hit.row;
  const { rows } = await pool.query<SessionRow>(
    'SELECT id, email, name, role, active, token_version, must_change_password FROM users WHERE id = $1',
    [userId],
  );
  const row = rows[0] ?? null;
  sessionCache.set(userId, { row, at: Date.now() });
  return row;
}

async function resolveUser(req: Request): Promise<AuthUser> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw new HttpError(401, 'No autenticado');
  let payload: jwt.JwtPayload;
  try {
    payload = jwt.verify(header.slice(7), config.jwtSecret, { algorithms: ['HS256'] }) as jwt.JwtPayload;
  } catch {
    throw new HttpError(401, 'Sesión caducada o token no válido');
  }
  // Revocación: usuario desactivado o sesión invalidada (cambio de contraseña, restablecimiento, logout)
  const row = typeof payload.sub === 'string' ? await loadSession(payload.sub) : null;
  if (!row || !row.active || row.token_version !== payload.tv) {
    throw new HttpError(401, 'La sesión ya no es válida. Vuelve a iniciar sesión.');
  }
  // Rol y nombre siempre desde la BD: un cambio de rol se aplica al instante
  return { id: row.id, email: row.email, name: row.name, role: row.role, mustChangePassword: row.must_change_password };
}

/**
 * Autenticación de la API. Si el usuario debe cambiar la contraseña (la fijó el
 * administrador), solo puede usar las rutas de `authenticateForPasswordChange`.
 */
export const authenticate: RequestHandler = async (req, _res, next) => {
  req.user = await resolveUser(req);
  if (req.user.mustChangePassword) {
    throw new HttpError(403, 'Debes cambiar tu contraseña antes de continuar', { code: 'PASSWORD_CHANGE_REQUIRED' });
  }
  next();
};

/** Igual que `authenticate` pero admite usuarios con cambio de contraseña pendiente (/me, cambio, logout). */
export const authenticateForPasswordChange: RequestHandler = async (req, _res, next) => {
  req.user = await resolveUser(req);
  next();
};

export const requireRole =
  (...roles: Role[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user) return next(new HttpError(401, 'No autenticado'));
    if (!roles.includes(req.user.role)) return next(new HttpError(403, 'Permisos insuficientes'));
    next();
  };

/** Usuario autenticado (para handlers protegidos por `authenticate`). */
export function currentUser(req: { user?: AuthUser }): AuthUser {
  if (!req.user) throw new HttpError(401, 'No autenticado');
  return req.user;
}
