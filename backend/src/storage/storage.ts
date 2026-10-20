import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { config } from '../config.js';

/**
 * Abstracción de almacenamiento de ficheros. Hoy: disco local.
 * Para producción se puede añadir un driver S3/MinIO con la misma interfaz.
 */
export interface StorageDriver {
  save(data: Buffer, opts: { folder: string; ext: string }): Promise<string>;
  read(key: string): Promise<Buffer>;
  stream(key: string): Readable;
  remove(key: string): Promise<void>;
}

/**
 * Disco local. El primer segmento de la clave decide la raíz:
 *   plans/...     -> PLANS_DIR      (producción: /data/plans)
 *   photos/...    -> UPLOADS_DIR    (producción: /data/uploads)
 *   documents/... -> DOCUMENTS_DIR  (producción: /data/documents)
 * Sin raíz configurada (o claves antiguas como "cameras/..."), se usa STORAGE_DIR/<clave>.
 */
class LocalStorage implements StorageDriver {
  constructor(
    private defaultRoot: string,
    private roots: Record<string, string | undefined>,
  ) {}

  private resolve(key: string): string {
    const [prefix, ...rest] = key.split('/');
    const root = this.roots[prefix];
    const [base, relative] = root ? [root, rest.join('/')] : [this.defaultRoot, key];
    const full = path.resolve(base, relative);
    if (!full.startsWith(base + path.sep)) throw new Error('Clave de almacenamiento no válida');
    return full;
  }

  async save(data: Buffer, { folder, ext }: { folder: string; ext: string }): Promise<string> {
    const now = new Date();
    const safeExt = ext.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 8);
    const key = [folder, now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), `${randomUUID()}.${safeExt || 'bin'}`].join('/');
    const full = this.resolve(key);
    await fsp.mkdir(path.dirname(full), { recursive: true });
    await fsp.writeFile(full, data);
    return key;
  }

  read(key: string) {
    return fsp.readFile(this.resolve(key));
  }

  stream(key: string) {
    return fs.createReadStream(this.resolve(key));
  }

  async remove(key: string) {
    await fsp.rm(this.resolve(key), { force: true });
  }
}

export const storage: StorageDriver = new LocalStorage(config.storageDir, config.storageRoots);

export function extOf(filename: string): string {
  return path.extname(filename).slice(1);
}
