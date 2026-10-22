import type { Request } from 'express';
import { pool, type Queryable } from '../../db/pool.js';

export type AuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'login'
  | 'login_failed'
  | 'logout'
  | 'password_change'
  | 'password_reset'
  | 'export';

interface AuditEntry {
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  projectId?: string | null;
  changes?: unknown;
  /** Usuario afectado cuando la petición no está autenticada (login fallido, restablecimiento) */
  actor?: { id?: string | null; email?: string | null };
}

/** Registra una entrada de auditoría. Pasar `db` para incluirla en una transacción. */
export async function audit(req: Request, entry: AuditEntry, db: Queryable = pool): Promise<void> {
  await db.query(
    `INSERT INTO audit_log (user_id, user_email, action, entity_type, entity_id, project_id, changes, ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      req.user?.id ?? entry.actor?.id ?? null,
      req.user?.email ?? entry.actor?.email ?? null,
      entry.action,
      entry.entityType,
      entry.entityId ?? null,
      entry.projectId ?? null,
      entry.changes === undefined ? null : JSON.stringify(entry.changes),
      req.ip ?? null,
    ],
  );
}

/** Diferencias campo a campo entre dos versiones de un registro. */
export function diff(before: Record<string, unknown>, after: Record<string, unknown>) {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(after)) {
    if (key === 'updated_at') continue;
    const a = before[key];
    const b = after[key];
    if (JSON.stringify(a) !== JSON.stringify(b)) changes[key] = { from: a ?? null, to: b ?? null };
  }
  return changes;
}
