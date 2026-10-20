import { CameraGlyph } from '@/components/cameras/CameraGlyph';
import { CAMERA_STATUS, CAMERA_STATUS_KEYS, CAMERA_TYPE_KEYS, CAMERA_TYPES } from '@/lib/cameraTypes';
import type { SearchResponse } from '@/types';

/** Resumen de la búsqueda: coincidencias, proyectos afectados y desglose por tipo y estado. */
export function SearchStats({ data }: { data: SearchResponse }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-line px-3 py-2 text-xs" aria-live="polite">
      <span>
        <strong className="text-sm text-ink tabular-nums">{data.total.toLocaleString('es-ES')}</strong>{' '}
        <span className="text-ink-2">{data.total === 1 ? 'coincidencia' : 'coincidencias'}</span>
      </span>
      <span>
        <strong className="text-sm text-ink tabular-nums">{data.projectCount}</strong>{' '}
        <span className="text-ink-2">{data.projectCount === 1 ? 'proyecto' : 'proyectos'}</span>
      </span>
      <span className="flex flex-wrap items-center gap-2" aria-label="Cámaras por tipo">
        {CAMERA_TYPE_KEYS.filter((t) => data.byType[t]).map((t) => (
          <span key={t} className="inline-flex items-center gap-1 text-ink-2" title={CAMERA_TYPES[t].label}>
            <CameraGlyph type={t} size={14} />
            <span className="tabular-nums">{data.byType[t]}</span>
          </span>
        ))}
      </span>
      <span className="flex items-center gap-2" aria-label="Cámaras por estado">
        {CAMERA_STATUS_KEYS.filter((s) => s !== 'operativa' && data.byStatus[s]).map((s) => (
          <span key={s} className="inline-flex items-center gap-1 text-ink-2">
            <span className="size-2 rounded-full" style={{ background: CAMERA_STATUS[s].color }} aria-hidden />
            {data.byStatus[s]} {CAMERA_STATUS[s].label.toLowerCase()}
          </span>
        ))}
      </span>
      <span className="ml-auto text-muted tabular-nums">{data.tookMs} ms</span>
    </div>
  );
}
