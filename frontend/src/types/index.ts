export type Role = 'admin' | 'tecnico' | 'lectura';
export type CameraType = 'domo' | 'bullet' | 'ptz' | 'termica' | 'lpr';
export type CameraStatus = 'operativa' | 'averiada' | 'mantenimiento';
export type AttachmentKind = 'foto' | 'documento';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  active?: boolean;
  last_login_at?: string | null;
  /** Sesión actual: la contraseña la fijó el administrador y hay que cambiarla */
  mustChangePassword?: boolean;
  /** Listado de administración */
  must_change_password?: boolean;
  locked_until?: string | null;
  reset_pending?: boolean;
}

export interface Project {
  id: string;
  name: string;
  client: string | null;
  address: string | null;
  description: string | null;
  plan_count?: number;
  camera_count?: number;
  broken_count?: number;
  updated_at: string;
}

export interface FloorPlan {
  id: string;
  project_id: string;
  name: string;
  storage_key: string | null;
  width_px: number | null;
  height_px: number | null;
  width_m: number;
  version: number;
  camera_count?: number;
}

export interface ProjectDetail extends Project {
  plans: FloorPlan[];
}

export interface Nvr {
  id: string;
  project_id: string;
  name: string;
  brand: string | null;
  model: string | null;
  ip_address: string | null;
  channels: number | null;
  location: string | null;
  notes: string | null;
  camera_count?: number;
}

export interface Camera {
  id: string;
  project_id: string;
  floor_plan_id: string;
  nvr_id: string | null;
  nvr_name?: string | null;
  /** Canal del NVR (lo asigna el servidor si no se indica) */
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
  attachment_count?: number;
  updated_at: string;
}

export type CameraInput = Partial<Omit<Camera, 'id' | 'project_id' | 'nvr_name' | 'attachment_count' | 'updated_at'>>;

export interface Attachment {
  id: string;
  camera_id: string;
  kind: AttachmentKind;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  description: string | null;
  created_at: string;
}

export interface SearchHit {
  id: string;
  project_id: string;
  project_name: string;
  floor_plan_id: string;
  plan_name: string;
  code: string;
  name: string;
  type: CameraType;
  status: CameraStatus;
  ip_address: string | null;
  physical_location: string | null;
  brand: string | null;
  model: string | null;
  nvr_name: string | null;
  notes: string | null;
}

export interface SearchResponse {
  total: number;
  projectCount: number;
  byType: Partial<Record<CameraType, number>>;
  byStatus: Partial<Record<CameraStatus, number>>;
  shown: number;
  truncated: boolean;
  groups: { project: { id: string; name: string }; hits: number; cameras: SearchHit[] }[];
  facets: {
    projects: { id: string; name: string; count: number }[];
    brands: { brand: string; count: number }[];
    nvrs: { id: string; name: string; project_name: string; count: number }[];
  };
  tookMs: number;
}

export interface AuditEntry {
  id: number;
  occurred_at: string;
  action: 'create' | 'update' | 'delete' | 'login' | 'login_failed' | 'logout' | 'password_change' | 'password_reset' | 'export';
  entity_type: string;
  entity_id: string | null;
  user_name: string | null;
  project_name?: string | null;
  changes: Record<string, unknown> | null;
}
