import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool.js';
import { ATTACHMENT_KINDS, EDITOR_ROLES } from '../../domain.js';
import { currentUser, requireRole } from '../../middleware/auth.js';
import { HttpError, notFound } from '../../middleware/error.js';
import { attachmentUpload, isPhotoMime } from '../../middleware/upload.js';
import { idParam, optText } from '../../lib/validation.js';
import { extOf, storage } from '../../storage/storage.js';
import { audit } from '../audit/audit.service.js';
import { getCamera } from '../cameras/cameras.repository.js';

export const attachmentsRouter = Router();

const COLS = 'id, camera_id, kind, original_name, mime_type, size_bytes::int AS size_bytes, description, created_at';

attachmentsRouter.get('/cameras/:id/attachments', async (req, res) => {
  const { id } = idParam.parse(req.params);
  const { rows } = await pool.query(
    `SELECT ${COLS} FROM attachments WHERE camera_id = $1 ORDER BY kind, created_at DESC`,
    [id],
  );
  res.json(rows);
});

/** multipart/form-data: files[] (hasta 10), kind? (foto|documento), description? */
attachmentsRouter.post(
  '/cameras/:id/attachments',
  requireRole(...EDITOR_ROLES),
  attachmentUpload.array('files', 10),
  async (req, res) => {
    const { id } = idParam.parse(req.params);
    const camera = await getCamera(id);
    const body = z
      .object({ kind: z.enum(ATTACHMENT_KINDS).optional(), description: optText(500) })
      .parse(req.body);
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (!files.length) throw new HttpError(400, 'No se ha recibido ningún fichero (campo "files")');

    const created = [];
    for (const file of files) {
      // Multer entrega el nombre en latin1; lo pasamos a UTF-8 para conservar acentos
      const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
      const kind = body.kind ?? (isPhotoMime(file.mimetype) ? 'foto' : 'documento');
      // Fotos y documentos en raíces distintas (/data/uploads y /data/documents en producción)
      const folder = kind === 'foto' ? `photos/${id}` : `documents/${id}`;
      const key = await storage.save(file.buffer, { folder, ext: extOf(originalName) });
      const { rows } = await pool.query(
        `INSERT INTO attachments (camera_id, kind, original_name, mime_type, size_bytes, storage_key, description, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${COLS}`,
        [id, kind, originalName, file.mimetype, file.size, key, body.description ?? null, currentUser(req).id],
      );
      created.push(rows[0]);
      await audit(req, { action: 'create', entityType: 'attachment', entityId: rows[0].id, projectId: camera.project_id, changes: rows[0] });
    }
    res.status(201).json(created);
  },
);

attachmentsRouter.get('/attachments/:id/file', async (req, res) => {
  const { id } = idParam.parse(req.params);
  const { rows } = await pool.query('SELECT * FROM attachments WHERE id = $1', [id]);
  const att = rows[0];
  if (!att) throw notFound('Adjunto');
  res.setHeader('Content-Type', att.mime_type);
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(att.original_name)}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  storage.stream(att.storage_key).on('error', () => res.destroy()).pipe(res);
});

attachmentsRouter.delete('/attachments/:id', requireRole(...EDITOR_ROLES), async (req, res) => {
  const { id } = idParam.parse(req.params);
  const { rows } = await pool.query(
    `DELETE FROM attachments a USING cameras c WHERE a.id = $1 AND c.id = a.camera_id
     RETURNING a.id, a.camera_id, a.kind, a.original_name, a.storage_key, c.project_id`,
    [id],
  );
  if (!rows[0]) throw notFound('Adjunto');
  await storage.remove(rows[0].storage_key);
  const { storage_key: _k, project_id, ...snapshot } = rows[0];
  await audit(req, { action: 'delete', entityType: 'attachment', entityId: id, projectId: project_id, changes: snapshot });
  res.status(204).end();
});
