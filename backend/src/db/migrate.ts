import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { config } from '../config.js';

// src/db -> backend/migrations  (y dist/db -> backend/migrations)
const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../migrations');

// Las migraciones (CREATE EXTENSION, ALTER TYPE...) necesitan al propietario de la BD
const owner = new pg.Pool({ connectionString: config.databaseOwnerUrl, max: 1 });

async function migrate() {
  await owner.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const { rows } = await owner.query<{ name: string }>('SELECT name FROM schema_migrations');
  const applied = new Set(rows.map((r) => r.name));

  const files = (await fs.readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await fs.readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
    const client = await owner.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`✔ ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`Fallo en la migración ${file}: ${(err as Error).message}`);
    } finally {
      client.release();
    }
  }
  console.log('Migraciones al día');
}

/**
 * Mínimo privilegio (hallazgo P-11): rol con el que se conecta la aplicación.
 * Solo lee y escribe datos: no es superusuario, no crea objetos ni roles, no puede
 * cambiar el esquema y el registro de auditoría es de solo inserción (P-08).
 * Idempotente: se aplica en cada arranque (también tras restaurar una copia).
 */
async function grantAppRole() {
  const { appDbUser: user, appDbPassword: password } = config;
  if (!user) {
    if (config.env === 'production') {
      console.warn('AVISO: la aplicación se conecta con el propietario de la BD. Define POSTGRES_APP_PASSWORD en .env (mínimo privilegio).');
    }
    return;
  }
  if (!password) throw new Error('APP_DB_USER está definido pero falta APP_DB_PASSWORD');

  const client = await owner.connect();
  try {
    const { rows } = await client.query<{ db: string; me: string }>('SELECT current_database() AS db, current_user AS me');
    if (rows[0].me === user) throw new Error('APP_DB_USER no puede ser el propietario de la base de datos');
    const role = client.escapeIdentifier(user);
    const db = client.escapeIdentifier(rows[0].db);
    const exists = (await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [user])).rowCount;

    await client.query('BEGIN');
    // Contraseña siempre sincronizada con .env
    await client.query(
      `${exists ? 'ALTER' : 'CREATE'} ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
       PASSWORD ${client.escapeLiteral(password)}`,
    );
    for (const sql of [
      `GRANT CONNECT ON DATABASE ${db} TO ${role}`,
      `GRANT USAGE ON SCHEMA public TO ${role}`,
      `REVOKE CREATE ON SCHEMA public FROM ${role}`,
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`,
      `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`,
      `REVOKE INSERT, UPDATE, DELETE ON schema_migrations FROM ${role}`,
      // Auditoría: la aplicación solo añade entradas; nadie con este rol puede alterarlas ni borrarlas
      `REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM ${role}`,
    ]) {
      await client.query(sql);
    }
    await client.query('COMMIT');
    console.log(`✔ rol de aplicación "${user}" con privilegios mínimos`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

migrate()
  .then(grantAppRole)
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => owner.end());
