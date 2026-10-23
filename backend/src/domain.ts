// Enumeraciones del dominio (deben coincidir con los ENUM de PostgreSQL)
export const ROLES = ['admin', 'tecnico', 'lectura'] as const;
export const CAMERA_TYPES = ['domo', 'bullet', 'ptz', 'termica', 'lpr'] as const;
export const CAMERA_STATUSES = ['operativa', 'averiada', 'mantenimiento'] as const;
export const ATTACHMENT_KINDS = ['foto', 'documento'] as const;

export type Role = (typeof ROLES)[number];
export type CameraType = (typeof CAMERA_TYPES)[number];
export type CameraStatus = (typeof CAMERA_STATUSES)[number];

export const CAMERA_TYPE_LABELS: Record<CameraType, string> = {
  domo: 'Domo',
  bullet: 'Bullet',
  ptz: 'PTZ',
  termica: 'Térmica',
  lpr: 'LPR',
};

export const CAMERA_STATUS_LABELS: Record<CameraStatus, string> = {
  operativa: 'Operativa',
  averiada: 'Averiada',
  mantenimiento: 'En mantenimiento',
};

/** Roles que pueden modificar datos (cámaras, NVR, planos, adjuntos). */
export const EDITOR_ROLES: Role[] = ['admin', 'tecnico'];

export interface CameraRow {
  id: string;
  project_id: string;
  floor_plan_id: string;
  nvr_id: string | null;
  nvr_name?: string | null;
  channel: number | null;
  code: string;
  name: string;
  type: CameraType;
  brand: string | null;
  model: string | null;
  ip_address: string | null;
  mac_address: string | null;
  resolution: string | null;
  physical_location: string | null;
  status: CameraStatus;
  installed_at: string | null;
  notes: string | null;
  pos_x: number;
  pos_y: number;
  rotation_deg: number;
  fov_deg: number;
  range_m: number;
  onvif_url: string | null;
  onvif_username: string | null;
  created_at: string;
  updated_at: string;
}

export interface FloorPlanRow {
  id: string;
  project_id: string;
  name: string;
  storage_key: string | null;
  mime_type: string | null;
  width_px: number | null;
  height_px: number | null;
  width_m: number;
  version: number;
  sort_order: number;
}
