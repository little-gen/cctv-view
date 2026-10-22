import { fileTypeFromBuffer } from 'file-type';
import { HttpError } from '../middleware/error.js';

type Kind = 'foto' | 'documento';

/**
 * Tipo real de un adjunto a partir de su contenido (firma / "magic bytes"), no del tipo
 * que declara el navegador (hallazgo P-03). Devuelve el MIME que se guardará y servirá.
 */
const BY_SIGNATURE: Record<string, { mime: string; kind: Kind }> = {
  'image/png': { mime: 'image/png', kind: 'foto' },
  'image/jpeg': { mime: 'image/jpeg', kind: 'foto' },
  'image/webp': { mime: 'image/webp', kind: 'foto' },
  'image/heic': { mime: 'image/heic', kind: 'foto' },
  'image/heif': { mime: 'image/heic', kind: 'foto' },
  'application/pdf': { mime: 'application/pdf', kind: 'documento' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    kind: 'documento',
  },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    kind: 'documento',
  },
  'application/zip': { mime: 'application/zip', kind: 'documento' },
};

// .doc / .xls antiguos: contenedor OLE (CFB); se acepta el tipo declarado si es uno de estos
const CFB_DECLARED = ['application/msword', 'application/vnd.ms-excel'];

function isPlainText(buf: Buffer) {
  const head = buf.subarray(0, 65_536);
  if (head.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(head);
    return true;
  } catch {
    return false;
  }
}

export async function detectAttachment(buf: Buffer, declared: string): Promise<{ mime: string; kind: Kind }> {
  const detected = await fileTypeFromBuffer(buf);
  if (detected) {
    const hit = BY_SIGNATURE[detected.mime];
    if (hit) return hit;
    if (detected.mime === 'application/x-cfb' && CFB_DECLARED.includes(declared)) return { mime: declared, kind: 'documento' };
    throw new HttpError(415, `Tipo de archivo no permitido (${detected.ext})`);
  }
  if (declared === 'text/plain' && isPlainText(buf)) return { mime: 'text/plain; charset=utf-8', kind: 'documento' };
  throw new HttpError(415, 'No se reconoce el tipo de archivo; formatos admitidos: imágenes, PDF, Word, Excel, ZIP y texto');
}

export const isInlineSafe = (mime: string) => /^image\/(png|jpeg|webp)$/.test(mime);
