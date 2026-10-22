// Prueba de humo end-to-end de la API (requiere BD migrada + seed y la API arrancada).
// Uso: npm run smoke -w backend   (API_URL=http://host:puerto/api para otra URL)
import { deflateSync } from 'node:zlib';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.env.API_URL ?? 'http://localhost:4000/api';
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'planos-smoke-'));
let token = '';
const ok = (cond, msg) => { console.log(`${cond ? 'OK  ' : 'FAIL'} ${msg}`); if (!cond) process.exitCode = 1; };

async function call(method, p, body, { form, raw, tok = token } = {}) {
  const headers = tok ? { Authorization: `Bearer ${tok}` } : {};
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + p, { method, headers, body: form ?? (body ? JSON.stringify(body) : undefined) });
  if (raw) return res;
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

// PNG mínimo 800x400 gris
function png(w, h) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const rows = Buffer.alloc((w * 3 + 1) * h, 0xdd); for (let y = 0; y < h; y++) rows[y * (w * 3 + 1)] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

let r = await call('POST', '/auth/login', { email: 'admin@example.com', password: 'mala' });
ok(r.status === 401, 'login con contraseña incorrecta -> 401');
r = await call('POST', '/auth/login', { email: 'admin@example.com', password: 'Admin123!' });
ok(r.status === 200 && r.data.token, 'login admin');
token = r.data.token;

r = await call('POST', '/projects', { name: 'Polígono Norte · Nave A', client: 'Logística Ñandú', address: 'C/ Industria 3' });
ok(r.status === 201, 'crear proyecto');
const project = r.data;

r = await call('POST', `/projects/${project.id}/plans`, { name: 'Planta baja', width_m: 80 });
ok(r.status === 201 && r.data.width_m === 80, 'crear plano');
const plan = r.data;

const form = new FormData();
form.append('file', new Blob([png(800, 400)], { type: 'image/png' }), 'plano.png');
r = await call('PUT', `/plans/${plan.id}/image`, null, { form });
ok(r.status === 200 && r.data.width_px === 800 && r.data.version === 1, 'subir imagen del plano (800x400, v1)');

r = await call('POST', `/projects/${project.id}/cameras`, { floor_plan_id: plan.id, type: 'domo', pos_x: 0.25, pos_y: 0.5 });
ok(r.status === 201 && r.data.code === 'CAM-001' && r.data.fov_deg === 100, `crear cámara con código autogenerado (${r.data?.code}, fov ${r.data?.fov_deg})`);
const cam1 = r.data;
r = await call('POST', `/projects/${project.id}/cameras`, {
  floor_plan_id: plan.id, type: 'lpr', pos_x: 0.8, pos_y: 0.2, rotation_deg: -90, brand: 'Hikvision', ip_address: '192.168.1.65', status: 'averiada', installed_at: '2026-03-15',
});
ok(r.status === 201 && r.data.code === 'CAM-002' && r.data.rotation_deg === 270 && r.data.ip_address === '192.168.1.65', 'crear LPR (rotación normalizada a 270, IP)');
const cam2 = r.data;
r = await call('POST', `/projects/${project.id}/cameras`, { floor_plan_id: plan.id, type: 'ptz', pos_x: 1.5, pos_y: 0.2 });
ok(r.status === 400, 'posición fuera de rango -> 400');
r = await call('POST', `/projects/${project.id}/cameras`, { floor_plan_id: plan.id, type: 'ptz', pos_x: 0.5, pos_y: 0.5, ip_address: '999.1.1.1' });
ok(r.status === 400, 'IP no válida -> 400');
r = await call('POST', `/projects/${project.id}/cameras`, { floor_plan_id: plan.id, type: 'ptz', pos_x: 0.5, pos_y: 0.5, code: 'CAM-001' });
ok(r.status === 409, 'código duplicado -> 409');

r = await call('POST', `/projects/${project.id}/nvrs`, { name: 'NVR-01', ip_address: '192.168.1.10', channels: 32 });
ok(r.status === 201, 'crear NVR');
const nvr = r.data;

r = await call('PATCH', `/cameras/${cam1.id}`, { name: 'Acceso principal', ip_address: '192.168.1.64', nvr_id: nvr.id, pos_x: 0.3, brand: '' });
ok(r.status === 200 && r.data.nvr_name === 'NVR-01' && r.data.brand === null, 'editar cámara (NVR asociado, "" -> null)');

r = await call('GET', `/projects/${project.id}/cameras?status=averiada`);
ok(r.data.length === 1 && r.data[0].id === cam2.id, 'filtro por estado');
r = await call('GET', `/projects/${project.id}/cameras?q=192.168.1.64`);
ok(r.data.length === 1 && r.data[0].id === cam1.id, 'búsqueda por IP');
r = await call('GET', `/projects/${project.id}/cameras?brand=hikvision&type=lpr,domo`);
ok(r.data.length === 1, 'filtro por fabricante + tipo');
r = await call('GET', `/projects/${project.id}/stats`);
ok(r.data.total === 2 && r.data.averiadas === 1 && r.data.byType.length === 2, 'estadísticas');

const af = new FormData();
af.append('files', new Blob([png(40, 30)], { type: 'image/png' }), 'foto instalación.png');
af.append('files', new Blob(['%PDF-1.4 ficha'], { type: 'application/pdf' }), 'ficha_técnica.pdf');
r = await call('POST', `/cameras/${cam1.id}/attachments`, null, { form: af });
ok(r.status === 201 && r.data.length === 2 && r.data[0].kind === 'foto' && r.data[1].kind === 'documento' && r.data[1].original_name === 'ficha_técnica.pdf', 'subir foto + documento (tipo autodetectado, acentos)');
const fileRes = await call('GET', `/attachments/${r.data[0].id}/file`, null, { raw: true });
ok(fileRes.status === 200 && fileRes.headers.get('content-type') === 'image/png', 'descargar adjunto');

r = await call('GET', `/cameras/${cam1.id}/history`);
ok(r.status === 200 && r.data.some((h) => h.action === 'update' && h.changes.name) && r.data.some((h) => h.action === 'create'), `historial de la cámara (${r.data.length} entradas)`);

// Sustituir plano conservando cámaras
const f2 = new FormData();
f2.append('file', new Blob([png(1600, 800)], { type: 'image/png' }), 'plano_v2.png');
r = await call('PUT', `/plans/${plan.id}/image`, null, { form: f2 });
ok(r.status === 200 && r.data.version === 2 && !r.data.warning, 'sustituir plano (misma proporción, sin aviso)');
r = await call('GET', `/projects/${project.id}/cameras?floorPlanId=${plan.id}`);
ok(r.data.length === 2 && r.data[0].pos_x === 0.3, 'las cámaras se conservan tras sustituir el plano');
const f3 = new FormData();
f3.append('file', new Blob([png(800, 800)], { type: 'image/png' }), 'plano_v3.png');
r = await call('PUT', `/plans/${plan.id}/image`, null, { form: f3 });
ok(!!r.data.warning, 'aviso al cambiar la proporción');
r = await call('GET', `/plans/${plan.id}/images`);
ok(r.data.length === 3, 'histórico de imágenes del plano');

// Visor por teselas (niveles de zoom)
r = await call('GET', `/plans/${plan.id}/tiles-info`);
ok(r.status === 200 && r.data.version === 3 && r.data.width === 800 && r.data.maxLevel === 10 && r.data.tileSize === 512, `tiles-info (v${r.data?.version}, nivel máx. ${r.data?.maxLevel})`);
let tile = await call('GET', `/plans/${plan.id}/tiles/3/10/1_1.webp`, null, { raw: true });
ok(tile.status === 200 && tile.headers.get('content-type') === 'image/webp' && /immutable/.test(tile.headers.get('cache-control') ?? ''), 'tesela del nivel máximo (WebP, caché inmutable)');
tile = await call('GET', `/plans/${plan.id}/preview/3`, null, { raw: true });
ok(tile.status === 200, 'vista previa del plano');
tile = await call('GET', `/plans/${plan.id}/tiles/2/10/0_0.webp`, null, { raw: true });
ok(tile.status === 404, 'las teselas de la versión sustituida se eliminan');
tile = await call('GET', `/plans/${plan.id}/tiles/3/10/..%2F..%2Fpreview.webp`, null, { raw: true });
ok(tile.status === 400, 'nombre de tesela manipulado -> 400');

for (const [p, name, magic] of [
  [`/plans/${plan.id}/export/pdf`, 'plano.pdf', '%PDF'],
  [`/projects/${project.id}/export/report.pdf`, 'informe.pdf', '%PDF'],
  [`/projects/${project.id}/export/inventory.xlsx`, 'inventario.xlsx', 'PK'],
]) {
  const res = await call('GET', p, null, { raw: true });
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(path.join(OUT, name), buf);
  ok(res.status === 200 && buf.subarray(0, magic.length).toString() === magic, `exportar ${name} (${buf.length} bytes)`);
}

// Roles
r = await call('POST', '/auth/login', { email: 'lectura@example.com', password: 'Lectura123!' });
const readTok = r.data.token;
r = await call('GET', `/projects/${project.id}/cameras`, null, { tok: readTok });
ok(r.status === 200, 'lectura puede consultar');
r = await call('PATCH', `/cameras/${cam1.id}`, { name: 'x' }, { tok: readTok });
ok(r.status === 403, 'lectura NO puede editar -> 403');
r = await call('GET', '/audit', null, { tok: readTok });
ok(r.status === 403, 'lectura NO ve auditoría -> 403');
r = await call('POST', '/auth/login', { email: 'tecnico@example.com', password: 'Tecnico123!' });
const techTok = r.data.token;
r = await call('PATCH', `/cameras/${cam2.id}`, { status: 'mantenimiento' }, { tok: techTok });
ok(r.status === 200, 'técnico puede editar cámaras');
r = await call('POST', '/projects', { name: 'x' }, { tok: techTok });
ok(r.status === 403, 'técnico NO puede crear proyectos -> 403');
r = await call('GET', `/projects/${project.id}/cameras`, null, { tok: '' });
ok(r.status === 401, 'sin token -> 401');

r = await call('GET', '/audit?limit=50');
ok(r.status === 200 && r.data.length > 10, `auditoría (${r.data.length} entradas)`);
r = await call('DELETE', `/cameras/${cam2.id}`);
ok(r.status === 204, 'eliminar cámara');
r = await call('GET', '/openapi.json');
ok(r.status === 200 && r.data.openapi === '3.1.0', 'especificación OpenAPI servida');

