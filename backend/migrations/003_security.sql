-- =====================================================================
-- Endurecimiento de cuentas (auditoría de seguridad 2026-10-22)
--  · token_version: invalida todas las sesiones (JWT) de un usuario al cambiar
--    la contraseña, desactivarlo, restablecer su acceso o cerrar sesión.
--  · Bloqueo por cuenta con espera creciente tras intentos fallidos.
--  · Restablecimiento de acceso por el administrador (enlace de un solo uso;
--    solo se guarda el hash SHA-256 del token).
--  · must_change_password: contraseña fijada por el administrador -> el usuario
--    debe cambiarla al entrar.
-- =====================================================================

ALTER TABLE users
  ADD COLUMN token_version        integer NOT NULL DEFAULT 0,
  ADD COLUMN must_change_password boolean NOT NULL DEFAULT false,
  ADD COLUMN failed_logins        integer NOT NULL DEFAULT 0,
  ADD COLUMN locked_until         timestamptz,
  ADD COLUMN reset_token_hash     text,
  ADD COLUMN reset_expires_at     timestamptz,
  ADD COLUMN password_changed_at  timestamptz;

CREATE UNIQUE INDEX users_reset_token_uq ON users (reset_token_hash) WHERE reset_token_hash IS NOT NULL;

-- Nuevas acciones de auditoría (no se usan en esta misma transacción)
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'login_failed';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'logout';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'password_change';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'password_reset';
