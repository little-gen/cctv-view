import { Building2, ChevronRight, MapPin } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { CameraGlyph, StatusBadge } from '@/components/cameras/CameraGlyph';
import { CAMERA_TYPES } from '@/lib/cameraTypes';
import { highlightSegments, matches, snippet } from '@/lib/text';
import { useSearch } from '@/store/searchStore';
import type { SearchHit, SearchResponse } from '@/types';

interface Props {
  data: SearchResponse;
  tokens: string[];
  active?: string;
  onChoose: (hit: SearchHit) => void;
  onHover: (id: string) => void;
}

export function SearchResults({ data, tokens, active, onChoose, onHover }: Props) {
  const setFilters = useSearch((s) => s.setFilters);
  const listRef = useRef<HTMLDivElement>(null);

  // Mantener visible el resultado activo al navegar con el teclado
  useEffect(() => {
    if (active) listRef.current?.querySelector(`#hit-${CSS.escape(active)}`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!data.total) return <p className="p-4 text-sm text-muted">Sin coincidencias. Prueba con menos palabras o quita filtros.</p>;

  return (
    <div ref={listRef} id="global-search-results" role="listbox" className="min-h-0 flex-1 overflow-auto">
      {data.groups.map((g) => (
        <section key={g.project.id} aria-label={g.project.name}>
          <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-surface-2 px-3 py-1.5 text-xs">
            <Building2 className="size-3.5 text-muted" />
            <span className="truncate font-medium text-ink"><Hl text={g.project.name} tokens={tokens} /></span>
            <span className="shrink-0 text-muted">{g.hits} {g.hits === 1 ? 'cámara' : 'cámaras'}</span>
            {g.hits > g.cameras.length && (
              <button className="ml-auto shrink-0 text-accent hover:underline" onClick={() => setFilters({ projectId: g.project.id })}>
                Ver las {g.hits}
              </button>
            )}
          </header>
          <ul>
            {g.cameras.map((hit) => (
              <ResultRow key={hit.id} hit={hit} tokens={tokens} active={hit.id === active} onChoose={onChoose} onHover={onHover} />
            ))}
          </ul>
        </section>
      ))}
      {data.truncated && (
        <p className="p-3 text-center text-xs text-muted">
          Mostrando {data.shown} de {data.total.toLocaleString('es-ES')}. Afina la búsqueda o filtra por proyecto para ver el resto.
        </p>
      )}
    </div>
  );
}

function ResultRow({ hit, tokens, active, onChoose, onHover }: { hit: SearchHit; tokens: string[]; active: boolean; onChoose: (h: SearchHit) => void; onHover: (id: string) => void }) {
  // Campos que no se muestran en la fila pero han provocado la coincidencia
  const extra = [
    { label: 'Marca', value: hit.brand },
    { label: 'Modelo', value: hit.model },
    { label: 'NVR', value: hit.nvr_name },
    { label: 'Obs.', value: hit.notes && snippet(hit.notes, tokens) },
  ].filter((f) => matches(f.value, tokens));

  return (
    <li
      id={`hit-${hit.id}`}
      role="option"
      aria-selected={active}
      onClick={() => onChoose(hit)}
      onMouseMove={() => !active && onHover(hit.id)}
      className={`flex cursor-pointer items-center gap-3 border-b border-line/60 px-3 py-2 ${active ? 'bg-accent/15' : 'hover:bg-surface-2'}`}
    >
      <CameraGlyph type={hit.type} status={hit.status} size={24} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm text-ink"><Hl text={hit.name} tokens={tokens} /></span>
          <span className="shrink-0 text-xs text-muted"><Hl text={hit.code} tokens={tokens} /></span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-ink-2">
          <span>{CAMERA_TYPES[hit.type].label}</span>
          <StatusBadge status={hit.status} />
          <span className="tabular-nums">{hit.ip_address ? <Hl text={hit.ip_address} tokens={tokens} /> : <span className="text-muted">sin IP</span>}</span>
          {hit.physical_location && (
            <span className="inline-flex min-w-0 items-center gap-0.5">
              <MapPin className="size-3 shrink-0 text-muted" />
              <span className="truncate"><Hl text={hit.physical_location} tokens={tokens} /></span>
            </span>
          )}
          <span className="text-muted">· {hit.plan_name}</span>
        </div>
        {extra.length > 0 && (
          <div className="mt-0.5 truncate text-xs text-muted">
            {extra.map((f, i) => (
              <span key={f.label}>
                {i > 0 && ' · '}
                {f.label}: <Hl text={f.value!} tokens={tokens} />
              </span>
            ))}
          </div>
        )}
      </div>
      <ChevronRight className={`size-4 shrink-0 ${active ? 'text-ink' : 'text-line'}`} />
    </li>
  );
}

/** Texto con las coincidencias resaltadas. */
function Hl({ text, tokens }: { text: string; tokens: string[] }) {
  return (
    <>
      {highlightSegments(text, tokens).map((s, i) =>
        s.hit ? <mark key={i} className="rounded-sm bg-accent/30 px-px text-ink">{s.text}</mark> : <span key={i}>{s.text}</span>,
      )}
    </>
  );
}
