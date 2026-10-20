import { AlertTriangle, CheckCircle2, Wrench } from 'lucide-react';
import { CameraGlyph } from '@/components/cameras/CameraGlyph';
import { CAMERA_STATUS, CAMERA_TYPE_KEYS, CAMERA_TYPES } from '@/lib/cameraTypes';
import type { Camera } from '@/types';

/** Resumen del plano actual: tiles de estado + cámaras por tipo + cobertura. */
export function StatsPanel({ cameras, coverageRatio }: { cameras: Camera[]; coverageRatio: number | null }) {
  const by = (pred: (c: Camera) => boolean) => cameras.filter(pred).length;
  const maxType = Math.max(1, ...CAMERA_TYPE_KEYS.map((t) => by((c) => c.type === t)));
  const statusTiles = [
    { key: 'operativa' as const, icon: CheckCircle2 },
    { key: 'averiada' as const, icon: AlertTriangle },
    { key: 'mantenimiento' as const, icon: Wrench },
  ];

  return (
    <section className="space-y-3" aria-label="Estadísticas">
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-md bg-surface-2 p-2.5">
          <div className="text-xs text-muted">Total cámaras</div>
          <div className="text-2xl font-semibold">{cameras.length}</div>
        </div>
        <div className="rounded-md bg-surface-2 p-2.5">
          <div className="text-xs text-muted">Cobertura del plano</div>
          <div className="text-2xl font-semibold">{coverageRatio === null ? '—' : `${Math.round(coverageRatio * 100)}%`}</div>
        </div>
        {statusTiles.map(({ key, icon: Icon }) => (
          <div key={key} className="rounded-md bg-surface-2 p-2.5">
            <div className="flex items-center gap-1 text-xs text-muted">
              <Icon className="size-3.5" style={{ color: CAMERA_STATUS[key].color }} aria-hidden />
              {CAMERA_STATUS[key].label}
            </div>
            <div className="text-lg font-semibold">{by((c) => c.status === key)}</div>
          </div>
        ))}
      </div>

      <div>
        <div className="mb-1.5 text-xs font-medium text-muted">Cámaras por tipo</div>
        <ul className="space-y-1">
          {CAMERA_TYPE_KEYS.map((t) => {
            const n = by((c) => c.type === t);
            return (
              <li key={t} className="flex items-center gap-2 text-xs" title={`${CAMERA_TYPES[t].label}: ${n}`}>
                <CameraGlyph type={t} size={16} />
                <span className="w-14 text-ink-2">{CAMERA_TYPES[t].label}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-r bg-surface-3">
                  <div className="h-full rounded-r" style={{ width: `${(n / maxType) * 100}%`, background: CAMERA_TYPES[t].color }} />
                </div>
                <span className="w-6 text-right text-ink tabular-nums">{n}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
