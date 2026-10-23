import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, FolderTree, Server, Unplug } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { CameraGlyph } from '@/components/cameras/CameraGlyph';
import { channelLabel, groupByNvr, NO_NVR, nvrUsage } from '@/lib/nvr';
import { useEditor } from '@/store/editorStore';
import type { Camera, FloorPlan, Nvr, ProjectDetail } from '@/types';
import { OccupancyBar } from './OccupancyBar';

export interface TopologyData {
  project: ProjectDetail | undefined;
  plan: FloorPlan | null;
  cameras: Camera[];
  nvrs: Nvr[];
}

/**
 * Árbol Proyecto → NVR → cámaras (todas las del proyecto, de cualquier plano).
 * Cámara: se centra en el plano (cambiando de plano si hace falta).
 * NVR: se resaltan sus cámaras en el plano y se encuadran.
 */
export function TopologyTree({ project, plan, cameras, nvrs }: TopologyData) {
  const navigate = useNavigate();
  const { selectedId, focusCamera, nvrHighlight, highlightNvr } = useEditor();
  const byNvr = useMemo(() => groupByNvr(cameras), [cameras]);
  const planNames = useMemo(() => new Map((project?.plans ?? []).map((p) => [p.id, p.name])), [project?.plans]);
  const groups = useMemo(
    () => [
      ...nvrs.map((n) => ({ id: n.id, nvr: n, cams: byNvr.get(n.id) ?? [] })),
      ...(byNvr.has(NO_NVR) ? [{ id: NO_NVR, nvr: null, cams: byNvr.get(NO_NVR) ?? [] }] : []),
    ],
    [nvrs, byNvr],
  );

  // Abiertos por defecto si el proyecto es pequeño; con muchas cámaras, cerrados
  const [open, setOpen] = useState<Set<string>>(() => new Set(cameras.length <= 60 ? groups.map((g) => g.id) : []));
  const [rootOpen, setRootOpen] = useState(true);
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allOpen = groups.length > 0 && groups.every((g) => open.has(g.id));

  const selectCamera = (c: Camera) => {
    if (c.floor_plan_id === plan?.id) focusCamera(c.id);
    else navigate(`/projects/${c.project_id}/plans/${c.floor_plan_id}?camera=${c.id}`);
  };
  const selectNvr = (id: string) => {
    if (nvrHighlight?.id === id) highlightNvr(null);
    else {
      highlightNvr(id);
      setOpen((s) => new Set(s).add(id));
    }
  };

  if (!project) return null;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-line px-3 py-2 text-xs text-muted">
        <span>{nvrs.length} NVR · {cameras.length} cámaras</span>
        <button className="btn-ghost px-1.5 text-xs" onClick={() => setOpen(allOpen ? new Set() : new Set(groups.map((g) => g.id)))}>
          {allOpen ? <ChevronsDownUp className="size-3.5" /> : <ChevronsUpDown className="size-3.5" />}
          {allOpen ? 'Contraer todo' : 'Expandir todo'}
        </button>
      </div>
      <ul role="tree" aria-label="Topología del proyecto" className="min-h-0 flex-1 overflow-auto py-1 text-sm">
        <li role="treeitem" aria-expanded={rootOpen} aria-selected={false}>
          <Row depth={0} open={rootOpen} onToggle={() => setRootOpen(!rootOpen)} onClick={() => setRootOpen(!rootOpen)}>
            <FolderTree className="size-4 shrink-0 text-muted" />
            <span className="truncate font-medium">{project.name}</span>
          </Row>
          {rootOpen && (
            <ul role="group">
              {groups.map((g) => {
                const isOpen = open.has(g.id);
                const active = nvrHighlight?.id === g.id;
                const usage = g.nvr ? nvrUsage(g.nvr, g.cams.length) : null;
                return (
                  <li key={g.id} role="treeitem" aria-expanded={isOpen} aria-selected={active}>
                    <Row depth={1} open={isOpen} onToggle={() => toggle(g.id)} onClick={() => selectNvr(g.id)} active={active}
                      title={active ? 'Quitar resaltado' : 'Resaltar sus cámaras en el plano'}>
                      {g.nvr ? <Server className="size-4 shrink-0 text-muted" /> : <Unplug className="size-4 shrink-0 text-amber-300" />}
                      <span className={`min-w-0 flex-1 truncate ${g.nvr ? '' : 'text-amber-300'}`}>{g.nvr?.name ?? 'Sin NVR'}</span>
                      <span className="shrink-0 text-xs text-muted tabular-nums">
                        {usage?.total ? `${usage.used}/${usage.total}` : g.cams.length}
                      </span>
                      {usage && <div className="w-12 shrink-0"><OccupancyBar usage={usage} /></div>}
                    </Row>
                    {isOpen && (
                      <ul role="group">
                        {g.cams.map((c) => (
                          <li key={c.id} role="treeitem" aria-selected={c.id === selectedId}>
                            <Row depth={2} onClick={() => selectCamera(c)} active={c.id === selectedId}
                              title={c.floor_plan_id === plan?.id ? 'Centrar en el plano' : `Abrir en «${planNames.get(c.floor_plan_id)}»`}>
                              <CameraGlyph type={c.type} status={c.status} size={16} />
                              {g.nvr && <span className="w-11 shrink-0 text-xs text-muted tabular-nums">{channelLabel(c.channel)}</span>}
                              <span className="shrink-0 text-xs text-muted">{c.code}</span>
                              <span className="min-w-0 flex-1 truncate">{c.name}</span>
                              {c.floor_plan_id !== plan?.id && (
                                <span className="max-w-20 shrink-0 truncate text-[11px] text-muted">{planNames.get(c.floor_plan_id)}</span>
                              )}
                            </Row>
                          </li>
                        ))}
                        {g.cams.length === 0 && <li className="py-1 pl-14 text-xs text-muted">Sin cámaras</li>}
                      </ul>
                    )}
                  </li>
                );
              })}
              {groups.length === 0 && <li className="py-2 pl-8 text-xs text-muted">Sin NVR ni cámaras</li>}
            </ul>
          )}
        </li>
      </ul>
    </div>
  );
}

function Row({ depth, open, onToggle, onClick, active, title, children }: {
  depth: number;
  open?: boolean;
  onToggle?: () => void;
  onClick: () => void;
  active?: boolean;
  title?: string;
  children: ReactNode;
}) {
  return (
    <div className={`flex items-center ${active ? 'bg-accent/15' : 'hover:bg-surface-2'}`} style={{ paddingLeft: 4 + depth * 16 }}>
      {onToggle ? (
        <button className="grid size-6 shrink-0 place-items-center rounded text-muted hover:text-ink" onClick={onToggle} aria-label={open ? 'Contraer' : 'Expandir'}>
          {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </button>
      ) : (
        <span className="size-6 shrink-0" />
      )}
      <button className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-3 text-left" onClick={onClick} title={title}>
        {children}
      </button>
    </div>
  );
}
