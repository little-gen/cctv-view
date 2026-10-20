// Prueba funcional y de rendimiento de la búsqueda global.
// Requiere datos masivos (npm run seed:bulk -w backend) y la API arrancada.
// Uso: npm run search-check -w backend   (API_URL y DATABASE_URL opcionales)
import pg from 'pg';

const BASE = process.env.API_URL ?? 'http://localhost:4000/api';
const db = new pg.Client({ connectionString: process.env.DATABASE_URL ?? 'postgres://planos:planos@localhost:5432/planos' });
const ok = (cond, msg) => { console.log(`${cond ? 'OK  ' : 'FAIL'} ${msg}`); if (!cond) process.exitCode = 1; };

const login = await fetch(`${BASE}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'admin@example.com', password: 'Admin123!' }),
}).then((r) => r.json());
const H = { Authorization: `Bearer ${login.token}` };
const search = (qs) => fetch(`${BASE}/search?${qs}`, { headers: H }).then((r) => r.json());
const hits = (d) => d.groups.flatMap((g) => g.cameras);

await db.connect();
const { rows: [{ n: totalCams }] } = await db.query('SELECT count(*)::int n FROM cameras');
console.log(`Base de datos: ${totalCams} cámaras\n`);

// --- Funcional
let d = await search('q=192.168');
ok(d.total > 0 && hits(d).every((h) => h.ip_address?.includes('192.168')), `"192.168" -> ${d.total} coincidencias, todas con esa IP`);
d = await search('q=hik');
ok(d.total > 0 && hits(d).every((h) => /hik/i.test(`${h.brand} ${h.name} ${h.notes}`)), `"hik" -> ${d.total} (Hikvision)`);
d = await search('q=almacen');
ok(d.total > 0 && hits(d).some((h) => /Almacén/.test(`${h.name} ${h.physical_location} ${h.project_name}`)), `"almacen" (sin tilde) -> ${d.total}, encuentra "Almacén"`);
d = await search('q=ALMACÉN');
ok(d.total > 0, `"ALMACÉN" (mayúsculas y tilde) -> ${d.total}`);
const both = await search('q=hik%20almacen');
ok(both.total > 0 && both.total < d.total, `"hik almacen" (AND de palabras) -> ${both.total}`);
d = await search('q=nocturno');
ok(d.total > 0 && hits(d).every((h) => h.notes?.toLowerCase().includes('nocturno')), `observaciones "nocturno" -> ${d.total}`);
d = await search('q=NVR-02');
ok(d.total > 0 && hits(d).every((h) => h.nvr_name === 'NVR-02'), `NVR "NVR-02" -> ${d.total}`);
d = await search('q=DEMO%20007');
// Todas las palabras deben aparecer: "007" también casa con CAM-007 de otros proyectos,
// pero el proyecto DEMO 007 (100 cámaras) encabeza los resultados.
ok(d.groups[0].project.name.startsWith('DEMO 007') && d.groups[0].hits === 100, `nombre de proyecto "DEMO 007" -> primer grupo con sus 100 cámaras`);
d = await search('q=CAM-042');
ok(d.groups.every((g) => g.cameras[0].code === 'CAM-042'), `código exacto "CAM-042" aparece el primero en cada proyecto`);
d = await search('q=zzzz_inexistente');
ok(d.total === 0 && d.groups.length === 0, 'sin coincidencias -> 0');
d = await search('q=100%25');
ok(d.total === 0, '"%" se trata como literal (no comodín)');

// --- Estadísticas, agrupación y facetas
d = await search('q=hik');
const sumType = Object.values(d.byType).reduce((a, b) => a + b, 0);
ok(sumType === d.total, `estadística por tipo suma el total (${JSON.stringify(d.byType)})`);
ok(d.groups.every((g) => g.cameras.length <= 8 && g.hits >= g.cameras.length), 'máximo 8 resultados por proyecto, con total por grupo');
ok(d.groups.every((g, i, a) => i === 0 || a[i - 1].hits >= g.hits), 'grupos ordenados por nº de coincidencias');
ok(d.facets.projects.length === d.projectCount && d.facets.brands.length > 0, `facetas: ${d.facets.projects.length} proyectos, ${d.facets.brands.length} marcas`);

// --- Filtros avanzados
const proj = d.facets.projects[0];
let f = await search(`q=hik&projectId=${proj.id}`);
ok(f.total === proj.count && f.projectCount === 1 && hits(f).length === f.total, `filtro proyecto -> ${f.total} (todas listadas)`);
f = await search('q=hik&type=ptz,lpr&status=averiada');
ok(f.total > 0 && hits(f).every((h) => ['ptz', 'lpr'].includes(h.type) && h.status === 'averiada'), `filtro tipo + estado -> ${f.total}`);
f = await search('brand=axis,dahua');
ok(f.total > 0 && hits(f).every((h) => ['Axis', 'Dahua'].includes(h.brand)), `solo filtro fabricante (sin texto) -> ${f.total}`);
const nvr = (await search(`q=hik&projectId=${proj.id}`)).facets.nvrs[0];
f = await search(`nvrId=${nvr.id}`);
const nvrTotal = f.total;
ok(f.total > 0 && hits(f).every((h) => h.nvr_name === nvr.name && h.project_id === proj.id), `filtro NVR -> ${f.total}`);

// --- Sincronización por triggers (sufijo único para poder repetir la prueba)
const tag = `zx${Date.now().toString(36)}`;
const { rows: [{ n: projCams }] } = await db.query('SELECT count(*)::int n FROM cameras WHERE project_id = $1', [proj.id]);
const { rows: [cam] } = await db.query(`SELECT id, updated_at FROM cameras WHERE project_id = $1 LIMIT 1`, [proj.id]);
await db.query(`UPDATE projects SET name = name || ' ${tag}p' WHERE id = $1`, [proj.id]);
f = await search(`q=${tag}p`);
ok(f.total === projCams, `renombrar proyecto -> sus ${projCams} cámaras se encuentran por el nuevo nombre (${f.total})`);
const { rows: [after] } = await db.query(`SELECT updated_at FROM cameras WHERE id = $1`, [cam.id]);
ok(after.updated_at.getTime() === cam.updated_at.getTime(), 'la propagación no altera updated_at de las cámaras');
await db.query(`UPDATE nvrs SET name = 'NVR-${tag}n' WHERE id = $1`, [nvr.id]);
f = await search(`q=${tag}n`);
ok(f.total === nvrTotal, `renombrar NVR -> sus ${nvrTotal} cámaras se encuentran por el nuevo nombre (${f.total})`);
await db.query(`UPDATE cameras SET notes = 'Cámara junto a la báscula ${tag}c' WHERE id = $1`, [cam.id]);
f = await search(`q=bascula%20${tag}c`);
ok(f.total === 1, 'editar observaciones -> indexado al instante (búsqueda sin tilde)');

// --- Rendimiento (API completa: 3 consultas + JSON)
const queries = ['192.168', 'hik', 'almacen', 'muelle', 'axis acceso', 'CAM-0', 'nocturno', 'dahua perimetro', 'oficinas', '10.1'];
const times = [];
for (let round = 0; round < 3; round++) {
  for (const q of queries) {
    const t = performance.now();
    await search(`q=${encodeURIComponent(q)}`);
    times.push(performance.now() - t);
  }
}
times.sort((a, b) => a - b);
const pct = (p) => times[Math.floor((times.length - 1) * p)].toFixed(0);
console.log(`\nLatencia API (${times.length} búsquedas sobre ${totalCams} cámaras): p50 ${pct(0.5)} ms · p95 ${pct(0.95)} ms · máx ${pct(1)} ms`);

// --- Plan de ejecución. Con términos selectivos debe usar el índice de trigramas;
// con términos muy frecuentes (>~5% de filas) PostgreSQL elige, con razón, un seq scan.
const { rows: plan } = await db.query(
  `EXPLAIN (ANALYZE, BUFFERS OFF) SELECT count(*) FROM cameras c WHERE c.search_text LIKE '%' || search_norm('Báscula') || '%'`,
);
const planText = plan.map((r) => r['QUERY PLAN']).join('\n');
console.log(`\n${planText}\n`);
ok(/cameras_search_trgm/.test(planText), 'consulta selectiva -> el planificador usa el índice GIN de trigramas');

await db.end();
