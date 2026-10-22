import type { Context } from 'konva/lib/Context';
import { memo } from 'react';
import { Shape } from 'react-konva';
import { CAMERA_TYPES } from '@/lib/cameraTypes';
import type { Camera } from '@/types';

interface Props {
  cameras: Camera[];
  selectedId: string | null;
  imgW: number;
  imgH: number;
  pxPerM: number;
  /** Vista actual (para omitir conos fuera de pantalla y fijar el grosor de línea) */
  view: { scale: number; x: number; y: number };
  viewport: { width: number; height: number };
}

/**
 * Todos los sectores de cobertura en una sola forma de Konva.
 *
 * Con zoom alto, cada cono semitransparente ocupa casi toda la pantalla: dibujarlos uno
 * a uno obliga a mezclar decenas de rellenos por píxel en cada fotograma (300 ms por
 * fotograma con 60 cámaras). Aquí se agrupan por tipo y estado en un único trazado por
 * grupo (≈10 rellenos en total) y se omiten los que no se ven.
 * 0° = derecha, sentido horario (igual que el canvas con el eje Y hacia abajo).
 */
export const CoverageCones = memo(function CoverageCones({ cameras, selectedId, imgW, imgH, pxPerM, view, viewport }: Props) {
  // Rectángulo visible en coordenadas de imagen
  const vx0 = -view.x / view.scale;
  const vy0 = -view.y / view.scale;
  const vx1 = (viewport.width - view.x) / view.scale;
  const vy1 = (viewport.height - view.y) / view.scale;

  const groups = new Map<string, { color: string; operational: boolean; cams: Camera[] }>();
  let selected: Camera | undefined;
  for (const c of cameras) {
    const cx = c.pos_x * imgW;
    const cy = c.pos_y * imgH;
    const r = c.range_m * pxPerM;
    if (cx + r < vx0 || cx - r > vx1 || cy + r < vy0 || cy - r > vy1) continue; // fuera de pantalla
    if (c.id === selectedId) {
      selected = c;
      continue;
    }
    const operational = c.status === 'operativa';
    const key = `${c.type}|${operational}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { color: CAMERA_TYPES[c.type].color, operational, cams: [] }));
    g.cams.push(c);
  }

  const sector = (ctx: Context, c: Camera) => {
    const cx = c.pos_x * imgW;
    const cy = c.pos_y * imgH;
    const r = c.range_m * pxPerM;
    if (c.fov_deg >= 360) {
      ctx.moveTo(cx + r, cy);
      ctx.arc(cx, cy, r, 0, Math.PI * 2, false);
      return;
    }
    const a0 = ((c.rotation_deg - c.fov_deg / 2) * Math.PI) / 180;
    const a1 = ((c.rotation_deg + c.fov_deg / 2) * Math.PI) / 180;
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, a0, a1, false);
    ctx.closePath();
  };

  const paint = (ctx: Context, cams: Camera[], color: string, alpha: number, dashed: boolean) => {
    ctx.beginPath();
    cams.forEach((c) => sector(ctx, c));
    ctx.setAttr('fillStyle', color);
    ctx.setAttr('strokeStyle', color);
    ctx.setAttr('globalAlpha', alpha);
    ctx.fill();
    ctx.setAttr('lineWidth', 1.5 / view.scale);
    ctx.setLineDash(dashed ? [6 / view.scale, 4 / view.scale] : []);
    ctx.stroke();
  };

  return (
    <Shape
      listening={false}
      perfectDrawEnabled={false}
      sceneFunc={(ctx) => {
        // Operativas: relleno normal; averiadas/mantenimiento: más tenue y con trazo discontinuo
        for (const g of groups.values()) paint(ctx, g.cams, g.color, g.operational ? 0.2 : 0.1, !g.operational);
        if (selected) paint(ctx, [selected], CAMERA_TYPES[selected.type].color, 0.32, selected.status !== 'operativa');
        ctx.setAttr('globalAlpha', 1);
        ctx.setLineDash([]);
      }}
    />
  );
});
