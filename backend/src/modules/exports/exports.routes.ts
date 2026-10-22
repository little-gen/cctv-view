import ExcelJS from 'exceljs';
import { Router, type Response } from 'express';
import PDFDocument from 'pdfkit';
import { pool } from '../../db/pool.js';
import { CAMERA_STATUS_LABELS, CAMERA_TYPE_LABELS, CAMERA_TYPES, type CameraRow } from '../../domain.js';
import { notFound } from '../../middleware/error.js';
import { idParam } from '../../lib/validation.js';
import { planPrintImage } from '../plans/planImage.js';
import { audit } from '../audit/audit.service.js';
import { listCameras } from '../cameras/cameras.repository.js';
import { getPlan } from '../plans/plans.routes.js';
import { drawCameras, markerShape, STATUS_COLORS, TYPE_COLORS } from './render.js';

export const exportsRouter = Router();

const today = () => new Date().toLocaleDateString('es-ES');
const slug = (s: string) => s.normalize('NFD').replace(/[^\w]+/g, '_').replace(/^_|_$/g, '').toLowerCase();

async function getProject(id: string) {
  const { rows } = await pool.query<{ id: string; name: string; client: string | null; address: string | null }>(
    'SELECT id, name, client, address FROM projects WHERE id = $1',
    [id],
  );
  if (!rows[0]) throw notFound('Proyecto');
  return rows[0];
}

function sendFile(res: Response, mime: string, filename: string) {
  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
}

// ------------------------------------------------------------------ Plano PDF
exportsRouter.get('/plans/:id/export/pdf', async (req, res) => {
  const { id } = idParam.parse(req.params);
  const plan = await getPlan(id);
  if (!plan.storage_key || !plan.width_px || !plan.height_px) throw notFound('Imagen del plano');
  const project = await getProject(plan.project_id);
  const cameras = await listCameras(plan.project_id, { floorPlanId: id });
  // Versión reducida (≤5000 px, JPEG): no se descodifica el original en el event loop
  const image = await planPrintImage(plan);

  const doc = new PDFDocument({ size: 'A3', layout: 'landscape', margin: 30, info: { Title: `${project.name} - ${plan.name}` } });
  sendFile(res, 'application/pdf', `plano_${slug(project.name)}_${slug(plan.name)}.pdf`);
  doc.pipe(res);

  const margin = 30;
  const footerH = 70;
  const areaW = doc.page.width - margin * 2;
  const areaH = doc.page.height - margin * 2 - footerH;
  const scale = Math.min(areaW / plan.width_px, areaH / plan.height_px);
  const ox = margin + (areaW - plan.width_px * scale) / 2;
  const oy = margin;

  doc.image(image, ox, oy, { width: plan.width_px * scale, height: plan.height_px * scale });
  drawCameras(doc, cameras, { width_px: plan.width_px, height_px: plan.height_px, width_m: plan.width_m }, ox, oy, scale);

  // Cajetín
  const fy = doc.page.height - margin - footerH + 10;
  doc.moveTo(margin, fy - 5).lineTo(doc.page.width - margin, fy - 5).strokeColor('#999999').lineWidth(0.5).stroke();
  doc.fillColor('#111111').fontSize(14).text(`${project.name} · ${plan.name}`, margin, fy);
  doc.fontSize(9).fillColor('#444444')
    .text(`${project.client ?? ''}  ${project.address ?? ''}`, margin, fy + 18)
    .text(`Cámaras: ${cameras.length} · Ancho del plano: ${plan.width_m} m · Versión ${plan.version} · ${today()}`, margin, fy + 31);

  // Leyenda de tipos y estados
  let lx = doc.page.width - margin - 520;
  for (const t of CAMERA_TYPES) {
    markerShape(doc, t, lx + 5, fy + 6, 5).fill(TYPE_COLORS[t]);
    doc.fillColor('#111111').fontSize(9).text(CAMERA_TYPE_LABELS[t], lx + 14, fy + 2, { lineBreak: false });
    lx += 70;
  }
  lx = doc.page.width - margin - 520;
  for (const [s, label] of Object.entries(CAMERA_STATUS_LABELS)) {
    doc.circle(lx + 5, fy + 26, 4).lineWidth(2).stroke(STATUS_COLORS[s as keyof typeof STATUS_COLORS]);
    doc.fillColor('#111111').fontSize(9).text(`Borde: ${label}`, lx + 14, fy + 22, { lineBreak: false });
    lx += 130;
  }

  doc.end();
  await audit(req, { action: 'export', entityType: 'floor_plan', entityId: id, projectId: plan.project_id, changes: { format: 'pdf' } });
});

// ---------------------------------------------------------- Informe técnico PDF
exportsRouter.get('/projects/:id/export/report.pdf', async (req, res) => {
  const { id } = idParam.parse(req.params);
  const project = await getProject(id);
  const cameras = await listCameras(id);
  const plans = await pool.query<{ id: string; name: string }>('SELECT id, name FROM floor_plans WHERE project_id = $1', [id]);
  const planName = new Map(plans.rows.map((p) => [p.id, p.name]));

  const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true, info: { Title: `Informe técnico - ${project.name}` } });
  sendFile(res, 'application/pdf', `informe_${slug(project.name)}.pdf`);
  doc.pipe(res);

  // Portada / resumen
  doc.fontSize(20).fillColor('#111111').text('Informe técnico de videovigilancia');
  doc.moveDown(0.3).fontSize(13).fillColor('#444444').text(project.name);
  if (project.client) doc.fontSize(10).text(`Cliente: ${project.client}`);
  if (project.address) doc.fontSize(10).text(`Dirección: ${project.address}`);
  doc.fontSize(10).text(`Fecha: ${today()}`);
  doc.moveDown();

  const count = (pred: (c: CameraRow) => boolean) => cameras.filter(pred).length;
  doc.fontSize(12).fillColor('#111111').text('Resumen');
  doc.fontSize(10).fillColor('#333333')
    .text(`Total de cámaras: ${cameras.length}`)
    .text(`Operativas: ${count((c) => c.status === 'operativa')} · Averiadas: ${count((c) => c.status === 'averiada')} · En mantenimiento: ${count((c) => c.status === 'mantenimiento')}`)
    .text(`Por tipo: ${CAMERA_TYPES.map((t) => `${CAMERA_TYPE_LABELS[t]} ${count((c) => c.type === t)}`).join(' · ')}`);
  doc.moveDown();

  // Tabla
  const cols: { label: string; width: number; value: (c: CameraRow) => string }[] = [
    { label: 'Código', width: 55, value: (c) => c.code },
    { label: 'Nombre', width: 95, value: (c) => c.name },
    { label: 'Tipo', width: 45, value: (c) => CAMERA_TYPE_LABELS[c.type] },
    { label: 'Marca / modelo', width: 90, value: (c) => [c.brand, c.model].filter(Boolean).join(' ') },
    { label: 'IP', width: 70, value: (c) => c.ip_address ?? '' },
    { label: 'Plano', width: 60, value: (c) => planName.get(c.floor_plan_id) ?? '' },
    { label: 'Estado', width: 60, value: (c) => CAMERA_STATUS_LABELS[c.status] },
  ];
  const left = doc.page.margins.left;
  const drawHeader = () => {
    let x = left;
    const y = doc.y;
    doc.rect(left, y - 2, cols.reduce((s, c) => s + c.width, 0), 16).fill('#e9ecef');
    doc.fillColor('#111111').fontSize(8);
    for (const col of cols) {
      doc.text(col.label, x + 2, y + 2, { width: col.width - 4, lineBreak: false });
      x += col.width;
    }
    doc.y = y + 18;
  };
  drawHeader();
  for (const cam of cameras) {
    if (doc.y > doc.page.height - doc.page.margins.bottom - 30) {
      doc.addPage();
      drawHeader();
    }
    const y = doc.y;
    let x = left;
    doc.fontSize(8).fillColor('#222222');
    for (const col of cols) {
      doc.text(col.value(cam), x + 2, y, { width: col.width - 4, height: 22, ellipsis: true });
      x += col.width;
    }
    doc.y = y + 16;
    doc.moveTo(left, doc.y - 3).lineTo(left + 475, doc.y - 3).strokeColor('#dddddd').lineWidth(0.5).stroke();
  }

  // Fichas detalladas
  for (const cam of cameras) {
    doc.addPage();
    doc.fontSize(14).fillColor('#111111').text(`${cam.code} · ${cam.name}`);
    doc.moveDown(0.5).fontSize(10).fillColor('#333333');
    const rows: [string, string | null | number][] = [
      ['Tipo', CAMERA_TYPE_LABELS[cam.type]],
      ['Marca', cam.brand],
      ['Modelo', cam.model],
      ['Dirección IP', cam.ip_address],
      ['MAC', cam.mac_address],
      ['Resolución', cam.resolution],
      ['Ubicación física', cam.physical_location],
      ['Plano', planName.get(cam.floor_plan_id) ?? ''],
      ['NVR', cam.nvr_name ?? null],
      ['Estado', CAMERA_STATUS_LABELS[cam.status]],
      ['Fecha de instalación', cam.installed_at],
      ['Orientación / ángulo / alcance', `${Math.round(cam.rotation_deg)}° / ${cam.fov_deg}° / ${cam.range_m} m`],
      ['Observaciones', cam.notes],
    ];
    for (const [k, v] of rows) {
      doc.font('Helvetica-Bold').text(`${k}: `, { continued: true }).font('Helvetica').text(v === null || v === '' ? '—' : String(v));
    }
  }

  // Numeración de páginas
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.fontSize(8).fillColor('#888888').text(`${project.name} · Página ${i + 1} de ${range.count}`, 40, doc.page.height - 30, {
      align: 'center',
      width: doc.page.width - 80,
      lineBreak: false,
    });
  }
  doc.end();
  await audit(req, { action: 'export', entityType: 'project', entityId: id, projectId: id, changes: { format: 'report-pdf' } });
});

// ---------------------------------------------------------- Inventario Excel
exportsRouter.get('/projects/:id/export/inventory.xlsx', async (req, res) => {
  const { id } = idParam.parse(req.params);
  const project = await getProject(id);
  const cameras = await listCameras(id);
  const plans = await pool.query<{ id: string; name: string }>('SELECT id, name FROM floor_plans WHERE project_id = $1', [id]);
  const planName = new Map(plans.rows.map((p) => [p.id, p.name]));

  const wb = new ExcelJS.Workbook();
  wb.creator = 'PlanosCamaras';
  wb.created = new Date();
  const ws = wb.addWorksheet('Inventario', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: 'Código', key: 'code', width: 12 },
    { header: 'Nombre', key: 'name', width: 28 },
    { header: 'Tipo', key: 'type', width: 10 },
    { header: 'Marca', key: 'brand', width: 14 },
    { header: 'Modelo', key: 'model', width: 18 },
    { header: 'IP', key: 'ip', width: 16 },
    { header: 'MAC', key: 'mac', width: 18 },
    { header: 'Resolución', key: 'resolution', width: 12 },
    { header: 'Ubicación física', key: 'location', width: 26 },
    { header: 'Plano', key: 'plan', width: 18 },
    { header: 'NVR', key: 'nvr', width: 14 },
    { header: 'Estado', key: 'status', width: 16 },
    { header: 'Fecha instalación', key: 'installed', width: 14 },
    { header: 'Orientación (°)', key: 'rotation', width: 12 },
    { header: 'Ángulo (°)', key: 'fov', width: 10 },
    { header: 'Alcance (m)', key: 'range', width: 10 },
    { header: 'Observaciones', key: 'notes', width: 40 },
  ];
  for (const c of cameras) {
    ws.addRow({
      code: c.code,
      name: c.name,
      type: CAMERA_TYPE_LABELS[c.type],
      brand: c.brand,
      model: c.model,
      ip: c.ip_address,
      mac: c.mac_address,
      resolution: c.resolution,
      location: c.physical_location,
      plan: planName.get(c.floor_plan_id),
      nvr: c.nvr_name,
      status: CAMERA_STATUS_LABELS[c.status],
      installed: c.installed_at ? new Date(c.installed_at) : null,
      rotation: Math.round(c.rotation_deg),
      fov: c.fov_deg,
      range: c.range_m,
      notes: c.notes,
    });
  }
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
  ws.autoFilter = { from: 'A1', to: { row: 1, column: ws.columns.length } };
  ws.getColumn('installed').numFmt = 'dd/mm/yyyy';

  const summary = wb.addWorksheet('Resumen');
  summary.addRows([
    ['Proyecto', project.name],
    ['Fecha', today()],
    ['Total cámaras', cameras.length],
    [],
    ['Estado', 'Cámaras'],
    ...Object.entries(CAMERA_STATUS_LABELS).map(([s, l]) => [l, cameras.filter((c) => c.status === s).length]),
    [],
    ['Tipo', 'Cámaras'],
    ...CAMERA_TYPES.map((t) => [CAMERA_TYPE_LABELS[t], cameras.filter((c) => c.type === t).length]),
  ]);
  summary.getColumn(1).width = 22;

  sendFile(res, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', `inventario_${slug(project.name)}.xlsx`);
  await wb.xlsx.write(res);
  res.end();
  await audit(req, { action: 'export', entityType: 'project', entityId: id, projectId: id, changes: { format: 'xlsx' } });
});
