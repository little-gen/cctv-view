import { useAudit } from '@/api/hooks';

const ACTION = { create: 'Alta', update: 'Modificación', delete: 'Baja', login: 'Acceso', export: 'Exportación' };
const ENTITY: Record<string, string> = {
  camera: 'Cámara', floor_plan: 'Plano', project: 'Proyecto', nvr: 'NVR', attachment: 'Adjunto', user: 'Usuario',
};

export function AuditPage() {
  const { data, isLoading } = useAudit();
  return (
    <div className="mx-auto h-full max-w-6xl overflow-auto p-4 sm:p-6">
      <h1 className="mb-4 text-xl font-semibold">Historial de cambios y auditoría</h1>
      {isLoading && <p className="text-muted">Cargando…</p>}
      <div className="panel overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted">
            <tr className="border-b border-line">
              <th className="p-3">Fecha</th><th className="p-3">Usuario</th><th className="p-3">Acción</th><th className="p-3">Entidad</th><th className="p-3">Proyecto</th><th className="p-3">Detalle</th>
            </tr>
          </thead>
          <tbody>
            {data?.map((a) => (
              <tr key={a.id} className="border-b border-line align-top last:border-0">
                <td className="p-3 whitespace-nowrap text-ink-2 tabular-nums">{new Date(a.occurred_at).toLocaleString('es-ES')}</td>
                <td className="p-3">{a.user_name ?? '—'}</td>
                <td className="p-3">{ACTION[a.action]}</td>
                <td className="p-3">{ENTITY[a.entity_type] ?? a.entity_type}</td>
                <td className="p-3 text-ink-2">{a.project_name ?? '—'}</td>
                <td className="max-w-md p-3 text-xs text-muted">
                  {a.action === 'update' && a.changes ? Object.keys(a.changes).join(', ') : summarize(a.changes)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function summarize(changes: Record<string, unknown> | null) {
  if (!changes) return '';
  const c = changes as { code?: string; name?: string; original_name?: string; format?: string };
  return [c.code, c.name, c.original_name, c.format].filter(Boolean).join(' · ');
}
