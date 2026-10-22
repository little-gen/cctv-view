import 'dotenv/config';
import path from 'node:path';

const DEFAULT_SECRET = 'dev-secret-change-me';

const ownerUrl = process.env.DATABASE_URL ?? 'postgres://planos:planos@localhost:5432/planos';
const appUser = process.env.APP_DB_USER ?? '';
const appPassword = process.env.APP_DB_PASSWORD ?? '';

/** Misma URL de conexión con otro usuario y contraseña. */
function withCredentials(url: string, user: string, password: string) {
  const u = new URL(url);
  u.username = encodeURIComponent(user);
  u.password = encodeURIComponent(password);
  return u.toString();
}

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 4000),
  /**
   * Mínimo privilegio: DATABASE_URL es la conexión del propietario de la BD (migraciones).
   * Si se definen APP_DB_USER y APP_DB_PASSWORD, la aplicación se conecta con ese rol sin
   * privilegios, que migrate.ts crea y mantiene. Sin ellas, todo usa DATABASE_URL
   * (compatibilidad con instalaciones existentes).
   */
  databaseOwnerUrl: ownerUrl,
  databaseUrl: appUser && appPassword ? withCredentials(ownerUrl, appUser, appPassword) : ownerUrl,
  appDbUser: appUser && appPassword ? appUser : '',
  appDbPassword: appPassword,
  dbPoolMax: Number(process.env.PG_POOL_MAX ?? 10),
  jwtSecret: process.env.JWT_SECRET ?? DEFAULT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '8h',
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  /** URL pública de la aplicación (enlaces de restablecimiento de acceso) */
  publicUrl: (process.env.PUBLIC_URL ?? process.env.CORS_ORIGIN ?? 'http://localhost:5173').replace(/\/$/, ''),
  /** Swagger UI y /api/openapi.json: por defecto solo fuera de producción (hallazgo M-01) */
  apiDocs: process.env.API_DOCS ? process.env.API_DOCS === 'true' : (process.env.NODE_ENV ?? 'development') !== 'production',
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
  /** Los planos pueden ser mucho mayores que fotos y documentos (escaneos A0, PNG de alta resolución) */
  planMaxUploadBytes: Number(process.env.PLAN_MAX_UPLOAD_MB ?? 200) * 1024 * 1024,
  /** Resolución de visualización: los planos mayores se reducen a esto para las teselas (el original se conserva) */
  planMaxPixels: Number(process.env.PLAN_MAX_MEGAPIXELS ?? 400) * 1_000_000,
  /** Límite absoluto de lectura (protección frente a "bombas de descompresión"): se rechaza por encima */
  planMaxInputPixels: Number(process.env.PLAN_MAX_INPUT_MEGAPIXELS ?? 2000) * 1_000_000,
};

function optionalPath(p: string | undefined) {
  return p ? path.resolve(p) : undefined;
}

if (config.env === 'production' && (config.jwtSecret === DEFAULT_SECRET || config.jwtSecret.length < 32)) {
  throw new Error('JWT_SECRET debe configurarse en producción (mínimo 32 caracteres)');
}
