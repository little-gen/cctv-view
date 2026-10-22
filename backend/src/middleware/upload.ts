import multer from 'multer';
import { config } from '../config.js';
import { HttpError } from './error.js';

// Planos: cualquier formato raster que libvips lea (los PDF se rasterizan en el cliente)
const PLAN_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/tiff'];
const PHOTO_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/heic'];
const DOC_MIME = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'application/zip',
];

function uploader(allowed: string[], maxBytes = config.maxUploadBytes, maxFiles = 10) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxBytes, files: maxFiles },
    fileFilter: (_req, file, cb) => {
      if (allowed.includes(file.mimetype)) cb(null, true);
      else cb(new HttpError(415, `Tipo de archivo no permitido: ${file.mimetype}`));
    },
  });
}

/** Planos: límite propio (PLAN_MAX_UPLOAD_MB), un único fichero. */
export const planUpload = uploader(PLAN_MIME, config.planMaxUploadBytes, 1);
// Filtro previo por tipo declarado; el tipo real se comprueba por contenido (lib/fileType.ts).
// application/octet-stream: algunos navegadores lo envían para .heic u otras extensiones.
export const attachmentUpload = uploader([...PHOTO_MIME, ...DOC_MIME, 'application/octet-stream']);
