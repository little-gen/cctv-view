import 'dotenv/config';
import path from 'node:path';

const DEFAULT_SECRET = 'dev-secret-change-me';

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://planos:planos@localhost:5432/planos',
  dbPoolMax: Number(process.env.PG_POOL_MAX ?? 10),
  jwtSecret: process.env.JWT_SECRET ?? DEFAULT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '8h',
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  storageDir: path.resolve(process.env.STORAGE_DIR ?? 'storage'),
  /**
   * Raíces opcionales por tipo de fichero (producción: /data/plans, /data/uploads, /data/documents).
   * Sin definir, cada tipo va a una subcarpeta de STORAGE_DIR.
   */
  storageRoots: {
    plans: optionalPath(process.env.PLANS_DIR),
    photos: optionalPath(process.env.UPLOADS_DIR),
    documents: optionalPath(process.env.DOCUMENTS_DIR),
  },
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB ?? 25) * 1024 * 1024,
};

function optionalPath(p: string | undefined) {
  return p ? path.resolve(p) : undefined;
}

if (config.env === 'production' && (config.jwtSecret === DEFAULT_SECRET || config.jwtSecret.length < 32)) {
  throw new Error('JWT_SECRET debe configurarse en producción (mínimo 32 caracteres)');
}
