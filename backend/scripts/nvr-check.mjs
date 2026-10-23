// Prueba funcional de la gestión de NVR: capacidad, canales, mover/desasociar, permisos y auditoría.
// Requiere BD migrada + seed de desarrollo y la API arrancada. Crea sus datos y los borra al terminar.
// Uso: npm run nvr-check -w backend   (API_URL=http://host:puerto/api para otra URL)
const BASE = process.env.API_URL ?? 'http://localhost:4000/api';
let fails = 0;
const ok = (c, m) => { console.log(`${c ? 'OK  ' : 'FAIL'} ${m}`); if (!c) fails++; };

async function call(method, path, token, body) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
}
const login = async (email, password) => (await call('POST', '/auth/login', null, { email, password })).body.token;

const admin = await login('admin@example.com', 'Admin123!');
const lectura = await login('lectura@example.com', 'Lectura123!');
const project = (await call('GET', '/projects', admin)).body[0];
const plan = (await call('GET', `/projects/${project.id}`, admin)).body.plans[0];

// Cámaras de prueba
const cams = [];
for (let i = 0; i < 5; i++) {
  const r = await call('POST', `/projects/${project.id}/cameras`, admin, { floor_plan_id: plan.id, type: 'domo', pos_x: 0.1 + i * 0.1, pos_y: 0.2, code: `TNVR-${i}` });
  cams.push(r.body);
}

let r = await call('POST', `/projects/${project.id}/nvrs`, admin, { name: 'T-NVR sin canales' });
ok(r.status === 400, `alta sin canales -> 400 (${r.status})`);
r = await call('POST', `/projects/${project.id}/nvrs`, lectura, { name: 'T-NVR', channels: 4 });
ok(r.status === 403, `lectura no puede crear NVR -> 403 (${r.status})`);
const a = (await call('POST', `/projects/${project.id}/nvrs`, admin, { name: 'T-NVR-A', channels: 4, brand: 'Hikvision' })).body;
const b = (await call('POST', `/projects/${project.id}/nvrs`, admin, { name: 'T-NVR-B', channels: 2 })).body;
ok(a.channels === 4 && a.camera_count === 0, 'alta con 4 canales');

r = await call('POST', `/nvrs/${a.id}/cameras`, admin, { cameraIds: cams.map((c) => c.id) });
ok(r.status === 409 && /solo tiene 4 canales libres/.test(r.body.error), `5 cámaras en 4 canales -> 409 «${r.body.error}»`);
r = await call('GET', `/nvrs/${a.id}`, admin);
ok(r.body.cameras.length === 0, 'tras el 409 no se ha asociado ninguna');

r = await call('POST', `/nvrs/${a.id}/cameras`, admin, { cameraIds: cams.slice(0, 4).map((c) => c.id) });
ok(r.status === 200 && r.body.map((c) => c.channel).sort().join() === '1,2,3,4', `4 cámaras -> canales ${r.body.map((c) => c.channel).sort()}`);
r = await call('POST', `/nvrs/${a.id}/cameras`, admin, { cameraIds: [cams[4].id] });
ok(r.status === 409 && /completo/.test(r.body.error), `NVR completo -> 409 «${r.body.error}»`);
r = await call('PATCH', `/cameras/${cams[4].id}`, admin, { nvr_id: a.id });
ok(r.status === 409 && /completo/.test(r.body.error), `también desde la ficha de la cámara -> 409 «${r.body.error}»`);

r = await call('PATCH', `/nvrs/${a.id}`, admin, { channels: 3 });
ok(r.status === 409, `bajar a 3 canales con 4 cámaras -> 409 «${r.body.error}»`);
r = await call('PATCH', `/nvrs/${a.id}`, admin, { channels: null });
ok(r.status === 400, `quitar los canales -> 400 (${r.status})`);

// Mover CAM 1 (canal 2) a B: conserva el canal 2
r = await call('POST', `/nvrs/${b.id}/cameras`, admin, { cameraIds: [cams[1].id] });
ok(r.status === 200 && r.body[0].nvr_id === b.id && r.body[0].channel === 2, `mover a otro NVR conserva el canal libre (${r.body[0]?.channel})`);
// Canal concreto y ocupado
r = await call('PATCH', `/cameras/${cams[4].id}`, admin, { nvr_id: a.id, channel: 1 });
ok(r.status === 409 && /ocupado/.test(r.body.error), `canal ocupado -> 409 «${r.body.error}»`);
r = await call('PATCH', `/cameras/${cams[4].id}`, admin, { nvr_id: a.id, channel: 9 });
ok(r.status === 409 && /no existe/.test(r.body.error), `canal fuera de rango -> 409 «${r.body.error}»`);
r = await call('PATCH', `/cameras/${cams[4].id}`, admin, { nvr_id: a.id });
ok(r.status === 200 && r.body.channel === 2, `canal automático = primer libre (${r.body.channel})`);

r = await call('DELETE', `/nvrs/${a.id}/cameras/${cams[0].id}`, admin);
ok(r.status === 200 && r.body.nvr_id === null && r.body.channel === null, 'desasociar deja la cámara sin NVR ni canal');
r = await call('DELETE', `/nvrs/${a.id}/cameras/${cams[0].id}`, lectura);
ok(r.status === 403, `lectura no puede desasociar -> 403 (${r.status})`);

// NVR de otro proyecto
const other = (await call('POST', '/projects', admin, { name: 'T-Proyecto NVR' })).body;
const foreign = (await call('POST', `/projects/${other.id}/nvrs`, admin, { name: 'T-Ajeno', channels: 8 })).body;
r = await call('POST', `/nvrs/${foreign.id}/cameras`, admin, { cameraIds: [cams[0].id] });
ok(r.status === 400, `cámara de otro proyecto -> 400 (${r.status})`);
r = await call('PATCH', `/cameras/${cams[0].id}`, admin, { nvr_id: foreign.id });
ok(r.status === 409 && /no pertenece/.test(r.body.error), `NVR de otro proyecto desde la ficha -> 409 «${r.body.error}»`);

r = await call('GET', `/nvrs/${a.id}`, lectura);
ok(r.status === 200 && r.body.cameras.map((c) => c.channel).join() === '2,3,4', `detalle (lectura) por canal: ${r.body.cameras.map((c) => `${c.code}@${c.channel}`).join(' ')}`);

const hist = (await call('GET', `/cameras/${cams[1].id}/history`, admin)).body;
ok(hist.some((h) => h.changes?.nvr_id?.from === a.id && h.changes?.nvr_id?.to === b.id), 'auditoría registra el movimiento de NVR (de → a)');

// Borrar NVR: las cámaras quedan libres
await call('DELETE', `/nvrs/${b.id}`, admin);
r = await call('GET', `/cameras/${cams[1].id}`, admin);
ok(r.body.nvr_id === null && r.body.channel === null, 'al borrar el NVR sus cámaras quedan sin NVR ni canal');

// Limpieza
for (const c of cams) await call('DELETE', `/cameras/${c.id}`, admin);
await call('DELETE', `/nvrs/${a.id}`, admin);
await call('DELETE', `/projects/${other.id}`, admin);
console.log(`\n${fails} fallos`);
process.exitCode = fails ? 1 : 0;
