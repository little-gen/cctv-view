import { z } from 'zod';

/** Texto opcional: '' se convierte en null. */
export const optText = (max = 255) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(max).nullable()).optional();

export const uuid = z.string().uuid();

export const idParam = z.object({ id: uuid });

/** Lista separada por comas en query string: ?status=operativa,averiada */
export const csvList = <T extends [string, ...string[]]>(values: T) =>
  z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined))
    .pipe(z.array(z.enum(values)).optional());
