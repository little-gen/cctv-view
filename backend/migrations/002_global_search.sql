-- =====================================================================
-- Búsqueda global de cámaras entre todos los proyectos
--
-- cameras.search_text: texto desnormalizado (minúsculas, sin acentos) con
-- código, nombre, IP, MAC, marca, modelo, ubicación, observaciones, NVR y
-- proyecto. Se mantiene por triggers y se indexa con trigramas (pg_trgm), de
-- modo que `LIKE '%hik%'` o `LIKE '%192.168%'` usan índice incluso con
-- comodín inicial.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- unaccent() es STABLE; este envoltorio IMMUTABLE permite usarlo en índices
CREATE OR REPLACE FUNCTION f_unaccent(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;

-- Normalización común a datos y consultas: "Almacén" -> "almacen"
CREATE OR REPLACE FUNCTION search_norm(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$ SELECT lower(f_unaccent(coalesce($1, ''))) $$;

ALTER TABLE cameras ADD COLUMN search_text text NOT NULL DEFAULT '';

CREATE OR REPLACE FUNCTION cameras_search_text() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_text := search_norm(concat_ws(' | ',
    NEW.code, NEW.name, host(NEW.ip_address), NEW.mac_address::text,
    NEW.brand, NEW.model, NEW.physical_location, NEW.notes,
    (SELECT n.name FROM nvrs n WHERE n.id = NEW.nvr_id),
    (SELECT p.name FROM projects p WHERE p.id = NEW.project_id)));
  RETURN NEW;
END $$;

CREATE TRIGGER cameras_search BEFORE INSERT OR UPDATE ON cameras
  FOR EACH ROW EXECUTE FUNCTION cameras_search_text();

-- Las actualizaciones en cascada (renombrar proyecto/NVR, backfill) no deben
-- alterar updated_at de las cámaras: solo se marca en actualizaciones directas.
DROP TRIGGER cameras_updated ON cameras;

-- Backfill (antes de recrear el trigger de updated_at)
UPDATE cameras SET search_text = '';

CREATE TRIGGER cameras_updated BEFORE UPDATE ON cameras
  FOR EACH ROW WHEN (pg_trigger_depth() = 0) EXECUTE FUNCTION set_updated_at();

-- Propagar cambios de nombre de proyecto y NVR al texto de búsqueda
CREATE OR REPLACE FUNCTION projects_search_propagate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE cameras SET search_text = '' WHERE project_id = NEW.id;
  RETURN NULL;
END $$;
CREATE TRIGGER projects_search AFTER UPDATE OF name ON projects
  FOR EACH ROW WHEN (OLD.name IS DISTINCT FROM NEW.name) EXECUTE FUNCTION projects_search_propagate();

CREATE OR REPLACE FUNCTION nvrs_search_propagate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE cameras SET search_text = '' WHERE nvr_id = NEW.id;
  RETURN NULL;
END $$;
CREATE TRIGGER nvrs_search AFTER UPDATE OF name ON nvrs
  FOR EACH ROW WHEN (OLD.name IS DISTINCT FROM NEW.name) EXECUTE FUNCTION nvrs_search_propagate();

-- Índices para la búsqueda global y sus filtros (sin proyecto como prefijo)
CREATE INDEX cameras_search_trgm   ON cameras USING gin (search_text gin_trgm_ops);
CREATE INDEX cameras_status_type   ON cameras (status, type);
CREATE INDEX cameras_brand_lower   ON cameras (lower(brand));
CREATE INDEX cameras_nvr_idx       ON cameras (nvr_id) WHERE nvr_id IS NOT NULL;
