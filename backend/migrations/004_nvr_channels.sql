-- =====================================================================
-- Gestión de NVR: canal de cada cámara y capacidad del grabador
--  · cameras.channel: canal del NVR que ocupa la cámara (único por NVR).
--  · La BD garantiza la capacidad (también con varios técnicos a la vez):
--    no más cámaras que canales, canal dentro de rango y NVR del mismo proyecto.
--  · NVR sin canales definidos (antiguos): "capacidad sin definir", sin límite.
-- Solo añade; no modifica ni borra datos existentes salvo numerar los canales.
-- =====================================================================

ALTER TABLE cameras
  ADD COLUMN channel integer CHECK (channel > 0),
  ADD CONSTRAINT cameras_channel_needs_nvr CHECK (channel IS NULL OR nvr_id IS NOT NULL);

-- Numeración inicial de las cámaras ya asociadas (por código), antes de activar los triggers:
-- si algún NVR antiguo tiene más cámaras que canales se conserva tal cual y la aplicación lo señala.
UPDATE cameras c SET channel = n.ch
FROM (SELECT id, row_number() OVER (PARTITION BY nvr_id ORDER BY code) AS ch FROM cameras WHERE nvr_id IS NOT NULL) n
WHERE c.id = n.id;

ALTER TABLE cameras ADD CONSTRAINT cameras_nvr_channel_key UNIQUE (nvr_id, channel);

-- Errores propios (SQLSTATE NV00x) que la API devuelve como 409 con este mismo mensaje
CREATE OR REPLACE FUNCTION cameras_nvr_channel() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  nvr       record;
  used      integer;
  changed   boolean := TG_OP = 'INSERT' OR NEW.nvr_id IS DISTINCT FROM OLD.nvr_id;
BEGIN
  IF NEW.nvr_id IS NULL THEN
    NEW.channel := NULL;  -- también al borrar el NVR (ON DELETE SET NULL)
    RETURN NEW;
  END IF;

  -- Bloquea el NVR: dos asignaciones simultáneas al mismo grabador se hacen de una en una
  SELECT id, name, project_id, channels INTO nvr FROM nvrs WHERE id = NEW.nvr_id FOR UPDATE;
  IF nvr.project_id IS DISTINCT FROM NEW.project_id THEN
    RAISE EXCEPTION 'El NVR no pertenece al proyecto de la cámara' USING ERRCODE = 'NV001';
  END IF;

  IF changed AND nvr.channels IS NOT NULL THEN
    SELECT count(*) INTO used FROM cameras WHERE nvr_id = NEW.nvr_id AND id <> NEW.id;
    IF used >= nvr.channels THEN
      RAISE EXCEPTION '% está completo: % de % canales ocupados', nvr.name, used, nvr.channels USING ERRCODE = 'NV002';
    END IF;
  END IF;

  -- Al cambiar de NVR se conserva el canal si está libre en el nuevo; si no, el primero libre
  IF NEW.channel IS NOT NULL AND (changed OR NEW.channel IS DISTINCT FROM OLD.channel) THEN
    IF nvr.channels IS NOT NULL AND NEW.channel > nvr.channels THEN
      IF TG_OP = 'UPDATE' AND changed AND NEW.channel = OLD.channel THEN
        NEW.channel := NULL;
      ELSE
        RAISE EXCEPTION 'El canal % no existe en % (tiene % canales)', NEW.channel, nvr.name, nvr.channels USING ERRCODE = 'NV003';
      END IF;
    ELSIF EXISTS (SELECT 1 FROM cameras WHERE nvr_id = NEW.nvr_id AND channel = NEW.channel AND id <> NEW.id) THEN
      IF TG_OP = 'UPDATE' AND changed AND NEW.channel = OLD.channel THEN
        NEW.channel := NULL;
      ELSE
        RAISE EXCEPTION 'El canal % de % ya está ocupado', NEW.channel, nvr.name USING ERRCODE = 'NV004';
      END IF;
    END IF;
  END IF;

  IF NEW.channel IS NULL THEN
    SELECT min(g) INTO NEW.channel
    FROM generate_series(1, coalesce(nvr.channels, (SELECT count(*) + 1 FROM cameras WHERE nvr_id = NEW.nvr_id)::int)) g
    WHERE NOT EXISTS (SELECT 1 FROM cameras WHERE nvr_id = NEW.nvr_id AND channel = g AND id <> NEW.id);
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER cameras_nvr_channel BEFORE INSERT OR UPDATE OF nvr_id, channel, project_id ON cameras
  FOR EACH ROW EXECUTE FUNCTION cameras_nvr_channel();

-- No se pueden quitar canales que estén en uso
CREATE OR REPLACE FUNCTION nvrs_channels_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  used integer;
  top  integer;
BEGIN
  IF NEW.channels IS NULL THEN
    IF OLD.channels IS NOT NULL THEN
      RAISE EXCEPTION 'El número de canales es obligatorio' USING ERRCODE = 'NV005';
    END IF;
    RETURN NEW;
  END IF;
  SELECT count(*), coalesce(max(channel), 0) INTO used, top FROM cameras WHERE nvr_id = NEW.id;
  IF used > NEW.channels THEN
    RAISE EXCEPTION '% tiene % cámaras asociadas: no puede tener menos canales', NEW.name, used USING ERRCODE = 'NV005';
  END IF;
  IF top > NEW.channels THEN
    RAISE EXCEPTION 'El canal % de % está en uso: no puede tener menos de % canales', top, NEW.name, top USING ERRCODE = 'NV005';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER nvrs_channels BEFORE UPDATE OF channels ON nvrs
  FOR EACH ROW WHEN (NEW.channels IS DISTINCT FROM OLD.channels) EXECUTE FUNCTION nvrs_channels_check();
