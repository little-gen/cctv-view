import type { AuditEntry } from '@/types';

/**
 * Etiquetas de las acciones de auditoría. Al ser un Record sobre el tipo, añadir una acción
 * nueva en types/index.ts sin su etiqueta no compila (evita columnas "Acción" vacías).
 */
export const AUDIT_ACTION_LABEL: Record<AuditEntry['action'], string> = {
  create: 'Alta',
  update: 'Modificación',
  delete: 'Baja',
  login: 'Acceso',
  login_failed: 'Acceso fallido',
  logout: 'Cierre de sesión',
  password_change: 'Cambio de contraseña',
  password_reset: 'Restablecimiento de acceso',
  export: 'Exportación',
};

const FAILED_REASON: Record<string, string> = {
  bad_password: 'contraseña incorrecta',
  unknown_email: 'email no registrado',
  inactive: 'usuario desactivado',
};

/** Detalle legible de una entrada de auditoría. */
export function auditDetail(a: AuditEntry): string {
  const c = (a.changes ?? {}) as Record<string, unknown>;
  switch (a.action) {
    case 'login_failed': {
      const reason = FAILED_REASON[String(c.reason)] ?? 'credenciales incorrectas';
      return c.failures ? `${reason} · ${c.failures}.º fallo seguido` : reason;
    }
    case 'password_reset':
      return c.via === 'enlace generado'
        ? `enlace generado${c.expires ? ` · caduca ${new Date(String(c.expires)).toLocaleString('es-ES')}` : ''}`
        : 'contraseña restablecida con el enlace';
    case 'update':
      if (c.unlocked) return 'cuenta desbloqueada';
      return Object.keys(c).join(', ');
    default:
      return [c.code, c.name, c.original_name, c.format].filter(Boolean).join(' · ');
  }
}
