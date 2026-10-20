import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import type { Role } from '../domain.js';
import { HttpError } from './error.js';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signToken(user: AuthUser): string {
  return jwt.sign({ sub: user.id, email: user.email, name: user.name, role: user.role }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn as jwt.SignOptions['expiresIn'],
  });
}

export const authenticate: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next(new HttpError(401, 'No autenticado'));
  try {
    const payload = jwt.verify(header.slice(7), config.jwtSecret) as jwt.JwtPayload;
    req.user = { id: payload.sub!, email: payload.email, name: payload.name, role: payload.role };
    next();
  } catch {
    next(new HttpError(401, 'Sesión caducada o token no válido'));
  }
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
