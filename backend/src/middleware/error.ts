import type { ErrorRequestHandler, RequestHandler } from 'express';
import multer from 'multer';
import { ZodError } from 'zod';
import { config } from '../config.js';

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
    if (err.code === 'LIMIT_FILE_SIZE') {
      const isPlan = /\/plans\/[^/]+\/image$/.test(_req.path);
      const mb = Math.round((isPlan ? config.planMaxUploadBytes : config.maxUploadBytes) / 1024 / 1024);
      res.status(413).json({ error: `El fichero supera el tamaño máximo permitido (${mb} MB)` });
      return;
    }
    res.status(400).json({ error: `Error en la subida: ${err.message}` });
    return;
  }
  // Peticiones mal formadas (multipart roto, nombre de fichero con caracteres de control...)
  const message = (err as Error)?.message ?? '';
  if (/^(Malformed part header|Unexpected end of form|Multipart: Boundary not found|Malformed urlencoded form)/.test(message)) {
    res.status(400).json({ error: 'Petición de subida mal formada' });
    return;
  }
  // Errores 4xx de los parsers de Express (JSON mal formado, cuerpo demasiado grande...)
  const status = (err as { status?: number; statusCode?: number }).status ?? (err as { statusCode?: number }).statusCode;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    res.status(status).json({ error: status === 413 ? 'Petición demasiado grande' : 'Petición no válida' });
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
