// Pruebas de seguridad del bloque A (auditoría 2026-10-22). Se ejecuta contra la API real.
// Uso:
//   API_URL=http://backend:4000/api ADMIN_EMAIL=… ADMIN_PASSWORD=… \
//   [APP_DATABASE_URL=postgres://cctv_app:…@postgres:5432/cctv] node scripts/security-check.mjs
// APP_DATABASE_URL (opcional) comprueba los privilegios del rol de la aplicación.
import { deflateSync } from 'node:zlib';

const BASE = process.env.API_URL ?? 'http://localhost:4000/api';
const ADMIN = { email: process.env.ADMIN_EMAIL ?? 'admin@example.com', password: process.env.ADMIN_PASSWORD ?? 'Admin123!' };
let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'OK  ' : 'FAIL'} ${msg}`); if (!cond) failures++; };

async function call(method, path, { body, token, form, raw } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + path, { method, headers, body: form ?? (body ? JSON.stringify(body) : undefined) });
  if (raw) return res;
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data, headers: res.headers };
}
const login = (email, password) => call('POST', '/auth/login', { body: { email, password } });
const uniq = Date.now().toString(36);

function png(w, h) {
  const t = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = t[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (ty, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(ty), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const rows = Buffer.alloc((w * 3 + 1) * h, 0xcc); for (let y = 0; y < h; y++) rows[y * (w * 3 + 1)] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

// ---------------------------------------------------------------- sesión admin
let r = await login(ADMIN.email, ADMIN.password);
ok(r.status === 200 && r.data.token, 'login del administrador');
const admin = r.data.token;

// ---------------------------------------------------------- M-01 / M-04 / L-03
r = await call('GET', '/openapi.json');
ok(r.status === 401 || r.status === 404, `M-01 /api/openapi.json no es público (HTTP ${r.status})`);
r = await call('GET', '/docs/');
ok(r.status === 401 || r.status === 404, `M-01 /api/docs no es público (HTTP ${r.status})`);
r = await call('GET', '/projects', { token: admin });
ok(r.headers.get('cache-control') === 'no-store' && r.headers.get('pragma') === 'no-cache' && !r.headers.get('etag'), 'M-04 API con Cache-Control: no-store, Pragma y sin ETag');
ok((r.headers.get('content-security-policy') ?? '').startsWith("default-src 'none'"), "L-03 CSP de la API: default-src 'none'");

// ---------------------------------------------------- P-07 política de contraseñas
r = await call('POST', '/users', { token: admin, body: { email: `corta-${uniq}@tekusys.io`, name: 'x', role: 'lectura', password: 'Corta123!' } });
ok(r.status === 400, 'P-07 contraseña de menos de 12 caracteres rechazada');
r = await call('POST', '/users', { token: admin, body: { email: `obvia-${uniq}@tekusys.io`, name: 'x', role: 'lectura', password: 'MiPasswordDeTekusys' } });
ok(r.status === 400, 'P-07 contraseña con palabra obvia rechazada');

// ------------------------------------------ alta con contraseña temporal + cambio obligatorio
const email = `tecnico-${uniq}@tekusys.io`;
let pass = 'Temporal-Inicial-2026';
r = await call('POST', '/users', { token: admin, body: { email, name: 'Técnico de prueba', role: 'tecnico', password: pass } });
ok(r.status === 201 && r.data.must_change_password === true, 'alta: la contraseña inicial es temporal');
const userId = r.data.id;
r = await login(email, pass);
ok(r.status === 200 && r.data.user.mustChangePassword === true, 'login con contraseña temporal indica cambio obligatorio');
let tok = r.data.token;
r = await call('GET', '/projects', { token: tok });
ok(r.status === 403 && r.data.details?.code === 'PASSWORD_CHANGE_REQUIRED', 'con contraseña temporal la API queda bloqueada (403)');
r = await call('GET', '/auth/me', { token: tok });
ok(r.status === 200 && r.data.mustChangePassword === true, '/auth/me sí responde para poder cambiarla');
r = await call('POST', '/auth/change-password', { token: tok, body: { currentPassword: 'mala-mala-mala', newPassword: 'Otra-Frase-Segura-2026' } });
ok(r.status === 400, 'cambio con contraseña actual incorrecta -> 400');
const newPass = 'Una-Frase-Bastante-Larga-26';
r = await call('POST', '/auth/change-password', { token: tok, body: { currentPassword: pass, newPassword: newPass } });
ok(r.status === 200 && r.data.token && r.data.user.mustChangePassword === false, 'cambio de contraseña correcto (token nuevo)');
const oldTok = tok;
tok = r.data.token;
pass = newPass;
r = await call('GET', '/projects', { token: oldTok });
ok(r.status === 401, 'P-06 el token anterior queda revocado tras cambiar la contraseña');
r = await call('GET', '/projects', { token: tok });
ok(r.status === 200, 'el token nuevo funciona');

// ------------------------------------------------------- P-06 revocación
r = await call('PATCH', `/users/${userId}`, { token: admin, body: { role: 'lectura' } });
r = await call('GET', '/projects', { token: tok });
ok(r.status === 401, 'P-06 cambio de rol: las sesiones abiertas se cierran');
r = await login(email, pass); tok = r.data.token;
r = await call('POST', '/projects', { token: tok, body: { name: 'x' } });
ok(r.status === 403, 'RBAC: el rol nuevo (lectura) se aplica al volver a entrar');
r = await call('DELETE', `/users/${userId}`, { token: admin });
r = await call('GET', '/projects', { token: tok });
ok(r.status === 401, 'P-06 usuario desactivado: su token deja de valer al instante');
r = await login(email, pass);
ok(r.status === 401, 'usuario desactivado no puede iniciar sesión');
await call('PATCH', `/users/${userId}`, { token: admin, body: { active: true, role: 'tecnico' } });
r = await login(email, pass); tok = r.data.token;
r = await call('POST', '/auth/logout', { token: tok });
ok(r.status === 204, 'logout en el servidor');
r = await call('GET', '/projects', { token: tok });
ok(r.status === 401, 'P-06 tras cerrar sesión el token ya no vale');

// ------------------------------------------------------- M-03 bloqueo por cuenta
const codes = [];
for (let i = 0; i < 5; i++) codes.push((await login(email, 'contraseña-incorrecta')).status);
ok(codes.every((c) => c === 401), `5 fallos -> 401 (${codes.join(',')})`);
r = await login(email, pass);
ok(r.status === 429 && /bloqueada/i.test(r.data.error), 'M-03 la cuenta queda bloqueada aunque después se use la contraseña correcta');
r = await call('GET', '/users', { token: admin });
ok(r.data.find((u) => u.id === userId)?.locked_until, 'el administrador ve el bloqueo');
r = await call('POST', `/users/${userId}/unlock`, { token: admin });
r = await login(email, pass);
ok(r.status === 200, 'tras desbloquear, la contraseña correcta funciona');

// Tiempo: un email inexistente no debe responder más rápido (bcrypt siempre)
const time = async (e) => { const t = performance.now(); await login(e, 'x-incorrecta-x'); return performance.now() - t; };
const median = (a) => a.sort((x, y) => x - y)[a.length >> 1];
const known = [], unknown = [];
const probe = `timing-${uniq}@tekusys.io`;
await call('POST', '/users', { token: admin, body: { email: probe, name: 'timing', role: 'lectura', password: 'Timing-Prueba-Larga-26' } });
for (let i = 0; i < 3; i++) { known.push(await time(probe)); unknown.push(await time(`noexiste-${uniq}-${i}@tekusys.io`)); }
const [mk, mu] = [median(known), median(unknown)];
ok(Math.abs(mk - mu) < Math.max(mk, mu) * 0.5, `sin oráculo de tiempo (existente ${mk.toFixed(0)} ms / inexistente ${mu.toFixed(0)} ms)`);

// --------------------------------------------- restablecimiento por el administrador
r = await login(email, pass); tok = r.data.token;
r = await call('POST', `/users/${userId}/reset-access`, { token: admin });
ok(r.status === 200 && /\/restablecer#token=/.test(r.data.url), 'restablecer acceso: enlace con el token en el fragmento (#)');
const resetToken = new URL(r.data.url).hash.split('=')[1];
r = await call('GET', '/projects', { token: tok });
ok(r.status === 401, 'restablecer acceso cierra las sesiones abiertas');
r = await call('POST', '/auth/reset-password', { body: { token: 'x'.repeat(43), password: 'Nueva-Frase-Segura-2026' } });
ok(r.status === 400, 'token de restablecimiento falso -> 400');
r = await call('POST', '/auth/reset-password', { body: { token: resetToken, password: 'corta' } });
ok(r.status === 400, 'restablecimiento con contraseña débil -> 400 (el enlace sigue valiendo)');
r = await call('POST', '/auth/reset-password', { body: { token: resetToken, password: 'Nueva-Frase-Segura-2026' } });
ok(r.status === 200 && r.data.email === email, 'restablecimiento correcto');
r = await call('POST', '/auth/reset-password', { body: { token: resetToken, password: 'Otra-Frase-Segura-2027' } });
ok(r.status === 400, 'el enlace es de un solo uso');
ok((await login(email, pass)).status === 401, 'la contraseña anterior ya no vale');
ok((await login(email, 'Nueva-Frase-Segura-2026')).status === 200, 'la contraseña nueva funciona');
r = await call('POST', `/users/${(await call('GET', '/auth/me', { token: admin })).data.id}/reset-access`, { token: admin });
ok(r.status === 400, 'un administrador no puede generarse un enlace a sí mismo');

// ------------------------------------------------ P-03 / P-04 adjuntos
const p = await call('POST', '/projects', { token: admin, body: { name: `Seguridad ${uniq}` } });
const plan = await call('POST', `/projects/${p.data.id}/plans`, { token: admin, body: { name: 'P' } });
const pf = new FormData();
pf.append('file', new Blob([Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')], { type: 'image/png' }), 'plano.png');
r = await call('PUT', `/plans/${plan.data.id}/image`, { token: admin, form: pf });
ok(r.status === 400 || r.status === 415, `P-03 plano falso (SVG con script declarado como PNG) rechazado (HTTP ${r.status})`);
const pf2 = new FormData();
pf2.append('file', new Blob([png(64, 48)], { type: 'image/jpeg' }), 'plano.jpg');
r = await call('PUT', `/plans/${plan.data.id}/image`, { token: admin, form: pf2 });
ok(r.status === 200 && r.data.mime_type === 'image/png', 'P-03 el plano se guarda con su tipo real (PNG declarado como JPEG)');
const cam = await call('POST', `/projects/${p.data.id}/cameras`, { token: admin, body: { floor_plan_id: plan.data.id, type: 'domo', pos_x: 0.5, pos_y: 0.5 } });
const upload = async (buf, type, name) => {
  const f = new FormData();
  f.append('files', new Blob([buf], { type }), name);
  return call('POST', `/cameras/${cam.data.id}/attachments`, { token: admin, form: f });
};
r = await upload(Buffer.from('<html><script>alert(document.cookie)</script></html>'), 'image/png', 'foto.png');
ok(r.status === 415, 'P-03 HTML disfrazado de imagen rechazado (415)');
r = await upload(Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0, 0, 0, 0xff, 0xff]), 'application/pdf', 'ficha.pdf');
ok(r.status === 415, 'P-03 ejecutable disfrazado de PDF rechazado (415)');
r = await upload(Buffer.from('texto\u0000binario'), 'text/plain', 'notas.txt');
ok(r.status === 415, 'P-03 binario disfrazado de texto rechazado (415)');
r = await upload(png(32, 32), 'application/octet-stream', 'foto sin tipo.png');
ok(r.status === 201 && r.data[0].mime_type === 'image/png' && r.data[0].kind === 'foto', 'P-03 imagen detectada por contenido (tipo declarado genérico)');
const photoId = r.data[0].id;
const fakePdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
r = await upload(fakePdf, 'image/png', 'ficha\u0007técnica.pdf');
ok(r.status === 400, `nombre de fichero con caracteres de control -> 400, no 500 (HTTP ${r.status})`);
r = await upload(fakePdf, 'image/png', 'ficha técnica.pdf');
ok(r.status === 201 && r.data[0].mime_type === 'application/pdf' && r.data[0].kind === 'documento', 'P-03 PDF declarado como imagen: se guarda como PDF/documento');
ok(r.data[0].original_name === 'ficha técnica.pdf', 'nombre de fichero con acentos conservado');
const pdfId = r.data[0].id;
const bad = await fetch(BASE + '/projects', { method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' }, body: '{"name": ' });
ok(bad.status === 400, `JSON mal formado -> 400, no 500 (HTTP ${bad.status})`);
r = await upload(Buffer.from('Notas de instalación: cámara a 6 m.\n'), 'text/plain', 'notas.txt');
ok(r.status === 201, 'texto plano UTF-8 aceptado');
let res = await call('GET', `/attachments/${pdfId}/file`, { token: admin, raw: true });
ok(/^attachment;/.test(res.headers.get('content-disposition') ?? '') && res.headers.get('content-security-policy') === "default-src 'none'; sandbox", 'P-04 los documentos se descargan (attachment) con CSP sandbox');
res = await call('GET', `/attachments/${photoId}/file`, { token: admin, raw: true });
ok(/^inline;/.test(res.headers.get('content-disposition') ?? '') && res.headers.get('x-content-type-options') === 'nosniff', 'P-04 las fotos se muestran (inline) con nosniff');

// --------------------------------------------- auditoría de los eventos nuevos
r = await call('GET', `/audit?entityId=${userId}&limit=100`, { token: admin });
const actions = new Set(r.data.map((a) => a.action));
ok(['login_failed', 'logout', 'password_change', 'password_reset', 'login'].every((a) => actions.has(a)), `auditoría de eventos de cuenta (${[...actions].join(', ')})`);

// ------------------------------------------ P-11 / P-08 privilegios del rol de la aplicación
if (process.env.APP_DATABASE_URL) {
  const { default: pg } = await import('pg');
  const db = new pg.Client({ connectionString: process.env.APP_DATABASE_URL });
  await db.connect();
  const denied = async (sql) => { try { await db.query(sql); return false; } catch (e) { return /permission denied|must be owner|must be superuser/i.test(e.message); } };
  const { rows } = await db.query('SELECT rolsuper, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname = current_user');
  ok(rows[0] && !rows[0].rolsuper && !rows[0].rolcreaterole && !rows[0].rolcreatedb, 'P-11 la aplicación no usa un superusuario');
  ok((await db.query('SELECT count(*) FROM users')).rows.length === 1, 'P-11 el rol de la aplicación puede leer datos');
  ok(await denied('DELETE FROM audit_log'), 'P-08 la auditoría no se puede borrar con el rol de la aplicación');
  ok(await denied("UPDATE audit_log SET action = 'login'"), 'P-08 la auditoría no se puede modificar');
  ok(await denied('TRUNCATE audit_log'), 'P-08 la auditoría no se puede vaciar');
  ok(await denied('CREATE TABLE x (id int)'), 'P-11 el rol de la aplicación no puede crear tablas');
  ok(await denied('DROP TABLE cameras'), 'P-11 el rol de la aplicación no puede borrar tablas');
  ok(await denied('ALTER TABLE users ADD COLUMN x int'), 'P-11 el rol de la aplicación no puede alterar el esquema');
  ok(await denied("DELETE FROM schema_migrations"), 'P-11 el rol de la aplicación no toca las migraciones');
  await db.end();
} else {
  console.log('---- (sin APP_DATABASE_URL: no se comprueban los privilegios de la BD)');
}

console.log(`\n${failures} fallos`);
process.exitCode = failures ? 1 : 0;
