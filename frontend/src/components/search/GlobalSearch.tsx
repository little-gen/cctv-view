import { Loader2, Search, SlidersHorizontal, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router';
import { useGlobalSearch } from '@/api/hooks';
import { useDebouncedValue } from '@/lib/hooks';
import { countFilters, useSearch } from '@/store/searchStore';
import { tokenize } from '@/lib/text';
import type { SearchHit } from '@/types';
import { SearchFiltersBar } from './SearchFilters';
import { SearchResults } from './SearchResults';
import { SearchStats } from './SearchStats';

/**
 * Buscador global (cabecera). Busca en todos los proyectos mientras se escribe;
 * al elegir un resultado abre el proyecto/plano y centra y resalta la cámara.
 * Atajos: Ctrl/⌘+K o "/" para enfocar, ↑↓ para moverse, Intro para abrir, Esc para cerrar.
 */
export function GlobalSearch() {
  const navigate = useNavigate();
  const { q, setQ, filters, open, setOpen } = useSearch();
  const [showFilters, setShowFilters] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Debounce corto: respuesta instantánea sin una petición por tecla (las obsoletas se cancelan)
  const deferredQ = useDebouncedValue(q, 120);
  const { data, isFetching, error } = useGlobalSearch(deferredQ, filters);
  const nFilters = countFilters(filters);
  const enabled = deferredQ.trim().length >= 2 || nFilters > 0;
  const tokens = useMemo(() => tokenize(deferredQ), [deferredQ]);
  const flat = useMemo(() => data?.groups.flatMap((g) => g.cameras) ?? [], [data]);

  useEffect(() => setActive(0), [data]);

  // Atajos globales
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest('input, textarea, select, [contenteditable]');
      if ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !typing)) {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setOpen]);

  // Cerrar al pulsar fuera
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !rootRef.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open, setOpen]);

  const choose = (hit: SearchHit) => {
    setOpen(false);
    inputRef.current?.blur();
    // WorkspacePage procesa ?camera= (centrar, zoom, resaltar). En móvil no se abre
    // la ficha porque taparía el plano: solo se centra y resalta la cámara.
    const select = window.innerWidth >= 640;
    navigate(`/projects/${hit.project_id}/plans/${hit.floor_plan_id}?camera=${hit.id}${select ? '' : '&select=0'}`);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, flat.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && flat[active]) {
      e.preventDefault();
      choose(flat[active]);
    }
  };

  return (
    <div ref={rootRef} className="relative min-w-0 flex-1 sm:max-w-xl">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted" />
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded={open}
          aria-controls="global-search-results"
          aria-activedescendant={flat[active] ? `hit-${flat[active].id}` : undefined}
          aria-label="Buscar cámaras en todos los proyectos"
          className="input h-8 pr-20 pl-8"
          placeholder="Buscar cámaras: nombre, ID, IP, marca, NVR, ubicación…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        <div className="absolute top-1/2 right-1 flex -translate-y-1/2 items-center gap-0.5">
          {isFetching && <Loader2 className="size-4 animate-spin text-muted" aria-label="Buscando" />}
          {q && (
            <button className="btn-ghost p-1" onClick={() => { setQ(''); inputRef.current?.focus(); }} aria-label="Borrar búsqueda">
              <X className="size-3.5" />
            </button>
          )}
          <button
            className={`btn-ghost relative p-1 ${showFilters ? 'text-ink' : ''}`}
            onClick={() => { setShowFilters((s) => !s); setOpen(true); }}
            aria-label="Filtros avanzados"
            aria-pressed={showFilters}
          >
            <SlidersHorizontal className="size-3.5" />
            {nFilters > 0 && (
              <span className="absolute -top-1 -right-1 grid size-3.5 place-items-center rounded-full bg-accent text-[9px] text-white">{nFilters}</span>
            )}
          </button>
          <kbd className="hidden rounded border border-line px-1 text-[10px] text-muted lg:inline">Ctrl K</kbd>
        </div>
      </div>

      {open && (
        <div
          className="panel fixed inset-x-0 top-12 bottom-0 z-50 flex flex-col overflow-hidden rounded-none shadow-2xl sm:absolute sm:inset-x-auto sm:top-full sm:bottom-auto sm:left-0 sm:mt-1 sm:max-h-[75vh] sm:w-[min(760px,calc(100vw-2rem))] sm:rounded-lg"
          role="dialog"
          aria-label="Resultados de búsqueda"
        >
          {showFilters && <SearchFiltersBar facets={data?.facets} />}
          {!enabled ? (
            <p className="p-4 text-sm text-muted">
              Escribe al menos 2 caracteres o aplica un filtro. Busca en nombre, ID, IP, marca, modelo, NVR, ubicación, observaciones y proyecto de todas las
              instalaciones.
            </p>
          ) : error ? (
            <p className="p-4 text-sm text-red-300">{(error as Error).message}</p>
          ) : !data ? (
            <p className="p-4 text-sm text-muted">Buscando…</p>
          ) : (
            <>
              <SearchStats data={data} />
              <SearchResults data={data} tokens={tokens} active={flat[active]?.id} onChoose={choose} onHover={(id) => setActive(flat.findIndex((h) => h.id === id))} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
