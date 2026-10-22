import { Router } from 'express';
import { z } from 'zod';
import { pool, withTransaction, type Queryable } from '../../db/pool.js';
import { EDITOR_ROLES, type FloorPlanRow } from '../../domain.js';
import { currentUser, requireRole } from '../../middleware/auth.js';
import { HttpError, notFound } from '../../middleware/error.js';
import { planUpload } from '../../middleware/upload.js';
import { buildUpdate } from '../../lib/sql.js';
import { idParam } from '../../lib/validation.js';
import { extOf, storage } from '../../storage/storage.js';
import { audit, diff } from '../audit/audit.service.js';
import { buildPlanTiles, ensurePlanTiles, inspectPlanImage, TILE_SIZE, tilesPrefix } from './planImage.js';

export const plansRouter = Router();

const planSchema = z.object({
  name: z.string().trim().min(1).max(150),
  width_m: z.number().positive().max(10000).optional(),
  sort_order: z.number().int().optional(),
});

export async function getPlan(id: string, db: Queryable = pool): Promise<FloorPlanRow> {
  const { rows } = await db.query<FloorPlanRow>('SELECT * FROM floor_plans WHERE id = $1', [id]);
  if (!rows[0]) throw notFound('Plano');
  return rows[0];
}

// POST /api/projects/:id/plans
plansRouter.post('/projects/:id/plans', requireRole(...EDITOR_ROLES), async (req, res) => {
  const { id: projectId } = idParam.parse(req.params);
  const data = planSchema.parse(req.body);
  const { rows } = await pool.query(
    `INSERT INTO floor_plans (project_id, name, width_m, sort_order)
     VALUES ($1, $2, coalesce($3, 100), coalesce($4, (SELECT count(*) FROM floor_plans WHERE project_id = $1)))
     RETURNING *`,
    [projectId, data.name, data.width_m ?? null, data.sort_order ?? null],
  );
  await audit(req, { action: 'create', entityType: 'floor_plan', entityId: rows[0].id, projectId, changes: rows[0] });
  res.status(201).json(rows[0]);
});

plansRouter.patch('/plans/:id', requireRole(...EDITOR_ROLES), async (req, res) => {
  const { id } = idParam.parse(req.params);
  const before = await getPlan(id);
  const upd = buildUpdate(planSchema.partial().parse(req.body), 2);
  if (!upd.count) throw new HttpError(400, 'Nada que actualizar');
  const { rows } = await pool.query(`UPDATE floor_plans SET ${upd.sql} WHERE id = $1 RETURNING *`, [id, ...upd.values]);
  await audit(req, {
    action: 'update',
    entityType: 'floor_plan',
    entityId: id,
    projectId: before.project_id,
    changes: diff(before as unknown as Record<string, unknown>, rows[0]),
  });
  res.json(rows[0]);
});

plansRouter.delete('/plans/:id', requireRole('admin'), async (req, res) => {
  const { id } = idParam.parse(req.params);
  const plan = await getPlan(id);
  await pool.query('DELETE FROM floor_plans WHERE id = $1', [id]);
  await storage.removeTree(`plans/tiles/${id}`).catch(() => undefined);
  await audit(req, { action: 'delete', entityType: 'floor_plan', entityId: id, projectId: plan.project_id, changes: plan });
  res.status(204).end();
});

/**
 * Sube o sustituye la imagen del plano. Las cámaras se conservan porque
 * su posición está normalizada (0..1). La imagen anterior queda en el histórico.
 */
plansRouter.put('/plans/:id/image', requireRole(...EDITOR_ROLES), planUpload.single('file'), async (req, res) => {
  const { id } = idParam.parse(req.params);
  const plan = await getPlan(id);
  const file = req.file;
  if (!file) throw new HttpError(400, 'Falta el fichero (campo "file")');

  // Dimensiones ya orientadas (EXIF) y validación de la imagen antes de guardar nada
  await inspectPlanImage(file.buffer);
  const version = plan.version + 1;
  const key = await storage.save(file.buffer, { folder: 'plans', ext: extOf(file.originalname) || file.mimetype.split('/')[1] });

  // Pirámide de teselas de la nueva versión (segundos para planos grandes, fuera del event loop)
  let dims: Awaited<ReturnType<typeof buildPlanTiles>>;
  try {
    dims = await buildPlanTiles(id, version, file.buffer);
  } catch (err) {
    await storage.remove(key);
    throw err;
  }

  const updated = await withTransaction(async (db) => {
    await db.query(
      `INSERT INTO floor_plan_images (floor_plan_id, version, storage_key, mime_type, width_px, height_px, original_name, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, version, key, file.mimetype, dims.original.width, dims.original.height, file.originalname, currentUser(req).id],
    );
    const { rows } = await db.query<FloorPlanRow>(
      `UPDATE floor_plans SET storage_key = $2, mime_type = $3, width_px = $4, height_px = $5, version = $6
       WHERE id = $1 RETURNING *`,
      [id, key, file.mimetype, dims.width, dims.height, version],
    );
    await audit(
      req,
      { action: 'update', entityType: 'floor_plan', entityId: id, projectId: plan.project_id, changes: { image: { from: plan.version, to: version } } },
      db,
    );
    return rows[0];
  });
  // Las teselas de la versión anterior ya no se usan (se pueden regenerar desde el histórico)
  if (plan.version > 0) await storage.removeTree(tilesPrefix(id, plan.version)).catch(() => undefined);

  const warnings: string[] = [];
  // Aviso si cambia la proporción: las cámaras podrían quedar desplazadas
  if (plan.width_px && plan.height_px) {
    const oldRatio = plan.width_px / plan.height_px;
    const newRatio = dims.width / dims.height;
    if (Math.abs(oldRatio - newRatio) / oldRatio > 0.02) {
      warnings.push('La proporción del nuevo plano difiere de la anterior; revisa la posición de las cámaras.');
    }
  }
  if (dims.downscaled) {
    warnings.push(
      `El plano (${dims.original.width} × ${dims.original.height} px) se muestra a ${dims.width} × ${dims.height} px, ` +
        'más que suficiente para cualquier zoom. El original se conserva sin cambios.',
    );
  }
  res.json({ ...updated, warning: warnings.join(' ') || undefined });
});

plansRouter.get('/plans/:id/image', async (req, res) => {
  const { id } = idParam.parse(req.params);
  const plan = await getPlan(id);
  if (!plan.storage_key) throw notFound('Imagen del plano');
  res.setHeader('Content-Type', plan.mime_type ?? 'application/octet-stream');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  storage.stream(plan.storage_key).on('error', () => res.destroy()).pipe(res);
});

const tileParams = z.object({
  id: z.string().uuid(),
  version: z.coerce.number().int().min(1),
  level: z.coerce.number().int().min(0).max(30),
  tile: z.string().regex(/^\d{1,5}_\d{1,5}\.webp$/),
});

/** Sirve un fichero de teselas; si falta y es la versión vigente, genera la pirámide (planos antiguos). */
async function sendTileFile(res: import('express').Response, planId: string, version: number, rel: string) {
  const key = `${tilesPrefix(planId, version)}/${rel}`;
  if (!(await storage.exists(key))) {
    const plan = await getPlan(planId);
    if (plan.version !== version) throw notFound('Versión del plano');
    await ensurePlanTiles(plan);
    if (!(await storage.exists(key))) throw notFound('Tesela');
  }
  res.setHeader('Content-Type', 'image/webp');
  // La URL incluye la versión: el contenido nunca cambia
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  storage.stream(key).on('error', () => res.destroy()).pipe(res);
}

// GET /api/plans/:id/tiles/:version/:level/:col_:row.webp
plansRouter.get('/plans/:id/tiles/:version/:level/:tile', async (req, res) => {
  const p = tileParams.parse(req.params);
  await sendTileFile(res, p.id, p.version, `plan_files/${p.level}/${p.tile}`);
});

// GET /api/plans/:id/preview/:version  (≤2048 px)
plansRouter.get('/plans/:id/preview/:version', async (req, res) => {
  const p = tileParams.pick({ id: true, version: true }).parse(req.params);
  await sendTileFile(res, p.id, p.version, 'preview.webp');
});

/** Metadatos del visor: el cliente calcula los niveles a partir de ancho/alto. */
plansRouter.get('/plans/:id/tiles-info', async (req, res) => {
  const { id } = idParam.parse(req.params);
  const plan = await getPlan(id);
  if (!plan.storage_key || !plan.width_px || !plan.height_px) throw notFound('Imagen del plano');
  await ensurePlanTiles(plan);
  const fresh = await getPlan(id); // las dimensiones pueden haberse corregido al generar
  res.json({
    version: fresh.version,
    width: fresh.width_px,
    height: fresh.height_px,
    tileSize: TILE_SIZE,
    maxLevel: Math.ceil(Math.log2(Math.max(fresh.width_px!, fresh.height_px!))),
    format: 'webp',
  });
});

plansRouter.get('/plans/:id/images', async (req, res) => {
  const { id } = idParam.parse(req.params);
  const { rows } = await pool.query(
    `SELECT i.id, i.version, i.mime_type, i.width_px, i.height_px, i.original_name, i.created_at, u.name AS uploaded_by_name
     FROM floor_plan_images i LEFT JOIN users u ON u.id = i.uploaded_by
     WHERE floor_plan_id = $1 ORDER BY version DESC`,
    [id],
  );
  res.json(rows);
});
