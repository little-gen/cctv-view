import { FilterX, Paperclip, Search, X } from 'lucide-react';
import { TopologyTree, type TopologyData } from '@/components/nvr/TopologyTree';
import { StatsPanel } from '@/components/stats/StatsPanel';
import { CAMERA_STATUS, CAMERA_STATUS_KEYS, CAMERA_TYPE_KEYS, CAMERA_TYPES } from '@/lib/cameraTypes';
import { hasActiveFilters, uniqueBrands } from '@/lib/filters';
import { toggleIn, useEditor } from '@/store/editorStore';
import type { Camera } from '@/types';
import { CameraGlyph } from './CameraGlyph';

interface Props {
  allCameras: Camera[];
  visibleCameras: Camera[];
  coverageRatio: number | null;
  topology: TopologyData;
}

export function CameraSidebar({ allCameras, visibleCameras, coverageRatio, topology }: Props) {
  const { filters, setFilters, resetFilters, selectedId, focusCamera, toggle, sidebarTab, setSidebarTab } = useEditor();
  const brands = uniqueBrands(allCameras);

  return (
    <aside className="flex h-full w-full flex-col border-r border-line bg-surface lg:w-80">
      <div className="flex items-center justify-between border-b border-line px-3 py-2 lg:hidden">
        <span className="font-medium">{sidebarTab === 'camaras' ? 'Cámaras' : 'Topología'}</span>
        <button className="btn-ghost px-1.5" onClick={() => toggle('sidebarOpen')} aria-label="Cerrar panel">
          <X className="size-4" />
        </button>
      </div>

      <div className="flex border-b border-line text-sm" role="tablist">
        {(['camaras', 'topologia'] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={sidebarTab === t}
            className={`flex-1 border-b-2 px-3 py-2 ${sidebarTab === t ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink'}`}
            onClick={() => setSidebarTab(t)}
          >
            {t === 'camaras' ? 'Cámaras' : 'Topología'}
          </button>
        ))}
      </div>

      {sidebarTab === 'topologia' ? (
        <TopologyTree {...topology} />
      ) : (
      <>

      <div className="space-y-3 border-b border-line p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-2 left-2.5 size-4 text-muted" />
          <input
            className="input pl-8"
            placeholder="Filtrar este plano: nombre, código o IP"
            value={filters.q}
            onChange={(e) => setFilters({ q: e.target.value })}
          />
        </div>

        <div className="flex flex-wrap gap-1" role="group" aria-label="Filtrar por estado">
          {CAMERA_STATUS_KEYS.map((s) => (
            <button
              key={s}
              className={`chip ${filters.statuses.includes(s) ? 'chip-on' : ''}`}
              aria-pressed={filters.statuses.includes(s)}
              onClick={() => setFilters({ statuses: toggleIn(filters.statuses, s) })}
            >
              <span className="size-2 rounded-full" style={{ background: CAMERA_STATUS[s].color }} />
              {CAMERA_STATUS[s].label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Filtrar por tipo">
          {CAMERA_TYPE_KEYS.map((t) => (
            <button
              key={t}
              className={`chip ${filters.types.includes(t) ? 'chip-on' : ''}`}
              aria-pressed={filters.types.includes(t)}
              onClick={() => setFilters({ types: toggleIn(filters.types, t) })}
            >
              <CameraGlyph type={t} size={14} />
              {CAMERA_TYPES[t].label}
            </button>
          ))}
        </div>
        {brands.length > 0 && (
          <select
            className="input"
            value=""
            onChange={(e) => e.target.value && setFilters({ brands: toggleIn(filters.brands, e.target.value) })}
            aria-label="Filtrar por fabricante"
          >
            <option value="">Fabricante…</option>
            {brands.map((b) => (
              <option key={b} value={b}>{filters.brands.includes(b) ? `✓ ${b}` : b}</option>
            ))}
          </select>
        )}
        {filters.brands.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {filters.brands.map((b) => (
              <button key={b} className="chip chip-on" onClick={() => setFilters({ brands: toggleIn(filters.brands, b) })}>
                {b} <X className="size-3" />
              </button>
            ))}
          </div>
        )}
        {hasActiveFilters(filters) && (
          <button className="btn-ghost w-full text-xs" onClick={resetFilters}>
            <FilterX className="size-3.5" /> Quitar filtros ({visibleCameras.length} de {allCameras.length})
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="border-b border-line p-3">
          <StatsPanel cameras={allCameras} coverageRatio={coverageRatio} />
        </div>
        <ul className="divide-y divide-line" aria-label="Listado de cámaras">
          {visibleCameras.map((c) => (
            <li key={c.id}>
              <button
                onClick={() => focusCamera(c.id)}
                className={`flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-surface-2 ${c.id === selectedId ? 'bg-accent/10' : ''}`}
              >
                <CameraGlyph type={c.type} status={c.status} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="truncate text-sm text-ink">{c.name}</span>
                    <span className="shrink-0 text-xs text-muted">{c.code}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted">
                    <span className="tabular-nums">{c.ip_address ?? 'sin IP'}</span>
                    <span>· {CAMERA_STATUS[c.status].label}</span>
                    {!!c.attachment_count && (
                      <span className="inline-flex items-center gap-0.5"><Paperclip className="size-3" />{c.attachment_count}</span>
                    )}
                  </div>
                </div>
              </button>
            </li>
          ))}
          {visibleCameras.length === 0 && <li className="p-4 text-center text-sm text-muted">Sin cámaras que mostrar</li>}
        </ul>
      </div>
      </>
      )}
    </aside>
  );
}
