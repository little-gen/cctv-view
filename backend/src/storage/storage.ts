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
  exists(key: string): Promise<boolean>;
  /**
   * Escribe un árbol de ficheros (p. ej. teselas) de forma atómica: `writer` recibe un
   * directorio local temporal y, si termina bien, su contenido pasa a `prefix`.
   */
  writeTree<T>(prefix: string, writer: (dir: string) => Promise<T>): Promise<T>;
  removeTree(prefix: string): Promise<void>;
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

  async exists(key: string) {
    try {
      await fsp.access(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }

  async writeTree<T>(prefix: string, writer: (dir: string) => Promise<T>): Promise<T> {
    const final = this.resolve(prefix);
    // Temporal junto al destino (mismo disco): el rename final es atómico y no usa RAM (/tmp es tmpfs)
    const tmp = `${final}.tmp-${randomUUID().slice(0, 8)}`;
    await fsp.mkdir(tmp, { recursive: true });
    try {
      const result = await writer(tmp);
      await fsp.rm(final, { recursive: true, force: true });
      await fsp.rename(tmp, final);
      return result;
    } catch (err) {
      await fsp.rm(tmp, { recursive: true, force: true });
      throw err;
    }
  }

  async removeTree(prefix: string) {
    await fsp.rm(this.resolve(prefix), { recursive: true, force: true });
  }
}

export const storage: StorageDriver = new LocalStorage(config.storageDir, config.storageRoots);

export function extOf(filename: string): string {
  return path.extname(filename).slice(1);
}
