import { AlertTriangle, OctagonAlert } from 'lucide-react';
import { NVR_LEVEL, type NvrUsage } from '@/lib/nvr';

/** Barra de ocupación de canales. `compact` para tablas y el árbol. */
export function OccupancyBar({ usage, compact }: { usage: NvrUsage; compact?: boolean }) {
  const level = NVR_LEVEL[usage.level];
  const pct = usage.ratio === null ? 0 : Math.min(100, Math.round(usage.ratio * 100));
  return (
    <div className={compact ? 'flex min-w-28 items-center gap-2' : ''}>
      <div
        className={`overflow-hidden rounded-full bg-surface-3 ${compact ? 'h-1.5 flex-1' : 'h-2.5'}`}
        role="meter"
        aria-label="Ocupación de canales"
        aria-valuemin={0}
        aria-valuemax={usage.total ?? 0}
        aria-valuenow={usage.used}
        aria-valuetext={usage.total ? `${usage.used} de ${usage.total} canales` : 'Capacidad sin definir'}
      >
        {usage.total && <div className="h-full rounded-full" style={{ width: `${pct}%`, background: level.color }} />}
      </div>
      {compact && (
        <span className={`w-10 shrink-0 text-right text-xs tabular-nums ${level.text}`}>{usage.total ? `${pct}%` : '—'}</span>
      )}
    </div>
  );
}

/** Aviso al 80 % y error al llenarse (o al superar la capacidad en NVR antiguos). */
export function OccupancyNotice({ usage, name }: { usage: NvrUsage; name: string }) {
  if (usage.level === 'warning') {
    return (
      <p className="flex items-start gap-2 rounded-md border border-warn/40 bg-warn/10 p-2.5 text-sm text-amber-200" role="status">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
        {name} está al {Math.round((usage.ratio ?? 0) * 100)} % de ocupación: {usage.free === 1 ? 'queda 1 canal libre' : `quedan ${usage.free} canales libres`}.
      </p>
    );
  }
  if (usage.level === 'full' || usage.level === 'over') {
    return (
      <p className="flex items-start gap-2 rounded-md border border-crit/40 bg-crit/10 p-2.5 text-sm text-red-200" role="alert">
        <OctagonAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        {usage.level === 'full'
          ? `${name} ha alcanzado el límite de ${usage.total} canales: no se pueden asociar más cámaras.`
          : `${name} tiene ${usage.used} cámaras y solo ${usage.total} canales. Mueve ${usage.used - (usage.total ?? 0)} a otro NVR o corrige el número de canales.`}
      </p>
    );
  }
  if (usage.level === 'undefined') {
    return (
      <p className="rounded-md border border-line bg-surface-2 p-2.5 text-sm text-ink-2">
        Capacidad sin definir: indica el número de canales del equipo para controlar la ocupación.
      </p>
    );
  }
  return null;
}
