import { pool, type Queryable } from '../../db/pool.js';
import type { CameraRow } from '../../domain.js';
import { notFound } from '../../middleware/error.js';
import type { z } from 'zod';
import type { listCamerasQuery } from './cameras.schemas.js';

const SELECT = `
  SELECT c.*, host(c.ip_address) AS ip_address, n.name AS nvr_name,
    (SELECT count(*)::int FROM attachments a WHERE a.camera_id = c.id) AS attachment_count
  FROM cameras c LEFT JOIN nvrs n ON n.id = c.nvr_id`;

export async function listCameras(projectId: string, f: z.infer<typeof listCamerasQuery> = {}, db: Queryable = pool) {
  const where = ['c.project_id = $1'];
  const params: unknown[] = [projectId];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    where.push(sql.replace('?', `$${params.length}`));
  };
  if (f.floorPlanId) add('c.floor_plan_id = ?', f.floorPlanId);
  if (f.status?.length) add('c.status = ANY(?::camera_status[])', f.status);
  if (f.type?.length) add('c.type = ANY(?::camera_type[])', f.type);
  if (f.brand) add('lower(c.brand) = ANY(?)', f.brand.split(',').map((b) => b.trim().toLowerCase()));
  if (f.q) {
    params.push(`%${f.q}%`);
    const p = `$${params.length}`;
    where.push(`(c.name ILIKE ${p} OR c.code ILIKE ${p} OR host(c.ip_address) LIKE ${p})`);
  }
  const { rows } = await db.query<CameraRow>(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY c.code`, params);
  return rows;
}

export async function getCamera(id: string, db: Queryable = pool): Promise<CameraRow> {
  const { rows } = await db.query<CameraRow>(`${SELECT} WHERE c.id = $1`, [id]);
  if (!rows[0]) throw notFound('Cámara');
  return rows[0];
}

/** Siguiente código libre con formato CAM-001 dentro del proyecto. */
export async function nextCameraCode(projectId: string, db: Queryable = pool): Promise<string> {
  const { rows } = await db.query<{ n: number }>(
    `SELECT coalesce(max(substring(code FROM '^CAM-(\\d+)$')::int), 0) + 1 AS n FROM cameras WHERE project_id = $1`,
    [projectId],
  );
  return `CAM-${String(rows[0].n).padStart(3, '0')}`;
}
