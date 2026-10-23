import { Router } from 'express';
import { z } from 'zod';
import { pool, withTransaction, type Queryable } from '../../db/pool.js';
import { EDITOR_ROLES } from '../../domain.js';
import { currentUser, requireRole } from '../../middleware/auth.js';
import { HttpError, notFound } from '../../middleware/error.js';
import { buildUpdate } from '../../lib/sql.js';
import { idParam, optText, uuid } from '../../lib/validation.js';
import { audit, diff } from '../audit/audit.service.js';
import { getCamera } from '../cameras/cameras.repository.js';

export const nvrsRouter = Router();

const nvrFields = {
  name: z.string().trim().min(1).max(120),
  brand: optText(80),
  model: optText(80),
  ip_address: z.preprocess((v) => (v === '' ? null : v), z.string().ip().nullable()).optional(),
  // Obligatorio en los NVR nuevos; los antiguos sin canales quedan como "capacidad sin definir"
  channels: z.number({ message: 'Indica el número de canales' }).int().min(1).max(1024),
  location: optText(200),
  notes: optText(2000),
};
const createNvrSchema = z.object(nvrFields);
const updateNvrSchema = z.object(nvrFields).partial();

const COLS = 'id, project_id, name, brand, model, host(ip_address) AS ip_address, channels, location, notes, created_at, updated_at';
const WITH_COUNT = `${COLS}, (SELECT count(*)::int FROM cameras c WHERE c.nvr_id = nvrs.id) AS camera_count`;

async function getNvr(id: string, db: Queryable = pool) {
  const { rows } = await db.query(`SELECT ${WITH_COUNT} FROM nvrs WHERE id = $1`, [id]);
  if (!rows[0]) throw notFound('NVR');
  return rows[0];
}

nvrsRouter.get('/projects/:id/nvrs', async (req, res) => {
  const { id } = idParam.parse(req.params);
  const { rows } = await pool.query(`SELECT ${WITH_COUNT} FROM nvrs WHERE project_id = $1 ORDER BY name`, [id]);
  res.json(rows);
});

/** Detalle: datos del equipo y sus cámaras por orden de canal. */
nvrsRouter.get('/nvrs/:id', async (req, res) => {
  const { id } = idParam.parse(req.params);
  const nvr = await getNvr(id);
  const { rows: cameras } = await pool.query(
    `SELECT c.id, c.code, c.name, c.type, c.status, c.channel, host(c.ip_address) AS ip_address,
            c.floor_plan_id, p.name AS floor_plan_name
     FROM cameras c JOIN floor_plans p ON p.id = c.floor_plan_id
     WHERE c.nvr_id = $1 ORDER BY c.channel NULLS LAST, c.code`,
    [id],
  );
  res.json({ ...nvr, cameras });
});

nvrsRouter.post('/projects/:id/nvrs', requireRole(...EDITOR_ROLES), async (req, res) => {
  const { id: projectId } = idParam.parse(req.params);
  const d = createNvrSchema.parse(req.body);
  const { rows } = await pool.query(
    `INSERT INTO nvrs (project_id, name, brand, model, ip_address, channels, location, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${COLS}`,
    [projectId, d.name, d.brand ?? null, d.model ?? null, d.ip_address ?? null, d.channels, d.location ?? null, d.notes ?? null],
  );
  await audit(req, { action: 'create', entityType: 'nvr', entityId: rows[0].id, projectId, changes: rows[0] });
  res.status(201).json({ ...rows[0], camera_count: 0 });
});

nvrsRouter.patch('/nvrs/:id', requireRole(...EDITOR_ROLES), async (req, res) => {
  const { id } = idParam.parse(req.params);
  const before = await getNvr(id);
  const upd = buildUpdate(updateNvrSchema.parse(req.body), 2);
  if (!upd.count) throw new HttpError(400, 'Nada que actualizar');
  await pool.query(`UPDATE nvrs SET ${upd.sql} WHERE id = $1`, [id, ...upd.values]);
  const after = await getNvr(id);
  await audit(req, { action: 'update', entityType: 'nvr', entityId: id, projectId: after.project_id, changes: diff(before, after) });
  res.json(after);
});

nvrsRouter.delete('/nvrs/:id', requireRole(...EDITOR_ROLES), async (req, res) => {
  const { id } = idParam.parse(req.params);
  const { rows } = await pool.query(`DELETE FROM nvrs WHERE id = $1 RETURNING ${COLS}`, [id]);
  if (!rows[0]) throw notFound('NVR');
  await audit(req, { action: 'delete', entityType: 'nvr', entityId: id, projectId: rows[0].project_id, changes: rows[0] });
  res.status(204).end();
});

/** Cambia el NVR de una cámara (null = desasociar) y lo deja en auditoría como cambio de la cámara. */
async function setCameraNvr(req: Parameters<typeof audit>[0], db: Queryable, cameraId: string, nvrId: string | null) {
  const before = await getCamera(cameraId, db);
  if (before.nvr_id === nvrId) return before;
  // El trigger conserva el canal si está libre en el NVR de destino; si no, asigna el primero libre
  await db.query('UPDATE cameras SET nvr_id = $2, updated_by = $3 WHERE id = $1', [cameraId, nvrId, currentUser(req).id]);
  const after = await getCamera(cameraId, db);
  const changes = diff(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>);
  delete changes.updated_by;
  await audit(req, { action: 'update', entityType: 'camera', entityId: cameraId, projectId: before.project_id, changes }, db);
  return after;
}

/** Asocia cámaras existentes al NVR. Si ya tenían otro NVR, se mueven a este. */
nvrsRouter.post('/nvrs/:id/cameras', requireRole(...EDITOR_ROLES), async (req, res) => {
  const { id } = idParam.parse(req.params);
  const { cameraIds } = z.object({ cameraIds: z.array(uuid).min(1).max(1024) }).parse(req.body);
  const ids = [...new Set(cameraIds)];
  const cameras = await withTransaction(async (db) => {
    // Bloquea el NVR mientras se comprueba la capacidad y se asigna
    const { rows } = await db.query<{ project_id: string; name: string; channels: number | null }>(
      'SELECT project_id, name, channels FROM nvrs WHERE id = $1 FOR UPDATE',
      [id],
    );
    const nvr = rows[0];
    if (!nvr) throw notFound('NVR');
    const { rows: found } = await db.query<{ id: string; project_id: string; nvr_id: string | null }>(
      'SELECT id, project_id, nvr_id FROM cameras WHERE id = ANY($1::uuid[])',
      [ids],
    );
    if (found.length !== ids.length) throw notFound('Cámara');
    if (found.some((c) => c.project_id !== nvr.project_id)) throw new HttpError(400, 'Todas las cámaras deben ser del mismo proyecto que el NVR');
    const incoming = found.filter((c) => c.nvr_id !== id);
    if (nvr.channels !== null) {
      const { rows: [{ used }] } = await db.query<{ used: number }>('SELECT count(*)::int AS used FROM cameras WHERE nvr_id = $1', [id]);
      const free = Math.max(0, nvr.channels - used);
      if (incoming.length > free) {
        throw new HttpError(
          409,
          free === 0
            ? `${nvr.name} está completo: ${used} de ${nvr.channels} canales ocupados`
            : `${nvr.name} solo tiene ${free} ${free === 1 ? 'canal libre' : 'canales libres'} y has elegido ${incoming.length} cámaras`,
          { code: 'NVR_CAPACITY' },
        );
      }
    }
    const result = [];
    for (const c of incoming) result.push(await setCameraNvr(req, db, c.id, id));
    return result;
  });
  res.json(cameras);
});

nvrsRouter.delete('/nvrs/:id/cameras/:cameraId', requireRole(...EDITOR_ROLES), async (req, res) => {
  const { id, cameraId } = z.object({ id: uuid, cameraId: uuid }).parse(req.params);
  const camera = await withTransaction(async (db) => {
    const current = await getCamera(cameraId, db);
    if (current.nvr_id !== id) throw new HttpError(400, 'La cámara no está asociada a este NVR');
    return setCameraNvr(req, db, cameraId, null);
  });
  res.json(camera);
});
