import { hashPassword } from '../lib/password.js';
import { config } from '../config.js';
import { pool } from './pool.js';

const isProd = config.env === 'production';
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? (isProd ? '' : 'Admin123!');

// En producción solo se crea el administrador, y con una contraseña explícita y robusta.
if (isProd && (adminPassword.length < 12 || adminPassword === 'Admin123!')) {
  console.error('En producción define SEED_ADMIN_PASSWORD (mínimo 12 caracteres) para crear el administrador.');
  process.exit(1);
}

const users = [
  { email: process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com', password: adminPassword, name: 'Administrador', role: 'admin' },
  // Usuarios de demo con contraseñas conocidas: nunca en producción
  ...(isProd
    ? []
    : [
        { email: 'tecnico@example.com', password: 'Tecnico123!', name: 'Técnico de demo', role: 'tecnico' },
        { email: 'lectura@example.com', password: 'Lectura123!', name: 'Usuario de consulta', role: 'lectura' },
      ]),
];

async function seed() {
  for (const u of users) {
    const hash = await hashPassword(u.password);
    const { rowCount } = await pool.query(
      `INSERT INTO users (email, name, password_hash, role) VALUES ($1, $2, $3, $4)
       ON CONFLICT ((lower(email))) DO NOTHING`,
      [u.email, u.name, hash, u.role],
    );
    console.log(rowCount ? `✔ usuario ${u.email} (${u.role})` : `· ${u.email} ya existía`);
  }
}

seed()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
