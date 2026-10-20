import pg from 'pg';
import { config } from '../config.js';

// DATE -> 'YYYY-MM-DD' (sin conversión a zona horaria)
pg.types.setTypeParser(1082, (v) => v);

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: config.dbPoolMax });

// Un error en una conexión inactiva (reinicio de PostgreSQL, red...) no debe tumbar el proceso
pool.on('error', (err) => console.error('Error en conexión inactiva de PostgreSQL:', err.message));

/** Cualquier objeto capaz de ejecutar consultas: el pool o un cliente en transacción. */
export type Queryable = Pick<pg.Pool | pg.PoolClient, 'query'>;

export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
