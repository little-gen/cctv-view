/**
 * Datos masivos para pruebas de rendimiento de la búsqueda global.
 *   npm run seed:bulk -w backend -- [proyectos=300] [camarasPorProyecto=100]
 *   npm run seed:bulk -w backend -- --clean      (borra los proyectos "DEMO ...")
 */
import { pool } from './pool.js';

const PLACES = ['Polígono Norte', 'Puerto Seco', 'Almacén Central', 'Plataforma Sur', 'Nave Logística', 'Centro de Distribución'];
const ZONES = ['Acceso principal', 'Muelle de carga', 'Almacén', 'Perímetro', 'Oficinas', 'Aparcamiento', 'Expediciones', 'Recepción'];
const BRANDS = ['Hikvision', 'Axis', 'Dahua', 'Hanwha', 'Bosch', 'Uniview'];
const TYPES = ['domo', 'bullet', 'ptz', 'termica', 'lpr'];
const STATUSES = ['operativa', 'operativa', 'operativa', 'operativa', 'operativa', 'operativa', 'averiada', 'mantenimiento'];

async function clean() {
  const { rowCount } = await pool.query(`DELETE FROM projects WHERE name LIKE 'DEMO %'`);
  console.log(`Eliminados ${rowCount} proyectos de demo`);
}

async function seed(projects: number, perProject: number) {
  const started = Date.now();
  for (let i = 1; i <= projects; i++) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const name = `DEMO ${String(i).padStart(3, '0')} · ${PLACES[i % PLACES.length]}`;
      const { rows: [project] } = await client.query<{ id: string }>(
        `INSERT INTO projects (name, client, address) VALUES ($1, $2, $3) RETURNING id`,
        [name, `Cliente ${1 + (i % 40)}`, `Calle Industria ${i}`],
      );
      const { rows: [plan] } = await client.query<{ id: string }>(
        `INSERT INTO floor_plans (project_id, name, width_m) VALUES ($1, 'Planta baja', 120) RETURNING id`,
        [project.id],
      );
      const { rows: nvrs } = await client.query<{ id: string }>(
        `INSERT INTO nvrs (project_id, name, ip_address, channels)
         SELECT $1, 'NVR-' || lpad(n::text, 2, '0'), ('10.' || $2::int || '.0.' || n)::inet, 64 FROM generate_series(1, $3) n
         ORDER BY n RETURNING id`,
        // 64 canales por NVR (la BD no permite superar la capacidad)
        [project.id, i % 250, Math.max(2, Math.ceil(perProject / 64))],
      );
      await client.query(
        `INSERT INTO cameras (project_id, floor_plan_id, nvr_id, code, name, type, brand, model, ip_address,
                              physical_location, status, notes, installed_at, pos_x, pos_y, rotation_deg, fov_deg, range_m)
         SELECT $1, $2, ($3::uuid[])[1 + (g - 1) / 64],
                'CAM-' || lpad(g::text, 3, '0'),
                ($4::text[])[1 + g % array_length($4::text[], 1)] || ' ' || g,
                ($5::text[])[1 + (g * 7 + $9) % 5]::camera_type,
                ($6::text[])[1 + (g + $9) % array_length($6::text[], 1)],
                'M-' || (1000 + (g * 13) % 90),
                ('192.168.' || ($9 % 250) || '.' || (1 + g % 250))::inet,
                ($4::text[])[1 + g % array_length($4::text[], 1)] || ', columna ' || (g % 40),
                ($7::text[])[1 + (g * 5 + $9) % array_length($7::text[], 1)]::camera_status,
                CASE WHEN g % 9 = 0 THEN 'Revisar enfoque nocturno' WHEN g % 13 = 0 THEN 'Sustituida tras incidencia' END,
                date '2022-01-01' + (g * 11 + $9) % 1200,
                random(), random(), floor(random() * 360), 90, 25
         FROM generate_series(1, $8) g`,
        [project.id, plan.id, nvrs.map((n) => n.id), ZONES, TYPES, BRANDS, STATUSES, perProject, i],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    if (i % 25 === 0) console.log(`  ${i}/${projects} proyectos`);
  }
  await pool.query('ANALYZE cameras');
  console.log(`✔ ${projects} proyectos · ${projects * perProject} cámaras en ${((Date.now() - started) / 1000).toFixed(1)} s`);
}

const args = process.argv.slice(2);
(args.includes('--clean') ? clean() : seed(Number(args[0] ?? 300), Number(args[1] ?? 100)))
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
