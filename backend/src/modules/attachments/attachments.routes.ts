import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool.js';
import { ATTACHMENT_KINDS, EDITOR_ROLES } from '../../domain.js';
import { currentUser, requireRole } from '../../middleware/auth.js';
import { HttpError, notFound } from '../../middleware/error.js';
import { attachmentUpload } from '../../middleware/upload.js';
import { detectAttachment, isInlineSafe } from '../../lib/fileType.js';
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

    // Tipo real por contenido de TODOS los ficheros antes de guardar ninguno
    const typed = await Promise.all(files.map(async (file) => ({ file, ...(await detectAttachment(file.buffer, file.mimetype)) })));

    const created = [];
    for (const { file, mime, kind: detectedKind } of typed) {
      // Multer entrega el nombre en latin1; lo pasamos a UTF-8 para conservar acentos
      const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 255);
      // Una foto solo puede ser una imagen; un documento puede ser cualquier tipo permitido
      const kind = body.kind === 'documento' ? 'documento' : detectedKind;
      // Fotos y documentos en raíces distintas (/data/uploads y /data/documents en producción)
      const folder = kind === 'foto' ? `photos/${id}` : `documents/${id}`;
      const key = await storage.save(file.buffer, { folder, ext: extOf(originalName) });
      const { rows } = await pool.query(
        `INSERT INTO attachments (camera_id, kind, original_name, mime_type, size_bytes, storage_key, description, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${COLS}`,
        [id, kind, originalName, mime, file.size, key, body.description ?? null, currentUser(req).id],
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
  // Solo las imágenes se muestran en el navegador; el resto siempre se descarga (P-04).
  // CSP "sandbox": aunque se abra directamente, el fichero no puede ejecutar nada en este origen.
  const inline = isInlineSafe(att.mime_type);
  res.setHeader('Content-Type', inline ? att.mime_type : att.mime_type.startsWith('text/plain') ? 'text/plain; charset=utf-8' : att.mime_type);
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(att.original_name)}`);
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
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
