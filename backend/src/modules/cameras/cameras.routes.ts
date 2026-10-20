import { Router } from 'express';
import { pool, withTransaction } from '../../db/pool.js';
import { CAMERA_TYPE_LABELS, EDITOR_ROLES } from '../../domain.js';
import { currentUser, requireRole } from '../../middleware/auth.js';
import { HttpError } from '../../middleware/error.js';
import { buildUpdate } from '../../lib/sql.js';
import { idParam } from '../../lib/validation.js';
import { audit, diff } from '../audit/audit.service.js';
import { getPlan } from '../plans/plans.routes.js';
import { getCamera, listCameras, nextCameraCode } from './cameras.repository.js';
import { createCameraSchema, DEFAULT_FOV, listCamerasQuery, updateCameraSchema } from './cameras.schemas.js';

export const camerasRouter = Router();

// GET /api/projects/:id/cameras?floorPlanId=&status=operativa,averiada&type=domo&brand=hikvision&q=
camerasRouter.get('/projects/:id/cameras', async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json(await listCameras(id, listCamerasQuery.parse(req.query)));
});

camerasRouter.post('/projects/:id/cameras', requireRole(...EDITOR_ROLES), async (req, res) => {
  const { id: projectId } = idParam.parse(req.params);
  const data = createCameraSchema.parse(req.body);
  const plan = await getPlan(data.floor_plan_id);
  if (plan.project_id !== projectId) throw new HttpError(400, 'El plano no pertenece al proyecto');

  const camera = await withTransaction(async (db) => {
    const code = data.code ?? (await nextCameraCode(projectId, db));
    const values = {
      ...data,
      code,
      name: data.name ?? `${CAMERA_TYPE_LABELS[data.type]} ${code}`,
      fov_deg: data.fov_deg ?? DEFAULT_FOV[data.type],
      project_id: projectId,
      created_by: currentUser(req).id,
      updated_by: currentUser(req).id,
    };
    const cols = Object.keys(values).filter((k) => values[k as keyof typeof values] !== undefined);
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO cameras (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
      cols.map((k) => values[k as keyof typeof values]),
    );
    const created = await getCamera(rows[0].id, db);
    await audit(req, { action: 'create', entityType: 'camera', entityId: created.id, projectId, changes: created }, db);
    return created;
  });
  res.status(201).json(camera);
});

camerasRouter.get('/cameras/:id', async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json(await getCamera(id));
});

camerasRouter.patch('/cameras/:id', requireRole(...EDITOR_ROLES), async (req, res) => {
  const { id } = idParam.parse(req.params);
  const data = updateCameraSchema.parse(req.body);
  const camera = await withTransaction(async (db) => {
    const before = await getCamera(id, db);
    if (data.floor_plan_id && data.floor_plan_id !== before.floor_plan_id) {
      const plan = await getPlan(data.floor_plan_id, db);
      if (plan.project_id !== before.project_id) throw new HttpError(400, 'El plano no pertenece al proyecto');
    }
    const upd = buildUpdate(data, 2, { updated_by: currentUser(req).id });
    await db.query(`UPDATE cameras SET ${upd.sql} WHERE id = $1`, [id, ...upd.values]);
    const after = await getCamera(id, db);
    const changes = diff(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>);
    delete changes.updated_by;
    if (Object.keys(changes).length) {
      await audit(req, { action: 'update', entityType: 'camera', entityId: id, projectId: before.project_id, changes }, db);
    }
    return after;
  });
  res.json(camera);
});

camerasRouter.delete('/cameras/:id', requireRole(...EDITOR_ROLES), async (req, res) => {
  const { id } = idParam.parse(req.params);
  const camera = await getCamera(id);
  await pool.query('DELETE FROM cameras WHERE id = $1', [id]);
  await audit(req, { action: 'delete', entityType: 'camera', entityId: id, projectId: camera.project_id, changes: camera });
  res.status(204).end();
});

/** Historial de cambios de una cámara (visible para todos los roles). */
camerasRouter.get('/cameras/:id/history', async (req, res) => {
  const { id } = idParam.parse(req.params);
  const { rows } = await pool.query(
    `SELECT a.id, a.occurred_at, a.action, a.changes, coalesce(u.name, a.user_email) AS user_name
     FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
     WHERE a.entity_type IN ('camera', 'attachment') AND (a.entity_id = $1 OR a.changes->>'camera_id' = $1::text)
     ORDER BY a.occurred_at DESC LIMIT 200`,
    [id],
  );
  res.json(rows);
});
