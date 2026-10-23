import { z } from 'zod';
import { CAMERA_STATUSES, CAMERA_TYPES } from '../../domain.js';
import { normalizeAngle } from '../../lib/sql.js';
import { csvList, optText, uuid } from '../../lib/validation.js';

const nullable = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === '' ? null : v), schema.nullable()).optional();

const cameraFields = {
  floor_plan_id: uuid,
  nvr_id: nullable(uuid),
  // Sin canal: la BD asigna el primero libre del NVR
  channel: nullable(z.number().int().min(1).max(1024)),
  code: z.string().trim().min(1).max(50),
  name: z.string().trim().min(1).max(120),
  type: z.enum(CAMERA_TYPES),
  brand: optText(80),
  model: optText(80),
  ip_address: nullable(z.string().ip({ message: 'IP no válida' })),
  mac_address: nullable(z.string().regex(/^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/, 'MAC no válida')),
  resolution: optText(40),
  physical_location: optText(200),
  status: z.enum(CAMERA_STATUSES),
  installed_at: nullable(z.string().date('Fecha no válida (AAAA-MM-DD)')),
  notes: optText(5000),
  pos_x: z.number().min(0).max(1),
  pos_y: z.number().min(0).max(1),
  rotation_deg: z.number().finite().transform(normalizeAngle),
  fov_deg: z.number().gt(0).max(360),
  range_m: z.number().positive().max(1000),
  onvif_url: nullable(z.string().url()),
  onvif_username: optText(120),
};

export const createCameraSchema = z.object({
  ...cameraFields,
  // El código se autogenera (CAM-001...) si no se envía, p. ej. al soltar en el plano
  code: cameraFields.code.optional(),
  name: cameraFields.name.optional(),
  status: cameraFields.status.default('operativa'),
  rotation_deg: cameraFields.rotation_deg.default(0),
  fov_deg: cameraFields.fov_deg.optional(),
  range_m: cameraFields.range_m.default(20),
});

export const updateCameraSchema = z.object(cameraFields).partial();

export const listCamerasQuery = z.object({
  floorPlanId: uuid.optional(),
  status: csvList([...CAMERA_STATUSES]),
  type: csvList([...CAMERA_TYPES]),
  brand: z.string().optional(),
  q: z.string().trim().max(100).optional(),
});

/** Campo de visión por defecto según el tipo de cámara. */
export const DEFAULT_FOV: Record<(typeof CAMERA_TYPES)[number], number> = {
  domo: 100,
  bullet: 80,
  ptz: 360,
  termica: 50,
  lpr: 30,
};
