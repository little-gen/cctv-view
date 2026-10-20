-- =====================================================================
-- PlanosCamaras · Esquema inicial
-- Coordenadas de cámara normalizadas (0..1) respecto a la imagen del plano,
-- para poder sustituir el plano sin perder la configuración.
-- Orientación: 0° = hacia la derecha (este), sentido horario positivo.
-- =====================================================================

CREATE TYPE user_role       AS ENUM ('admin', 'tecnico', 'lectura');
CREATE TYPE camera_type     AS ENUM ('domo', 'bullet', 'ptz', 'termica', 'lpr');
CREATE TYPE camera_status   AS ENUM ('operativa', 'averiada', 'mantenimiento');
CREATE TYPE attachment_kind AS ENUM ('foto', 'documento');
CREATE TYPE audit_action    AS ENUM ('create', 'update', 'delete', 'login', 'export');

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------- users
CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          text NOT NULL,
  name           text NOT NULL,
  password_hash  text NOT NULL,
  role           user_role NOT NULL DEFAULT 'lectura',
  active         boolean NOT NULL DEFAULT true,
  last_login_at  timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_uq ON users (lower(email));
CREATE TRIGGER users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------- projects
-- Un proyecto = una ubicación / instalación (puede tener varias naves/planos)
CREATE TABLE projects (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  client       text,
  address      text,
  description  text,
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER projects_updated BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------- floor_plans
CREATE TABLE floor_plans (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name         text NOT NULL,
  -- Imagen vigente (desnormalizada desde floor_plan_images)
  storage_key  text,
  mime_type    text,
  width_px     integer,
  height_px    integer,
  -- Ancho real representado por la imagen, para escalar los alcances en metros
  width_m      double precision NOT NULL DEFAULT 100 CHECK (width_m > 0),
  version      integer NOT NULL DEFAULT 0,
  sort_order   integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX floor_plans_project_idx ON floor_plans (project_id, sort_order);
CREATE TRIGGER floor_plans_updated BEFORE UPDATE ON floor_plans FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Histórico de imágenes de un plano (al sustituir el plano se conserva el anterior)
CREATE TABLE floor_plan_images (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  floor_plan_id  uuid NOT NULL REFERENCES floor_plans(id) ON DELETE CASCADE,
  version        integer NOT NULL,
  storage_key    text NOT NULL,
  mime_type      text NOT NULL,
  width_px       integer NOT NULL,
  height_px      integer NOT NULL,
  original_name  text,
  uploaded_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (floor_plan_id, version)
);

-- ----------------------------------------------------------------- nvrs
CREATE TABLE nvrs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        text NOT NULL,
  brand       text,
  model       text,
  ip_address  inet,
  channels    integer CHECK (channels > 0),
  location    text,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, name)
);
CREATE TRIGGER nvrs_updated BEFORE UPDATE ON nvrs FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -------------------------------------------------------------- cameras
CREATE TABLE cameras (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id         uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  floor_plan_id      uuid NOT NULL REFERENCES floor_plans(id) ON DELETE CASCADE,
  nvr_id             uuid REFERENCES nvrs(id) ON DELETE SET NULL,
  code               text NOT NULL,
  name               text NOT NULL,
  type               camera_type NOT NULL,
  brand              text,
  model              text,
  ip_address         inet,
  mac_address        macaddr,
  resolution         text,
  physical_location  text,
  status             camera_status NOT NULL DEFAULT 'operativa',
  installed_at       date,
  notes              text,
  -- Posición y cobertura
  pos_x              double precision NOT NULL CHECK (pos_x BETWEEN 0 AND 1),
  pos_y              double precision NOT NULL CHECK (pos_y BETWEEN 0 AND 1),
  rotation_deg       double precision NOT NULL DEFAULT 0 CHECK (rotation_deg >= 0 AND rotation_deg < 360),
  fov_deg            double precision NOT NULL DEFAULT 90 CHECK (fov_deg > 0 AND fov_deg <= 360),
  range_m            double precision NOT NULL DEFAULT 20 CHECK (range_m > 0),
  -- Preparado para integración ONVIF (credenciales irán a un almacén de secretos)
  onvif_url          text,
  onvif_username     text,
  created_by         uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by         uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, code)
);
CREATE INDEX cameras_plan_idx   ON cameras (floor_plan_id);
CREATE INDEX cameras_filter_idx ON cameras (project_id, status, type);
CREATE INDEX cameras_brand_idx  ON cameras (project_id, lower(brand));
CREATE INDEX cameras_ip_idx     ON cameras (ip_address);
CREATE TRIGGER cameras_updated BEFORE UPDATE ON cameras FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------- attachments
CREATE TABLE attachments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  camera_id      uuid NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
  kind           attachment_kind NOT NULL,
  original_name  text NOT NULL,
  mime_type      text NOT NULL,
  size_bytes     bigint NOT NULL,
  storage_key    text NOT NULL,
  description    text,
  uploaded_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX attachments_camera_idx ON attachments (camera_id, kind);

-- ------------------------------------------------------------ audit_log
CREATE TABLE audit_log (
  id           bigserial PRIMARY KEY,
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  user_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  user_email   text,
  action       audit_action NOT NULL,
  entity_type  text NOT NULL,
  entity_id    uuid,
  project_id   uuid,
  -- { campo: { from, to } } en updates; snapshot completo en create/delete
  changes      jsonb,
  ip           text
);
CREATE INDEX audit_entity_idx  ON audit_log (entity_type, entity_id, occurred_at DESC);
CREATE INDEX audit_project_idx ON audit_log (project_id, occurred_at DESC);
