import bcrypt from 'bcryptjs';
import { z } from 'zod';

/** Coste de bcrypt (2^12 iteraciones, ~250 ms). Los hashes antiguos (10) se actualizan al iniciar sesión. */
export const BCRYPT_COST = 12;
export const PASSWORD_MIN = 12;
// bcrypt solo usa los primeros 72 bytes: por encima, el resto se ignoraría sin avisar
const PASSWORD_MAX_BYTES = 72;

const COMMON = ['password', 'contraseña', 'contrasena', '123456789012', 'qwertyuiopas', 'tekusys', 'cctv', 'planoscamaras', 'administrador'];

/** Política: longitud (NIST 800-63B) en lugar de reglas de composición, sin contraseñas obvias. */
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN, `La contraseña debe tener al menos ${PASSWORD_MIN} caracteres`)
  .refine((p) => Buffer.byteLength(p, 'utf8') <= PASSWORD_MAX_BYTES, 'La contraseña es demasiado larga (máx. 72 bytes)')
  .refine((p) => new Set(p).size >= 5, 'La contraseña es demasiado repetitiva')
  .refine((p) => !COMMON.some((w) => p.toLowerCase().includes(w)), 'La contraseña contiene una palabra demasiado obvia');

/** Comprueba además que no contenga el nombre de usuario del email. */
export function assertPasswordForUser(password: string, email: string) {
  passwordSchema.parse(password);
  const local = email.split('@')[0].toLowerCase();
  if (local.length >= 4 && password.toLowerCase().includes(local)) {
    throw new z.ZodError([{ code: 'custom', path: ['password'], message: 'La contraseña no puede contener tu usuario' }]);
  }
}

export const hashPassword = (password: string) => bcrypt.hash(password, BCRYPT_COST);

export const needsRehash = (hash: string) => bcrypt.getRounds(hash) < BCRYPT_COST;

// Hash válido de una contraseña aleatoria: se compara contra él cuando el email no existe,
// para que el tiempo de respuesta no revele qué cuentas existen.
export const DUMMY_HASH = bcrypt.hashSync(`dummy-${Math.random()}`, BCRYPT_COST);
