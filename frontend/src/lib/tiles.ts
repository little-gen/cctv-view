import { fetchBlob } from '@/api/client';

/**
 * Visor de planos por teselas (Deep Zoom), como un mapa:
 *  - El servidor guarda una pirámide de teselas de 512 px por nivel de zoom.
 *  - Solo se descargan y dibujan las teselas visibles, al nivel que corresponde al zoom.
 *  - Se descodifican con createImageBitmap (fuera del hilo principal) y se guardan en
 *    una caché LRU acotada: la memoria no crece con el tamaño del plano.
 */
export interface TileInfo {
  version: number;
  width: number;
  height: number;
  tileSize: number;
  maxLevel: number;
}

/** Tesela en coordenadas de imagen (píxeles del original). */
export interface TileRef {
  key: string;
  url: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const PREVIEW_MAX = 2048; // igual que en el servidor

/** Nivel cuyo detalle iguala o supera el de la pantalla; null si basta con la vista previa. */
export function chooseLevel(info: TileInfo, scale: number, dpr: number): number | null {
  const level = Math.min(info.maxLevel, Math.max(0, Math.ceil(info.maxLevel + Math.log2(scale * dpr))));
  const previewScale = Math.min(1, PREVIEW_MAX / Math.max(info.width, info.height));
  return 2 ** (level - info.maxLevel) <= previewScale ? null : level;
}

/** Teselas de `level` que cortan el rectángulo visible (coordenadas de imagen), del centro hacia fuera. */
export function visibleTiles(
  planId: string,
  info: TileInfo,
  level: number,
  rect: { x0: number; y0: number; x1: number; y1: number },
): TileRef[] {
  const f = 2 ** (info.maxLevel - level); // píxeles de imagen por píxel del nivel
  const levelW = Math.ceil(info.width / f);
  const levelH = Math.ceil(info.height / f);
  const span = info.tileSize * f;
  const cols = Math.ceil(levelW / info.tileSize);
  const rows = Math.ceil(levelH / info.tileSize);
  const c0 = Math.max(0, Math.floor(rect.x0 / span));
  const c1 = Math.min(cols - 1, Math.floor(rect.x1 / span));
  const r0 = Math.max(0, Math.floor(rect.y0 / span));
  const r1 = Math.min(rows - 1, Math.floor(rect.y1 / span));
  const cx = (rect.x0 + rect.x1) / 2;
  const cy = (rect.y0 + rect.y1) / 2;

  const tiles: (TileRef & { d: number })[] = [];
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const x = c * span;
      const y = r * span;
      const w = Math.min(info.tileSize, levelW - c * info.tileSize) * f;
      const h = Math.min(info.tileSize, levelH - r * info.tileSize) * f;
      tiles.push({
        key: `${planId}/${info.version}/${level}/${c}_${r}`,
        url: `/plans/${planId}/tiles/${info.version}/${level}/${c}_${r}.webp`,
        x,
        y,
        w,
        h,
        d: (x + w / 2 - cx) ** 2 + (y + h / 2 - cy) ** 2,
      });
    }
  }
  return tiles.sort((a, b) => a.d - b.d);
}

/** Caché LRU de teselas descodificadas + cola de descarga con concurrencia limitada. */
class TileStore {
  private cache = new Map<string, ImageBitmap>();
  private loading = new Set<string>();
  private failed = new Map<string, number>();
  private queue: TileRef[] = [];
  private active = 0;
  private listeners = new Set<() => void>();
  private version = 0;
  private notifyScheduled = false;

  constructor(
    private maxTiles = 240, // ~240 × 1 MB descodificado como máximo
    private concurrency = 6,
  ) {}

  get(key: string): ImageBitmap | undefined {
    const bmp = this.cache.get(key);
    if (bmp) {
      // LRU: al usarla pasa al final
      this.cache.delete(key);
      this.cache.set(key, bmp);
    }
    return bmp;
  }

  /** Sustituye la cola pendiente por las teselas que se necesitan ahora (las obsoletas no se descargan). */
  request(tiles: TileRef[]) {
    const now = Date.now();
    this.queue = tiles.filter(
      (t) => !this.cache.has(t.key) && !this.loading.has(t.key) && (this.failed.get(t.key) ?? 0) < now,
    );
    this.pump();
  }

  private pump() {
    while (this.active < this.concurrency && this.queue.length) {
      const t = this.queue.shift()!;
      this.active++;
      this.loading.add(t.key);
      fetchBlob(t.url)
        .then((blob) => createImageBitmap(blob))
        .then((bmp) => {
          this.cache.set(t.key, bmp);
          this.evict();
          this.notify();
        })
        .catch(() => this.failed.set(t.key, Date.now() + 30_000)) // reintento a los 30 s
        .finally(() => {
          this.active--;
          this.loading.delete(t.key);
          this.pump();
        });
    }
  }

  private evict() {
    for (const [key, bmp] of this.cache) {
      if (this.cache.size <= this.maxTiles) break;
      bmp.close(); // libera la memoria de la imagen descodificada
      this.cache.delete(key);
    }
  }

  // Varias teselas que llegan juntas provocan un único repintado
  private notify() {
    if (this.notifyScheduled) return;
    this.notifyScheduled = true;
    requestAnimationFrame(() => {
      this.notifyScheduled = false;
      this.version++;
      this.listeners.forEach((l) => l());
    });
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = () => this.version;
}

export const tileStore = new TileStore();
