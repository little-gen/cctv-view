import type { ErrorRequestHandler, RequestHandler } from 'express';
import multer from 'multer';
import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Recurso') => new HttpError(404, `${what} no encontrado`);

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new HttpError(404, `Ruta no encontrada: ${req.method} ${req.path}`));
};

// Códigos de error de PostgreSQL más habituales
const PG_ERRORS: Record<string, [number, string]> = {
  '23505': [409, 'Ya existe un registro con ese valor (duplicado)'],
  '23503': [400, 'Referencia a un registro inexistente'],
  '23514': [400, 'Valor fuera de rango'],
  '22P02': [400, 'Formato de dato no válido'],
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, details: err.details });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'Datos no válidos',
      details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
    return;
  }
  if (err instanceof multer.MulterError) {
    res.status(400).json({ error: `Error en la subida: ${err.message}` });
    return;
  }
  const pgCode = (err as { code?: string }).code;
  if (pgCode && PG_ERRORS[pgCode]) {
    const [status, message] = PG_ERRORS[pgCode];
    res.status(status).json({ error: message, details: (err as { detail?: string }).detail });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor' });
};
