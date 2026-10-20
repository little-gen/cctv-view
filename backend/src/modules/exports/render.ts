import type { CameraRow, CameraType, CameraStatus } from '../../domain.js';

// Mismos colores que el frontend (frontend/src/lib/cameraTypes.ts)
export const TYPE_COLORS: Record<CameraType, string> = {
  domo: '#3987e5',
  bullet: '#d95926',
  ptz: '#199e70',
  termica: '#c98500',
  lpr: '#d55181',
};
export const STATUS_COLORS: Record<CameraStatus, string> = {
  operativa: '#0ca30c',
  averiada: '#d03b3b',
  mantenimiento: '#fab219',
};

/** Trayecto SVG del sector de cobertura (0° = derecha, sentido horario). */
export function sectorPath(cx: number, cy: number, r: number, rotationDeg: number, fovDeg: number): string {
  if (fovDeg >= 360) {
    return `M ${cx - r} ${cy} A ${r} ${r} 0 1 1 ${cx + r} ${cy} A ${r} ${r} 0 1 1 ${cx - r} ${cy} Z`;
  }
  const a0 = ((rotationDeg - fovDeg / 2) * Math.PI) / 180;
  const a1 = ((rotationDeg + fovDeg / 2) * Math.PI) / 180;
  const x0 = cx + r * Math.cos(a0);
  const y0 = cy + r * Math.sin(a0);
  const x1 = cx + r * Math.cos(a1);
  const y1 = cy + r * Math.sin(a1);
  const large = fovDeg > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} Z`;
}

/**
 * Dibuja cámaras y conos sobre un plano ya colocado en (ox, oy) con escala `scale`
 * (px de documento por px de imagen).
 */
export function drawCameras(
  doc: PDFKit.PDFDocument,
  cameras: CameraRow[],
  plan: { width_px: number; height_px: number; width_m: number },
  ox: number,
  oy: number,
  scale: number,
) {
  const pxPerM = plan.width_px / plan.width_m;
  // Los conos se recortan al área del plano
  doc.save();
  doc.rect(ox, oy, plan.width_px * scale, plan.height_px * scale).clip();
  for (const c of cameras) {
    const cx = ox + c.pos_x * plan.width_px * scale;
    const cy = oy + c.pos_y * plan.height_px * scale;
    const r = c.range_m * pxPerM * scale;
    doc.path(sectorPath(cx, cy, r, c.rotation_deg, c.fov_deg)).fillOpacity(0.18).fill(TYPE_COLORS[c.type]);
  }
  doc.restore();
  for (const c of cameras) {
    const cx = ox + c.pos_x * plan.width_px * scale;
    const cy = oy + c.pos_y * plan.height_px * scale;
    doc.save();
    markerShape(doc, c.type, cx, cy, 5).lineWidth(1.5).fillColor(TYPE_COLORS[c.type]).strokeColor(STATUS_COLORS[c.status]).fillAndStroke();
    doc.fillColor('#111111').fontSize(6).text(c.code, cx + 7, cy - 3, { lineBreak: false });
    doc.restore();
  }
}

/** Misma forma por tipo que en la aplicación (el tipo no depende solo del color). */
export function markerShape(doc: PDFKit.PDFDocument, type: CameraType, cx: number, cy: number, r: number) {
  const poly = (sides: number, rot: number) =>
    doc.polygon(
      ...Array.from({ length: sides }, (_, i): [number, number] => {
        const a = rot + (i * 2 * Math.PI) / sides;
        return [cx + r * 1.15 * Math.cos(a), cy + r * 1.15 * Math.sin(a)];
      }),
    );
  switch (type) {
    case 'domo':
      return doc.circle(cx, cy, r);
    case 'bullet':
      return doc.roundedRect(cx - r * 1.3, cy - r * 0.8, r * 2.6, r * 1.6, r * 0.8);
    case 'ptz':
      return poly(6, -Math.PI / 2);
    case 'termica':
      return poly(4, -Math.PI / 2);
    case 'lpr':
      return doc.rect(cx - r, cy - r, r * 2, r * 2);
  }
}
