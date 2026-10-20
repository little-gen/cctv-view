import { FilterX } from 'lucide-react';
import { CameraGlyph } from '@/components/cameras/CameraGlyph';
import { CAMERA_STATUS, CAMERA_STATUS_KEYS, CAMERA_TYPE_KEYS, CAMERA_TYPES } from '@/lib/cameraTypes';
import { toggleIn } from '@/store/editorStore';
import { countFilters, useSearch } from '@/store/searchStore';
import type { SearchResponse } from '@/types';

/** Filtros avanzados. Las opciones de proyecto/fabricante/NVR salen de las facetas del servidor. */
export function SearchFiltersBar({ facets }: { facets?: SearchResponse['facets'] }) {
  const { filters, setFilters, resetFilters } = useSearch();

  return (
    <div className="space-y-2 border-b border-line bg-surface-2/50 p-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <select
          className="input"
          aria-label="Proyecto"
          value={filters.projectId ?? ''}
          onChange={(e) => setFilters({ projectId: e.target.value || null, nvrId: null })}
        >
          <option value="">Todos los proyectos</option>
          {facets?.projects.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.count})</option>)}
        </select>
        <select
          className="input"
          aria-label="Fabricante"
          value=""
          onChange={(e) => e.target.value && setFilters({ brands: toggleIn(filters.brands, e.target.value) })}
        >
          <option value="">{filters.brands.length ? `Fabricante: ${filters.brands.join(', ')}` : 'Todos los fabricantes'}</option>
          {facets?.brands.map((b) => (
            <option key={b.brand} value={b.brand}>{filters.brands.includes(b.brand) ? '✓ ' : ''}{b.brand} ({b.count})</option>
          ))}
        </select>
        <select className="input" aria-label="NVR asociado" value={filters.nvrId ?? ''} onChange={(e) => setFilters({ nvrId: e.target.value || null })}>
          <option value="">Todos los NVR</option>
          {facets?.nvrs.map((n) => (
            <option key={n.id} value={n.id}>{filters.projectId ? n.name : `${n.project_name} › ${n.name}`} ({n.count})</option>
          ))}
        </select>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {CAMERA_TYPE_KEYS.map((t) => (
          <button
            key={t}
            className={`chip ${filters.types.includes(t) ? 'chip-on' : ''}`}
            aria-pressed={filters.types.includes(t)}
            onClick={() => setFilters({ types: toggleIn(filters.types, t) })}
          >
            <CameraGlyph type={t} size={14} /> {CAMERA_TYPES[t].label}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-line" />
        {CAMERA_STATUS_KEYS.map((s) => (
          <button
            key={s}
            className={`chip ${filters.statuses.includes(s) ? 'chip-on' : ''}`}
            aria-pressed={filters.statuses.includes(s)}
            onClick={() => setFilters({ statuses: toggleIn(filters.statuses, s) })}
          >
            <span className="size-2 rounded-full" style={{ background: CAMERA_STATUS[s].color }} /> {CAMERA_STATUS[s].label}
          </button>
        ))}
        {countFilters(filters) > 0 && (
          <button className="btn-ghost ml-auto px-2 py-0.5 text-xs" onClick={resetFilters}>
            <FilterX className="size-3.5" /> Quitar filtros
          </button>
        )}
      </div>
    </div>
  );
}
