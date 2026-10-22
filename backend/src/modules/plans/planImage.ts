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
 * Nivel máximo = ceil(log2(max(ancho, alto))).
 *
 * Resolución: se acepta cualquier imagen de hasta PLAN_MAX_INPUT_MEGAPIXELS. Si supera
 * PLAN_MAX_MEGAPIXELS (400 Mpx ≈ 20.000 × 20.000 px, más detalle del que se puede ver),
 * las teselas se generan a partir de una versión reducida; el original no se toca.
 */
export const TILE_SIZE = 512;
const PREVIEW_MAX = 2048;
const PRINT_MAX = 5000;

// libvips trabaja fuera del event loop; sin caché para no retener memoria entre peticiones
sharp.cache(false);

export const tilesPrefix = (planId: string, version: number) => `plans/tiles/${planId}/v${version}`;

// sequentialRead: libvips procesa la imagen por franjas, sin descomprimirla entera en memoria
const open = (input: Buffer) =>
  sharp(input, { limitInputPixels: config.planMaxInputPixels, autoOrient: true, sequentialRead: true });

// Un plano grande usa ~1 GB de memoria mientras se procesa: uno cada vez por proceso
let queue: Promise<unknown> = Promise.resolve();
function exclusive<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job);
  queue = run.catch(() => undefined);
  return run;
}

/** Dimensiones de visualización: el original o, si supera el máximo, reducido manteniendo la proporción. */
export function displaySize(width: number, height: number) {
  const s = Math.min(1, Math.sqrt(config.planMaxPixels / (width * height)));
  return { width: Math.floor(width * s), height: Math.floor(height * s), downscaled: s < 1 };
}

function imageError(err: unknown): never {
  const msg = (err as Error).message ?? '';
  if (/pixel limit/i.test(msg)) {
    throw new HttpError(413, `La imagen supera el máximo de ${config.planMaxInputPixels / 1e6} megapíxeles`);
  }
  throw new HttpError(400, `No se pudo leer la imagen del plano (${msg})`);
}

/** Dimensiones ya orientadas según EXIF (como se verá en pantalla). */
const FORMAT_MIME: Record<string, string> = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', tiff: 'image/tiff' };

export async function inspectPlanImage(input: Buffer): Promise<{ width: number; height: number; mime: string }> {
  try {
    const meta = await sharp(input, { limitInputPixels: config.planMaxInputPixels }).metadata();
    const { width, height } = meta.autoOrient ?? meta;
    if (!width || !height) throw new Error('sin dimensiones');
    // Tipo real del contenido (no el que declara el navegador)
    const mime = FORMAT_MIME[meta.format ?? ''];
    if (!mime) throw new HttpError(415, `Formato de plano no admitido: ${meta.format}`);
    return { width, height, mime };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    imageError(err);
  }
}

/**
 * Genera teselas + vista previa de una versión del plano. Devuelve las dimensiones de
 * visualización (las que se guardan en floor_plans) y si hubo que reducir la imagen.
 * Teselas y vista previa se generan en serie: la mitad de memoria que en paralelo.
 */
export async function buildPlanTiles(planId: string, version: number, input: Buffer) {
  try {
    const original = await inspectPlanImage(input);
    const target = displaySize(original.width, original.height);
    return await exclusive(() =>
      storage.writeTree(tilesPrefix(planId, version), async (dir) => {
        const source = target.downscaled ? open(input).resize(target.width, target.height) : open(input);
        const tiles = await source.webp({ quality: 82 }).tile({ size: TILE_SIZE, overlap: 0, layout: 'dz' }).toFile(path.join(dir, 'plan'));
        await open(input)
          .resize(PREVIEW_MAX, PREVIEW_MAX, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 80 })
          .toFile(path.join(dir, 'preview.webp'));
        return { width: tiles.width, height: tiles.height, original, downscaled: target.downscaled };
      }),
    );
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
  const input = await storage.read(plan.storage_key);
  return exclusive(() =>
    open(input)
      .resize(PRINT_MAX, PRINT_MAX, { fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer(),
  );
}
