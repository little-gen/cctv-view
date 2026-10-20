import type { Camera } from '@/types';

export interface CoverageGrid {
  cols: number;
  rows: number;
  /** Nº de cámaras que ven cada celda */
  counts: Uint8Array;
  /** Tamaño de la celda en píxeles de imagen */
  cellPx: number;
  coveredRatio: number;
}

interface PlanGeom {
  widthPx: number;
  heightPx: number;
  widthM: number;
}

/**
 * Rejilla de cobertura muestreando el centro de cada celda.
 * Modelo 2D sin obstáculos: la celda está cubierta si está dentro del alcance
 * y del sector angular de la cámara. (Futuro: muros/obstáculos con raycasting
 * y polígono de "zona a vigilar" para excluir el exterior de la nave.)
 */
export function computeCoverage(cameras: Camera[], plan: PlanGeom, cellM = 1): CoverageGrid {
  const pxPerM = plan.widthPx / plan.widthM;
  // Limitamos la resolución para mantener el cálculo por debajo de ~250k celdas
  const cellPx = Math.max(cellM * pxPerM, Math.sqrt((plan.widthPx * plan.heightPx) / 250_000));
  const cols = Math.ceil(plan.widthPx / cellPx);
  const rows = Math.ceil(plan.heightPx / cellPx);
  const counts = new Uint8Array(cols * rows);

  for (const cam of cameras) {
    const cx = cam.pos_x * plan.widthPx;
    const cy = cam.pos_y * plan.heightPx;
    const r = cam.range_m * pxPerM;
    const r2 = r * r;
    const halfFov = cam.fov_deg / 2;
    const full = cam.fov_deg >= 360;

    const c0 = Math.max(0, Math.floor((cx - r) / cellPx));
    const c1 = Math.min(cols - 1, Math.floor((cx + r) / cellPx));
    const r0 = Math.max(0, Math.floor((cy - r) / cellPx));
    const r1 = Math.min(rows - 1, Math.floor((cy + r) / cellPx));

    for (let row = r0; row <= r1; row++) {
      const py = (row + 0.5) * cellPx - cy;
      for (let col = c0; col <= c1; col++) {
        const px = (col + 0.5) * cellPx - cx;
        if (px * px + py * py > r2) continue;
        if (!full) {
          const angle = (Math.atan2(py, px) * 180) / Math.PI;
          const delta = Math.abs(((angle - cam.rotation_deg + 540) % 360) - 180);
          if (delta > halfFov) continue;
        }
        const i = row * cols + col;
        if (counts[i] < 255) counts[i]++;
      }
    }
  }

  let covered = 0;
  for (const v of counts) if (v > 0) covered++;
  return { cols, rows, counts, cellPx, coveredRatio: counts.length ? covered / counts.length : 0 };
}

// Rampa secuencial azul (1 tono, de oscuro a claro sobre fondo oscuro)
const HEAT_RAMP: [number, number, number][] = [
  [0x18, 0x4f, 0x95],
  [0x2a, 0x78, 0xd6],
  [0x55, 0x98, 0xe7],
  [0x9e, 0xc5, 0xf4],
];
const GAP_COLOR: [number, number, number] = [0xd0, 0x3b, 0x3b];

/** Pinta la rejilla en un canvas de cols×rows (1 px por celda) que se escala en Konva. */
export function renderCoverage(grid: CoverageGrid, mode: 'heatmap' | 'gaps'): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = grid.cols;
  canvas.height = grid.rows;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(grid.cols, grid.rows);
  for (let i = 0; i < grid.counts.length; i++) {
    const n = grid.counts[i];
    const o = i * 4;
    if (mode === 'gaps') {
      if (n === 0) {
        [img.data[o], img.data[o + 1], img.data[o + 2]] = GAP_COLOR;
        img.data[o + 3] = 110;
      }
    } else if (n > 0) {
      [img.data[o], img.data[o + 1], img.data[o + 2]] = HEAT_RAMP[Math.min(n, HEAT_RAMP.length) - 1];
      img.data[o + 3] = 120;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

export const HEATMAP_LEGEND = HEAT_RAMP.map(([r, g, b], i) => ({
  label: i === HEAT_RAMP.length - 1 ? `${i + 1}+` : String(i + 1),
  color: `rgb(${r} ${g} ${b})`,
}));
