import multer from 'multer';
import { config } from '../config.js';
import { HttpError } from './error.js';

const PLAN_MIME = ['image/png', 'image/jpeg'];
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

function uploader(allowed: string[]) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.maxUploadBytes, files: 10 },
    fileFilter: (_req, file, cb) => {
      if (allowed.includes(file.mimetype)) cb(null, true);
      else cb(new HttpError(415, `Tipo de archivo no permitido: ${file.mimetype}`));
    },
  });
}

/** Planos: PNG/JPEG. Los PDF se rasterizan en el cliente antes de subirlos. */
export const planUpload = uploader(PLAN_MIME);
export const attachmentUpload = uploader([...PHOTO_MIME, ...DOC_MIME]);
export const isPhotoMime = (mime: string) => PHOTO_MIME.includes(mime);
