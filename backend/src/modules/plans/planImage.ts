import path from 'node:path';
import sharp from 'sharp';
import { config } from '../../config.js';
import { pool } from '../../db/pool.js';
import type { FloorPlanRow } from '../../domain.js';
import { HttpError } from '../../middleware/error.js';
import { storage } from '../../storage/storage.js';

/**
 * Imagen de plano para visualización rápida:
 *  - Pirámide de teselas Deep Zoom (512 px, WebP): el navegador solo descarga y dibuja
 *    los trozos visibles a la resolución del zoom actual, como un visor GIS.
 *  - Vista previa de ≤2048 px: se pinta al instante y queda debajo de las teselas.
 * El original se conserva intacto (histórico y exportaciones).
 *
 * Disposición en el almacenamiento:
 *   plans/tiles/<planId>/v<version>/preview.webp
 *   plans/tiles/<planId>/v<version>/plan_files/<nivel>/<col>_<fila>.webp
 * Nivel máximo = ceil(log2(max(ancho, alto))) = resolución original.
 */
export const TILE_SIZE = 512;
const PREVIEW_MAX = 2048;
const PRINT_MAX = 5000;

// libvips trabaja fuera del event loop; sin caché para no retener memoria entre peticiones
sharp.cache(false);

export const tilesPrefix = (planId: string, version: number) => `plans/tiles/${planId}/v${version}`;

const open = (input: Buffer) => sharp(input, { limitInputPixels: config.planMaxPixels, autoOrient: true, sequentialRead: true });

function imageError(err: unknown): never {
  const msg = (err as Error).message ?? '';
  if (/pixel limit/i.test(msg)) {
    throw new HttpError(413, `La imagen supera el máximo de ${config.planMaxPixels / 1e6} megapíxeles`);
  }
  throw new HttpError(400, `No se pudo leer la imagen del plano (${msg})`);
}

/** Dimensiones ya orientadas según EXIF (como se verá en pantalla). */
export async function inspectPlanImage(input: Buffer): Promise<{ width: number; height: number }> {
  try {
    const meta = await sharp(input, { limitInputPixels: config.planMaxPixels }).metadata();
    const { width, height } = meta.autoOrient ?? meta;
    if (!width || !height) throw new Error('sin dimensiones');
    return { width, height };
  } catch (err) {
    imageError(err);
  }
}

/** Genera teselas + vista previa de una versión del plano. */
export async function buildPlanTiles(planId: string, version: number, input: Buffer) {
  try {
    return await storage.writeTree(tilesPrefix(planId, version), async (dir) => {
      const [tiles] = await Promise.all([
        open(input).webp({ quality: 82 }).tile({ size: TILE_SIZE, overlap: 0, layout: 'dz' }).toFile(path.join(dir, 'plan')),
        open(input)
          .resize(PREVIEW_MAX, PREVIEW_MAX, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 80 })
          .toFile(path.join(dir, 'preview.webp')),
      ]);
      return { width: tiles.width, height: tiles.height };
    });
  } catch (err) {
    if (err instanceof HttpError) throw err;
    imageError(err);
  }
}

// Una sola generación a la vez por plano/versión, aunque lleguen muchas teselas en paralelo
const inflight = new Map<string, Promise<void>>();

/**
 * Garantiza que existen las teselas de la versión vigente. Los planos subidos antes de
 * existir las teselas se procesan la primera vez que alguien los abre.
 */
export function ensurePlanTiles(plan: FloorPlanRow): Promise<void> {
  if (!plan.storage_key) throw new HttpError(404, 'El plano no tiene imagen');
  const prefix = tilesPrefix(plan.id, plan.version);
  let job = inflight.get(prefix);
  if (!job) {
    job = (async () => {
      if (await storage.exists(`${prefix}/preview.webp`)) return;
      const dims = await buildPlanTiles(plan.id, plan.version, await storage.read(plan.storage_key!));
      // Planos antiguos con orientación EXIF: alinear las dimensiones guardadas con las teselas
      if (dims.width !== plan.width_px || dims.height !== plan.height_px) {
        await pool.query('UPDATE floor_plans SET width_px = $2, height_px = $3 WHERE id = $1 AND version = $4', [
          plan.id,
          dims.width,
          dims.height,
          plan.version,
        ]);
      }
    })().finally(() => inflight.delete(prefix));
    inflight.set(prefix, job);
  }
  return job;
}

/** Versión reducida (≤5000 px, JPEG) para incrustar en el PDF: A3 a ~300 ppp. */
export async function planPrintImage(plan: FloorPlanRow): Promise<Buffer> {
  if (!plan.storage_key) throw new HttpError(404, 'El plano no tiene imagen');
  return open(await storage.read(plan.storage_key))
    .resize(PRINT_MAX, PRINT_MAX, { fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer();
}
