import { ArrowRightLeft, ChevronLeft, Map as MapIcon, Pencil, Plus, Server, Trash2, Unlink } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useAssignToNvr, useCameras, useDeleteNvr, useNvrs, useProject, useUnassignFromNvr } from '@/api/hooks';
import { useAuth } from '@/auth/AuthContext';
import { CameraGlyph, StatusBadge } from '@/components/cameras/CameraGlyph';
import { AssignCamerasModal } from '@/components/nvr/AssignCamerasModal';
import { NvrFormModal } from '@/components/nvr/NvrFormModal';
import { OccupancyBar, OccupancyNotice } from '@/components/nvr/OccupancyBar';
import { ErrorText } from '@/components/ui/Modal';
import { CAMERA_TYPES } from '@/lib/cameraTypes';
import { channelLabel, groupByNvr, NO_NVR, NVR_LEVEL, nvrUsage } from '@/lib/nvr';
import type { Camera, Nvr } from '@/types';

/** Datos comunes: NVR, cámaras del proyecto agrupadas y ocupación (todo desde la caché compartida con el plano). */
function useNvrData(projectId: string) {
  const { data: project } = useProject(projectId);
  const nvrsQ = useNvrs(projectId);
  const camerasQ = useCameras(projectId);
  const cameras = camerasQ.data;
  const nvrs = nvrsQ.data;
  return useMemo(() => {
    const byNvr = groupByNvr(cameras ?? []);
    const planNames = new Map((project?.plans ?? []).map((p) => [p.id, p.name]));
    const usage = (n: Nvr) => nvrUsage(n, byNvr.get(n.id)?.length ?? 0);
    return { project, nvrs: nvrs ?? [], cameras: cameras ?? [], byNvr, planNames, usage, loading: nvrsQ.isLoading || camerasQ.isLoading };
  }, [project, nvrs, cameras, nvrsQ.isLoading, camerasQ.isLoading]);
}

/** Enlace al plano: con ?nvr= resalta el NVR; con ?camera= centra una cámara. */
export const planLink = (projectId: string, q: { nvr?: string; camera?: string; plan?: string }) =>
  `/projects/${projectId}${q.plan ? `/plans/${q.plan}` : ''}?${new URLSearchParams(q.nvr ? { nvr: q.nvr } : { camera: q.camera ?? '' })}`;

function PageHeader({ projectId, projectName, title, back, children }: { projectId: string; projectName?: string; title: ReactNode; back: string; children?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <Link to={back} className="btn-ghost px-1.5" aria-label="Volver"><ChevronLeft className="size-4" /></Link>
      <div className="min-w-0 flex-1">
        <Link to={`/projects/${projectId}`} className="text-xs text-muted hover:text-ink">{projectName ?? 'Proyecto'}</Link>
        <h1 className="truncate text-xl font-semibold">{title}</h1>
      </div>
      {children}
    </div>
  );
}

// ======================================================= Listado + resumen
export function NvrListPage() {
  const { projectId = '' } = useParams();
  const { canEdit } = useAuth();
  const navigate = useNavigate();
  const d = useNvrData(projectId);
  const [creating, setCreating] = useState(false);
  const unassigned = d.byNvr.get(NO_NVR) ?? [];

  const totals = useMemo(() => {
    let free = 0;
    let undefinedCount = 0;
    let capacity = 0;
    for (const n of d.nvrs) {
      const u = d.usage(n);
      if (u.total === null) undefinedCount++;
      else {
        free += u.free ?? 0;
        capacity += u.total;
      }
    }
    return { free, undefinedCount, capacity };
  }, [d]);

  return (
    <div className="mx-auto h-full max-w-6xl overflow-auto p-4 sm:p-6">
      <PageHeader projectId={projectId} projectName={d.project?.name} title="Grabadores (NVR)" back={`/projects/${projectId}`}>
        {canEdit && <button className="btn-primary" onClick={() => setCreating(true)}><Plus className="size-4" /> Nuevo NVR</button>}
      </PageHeader>

      {/* Panel resumen */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile label="NVR" value={d.nvrs.length} />
        <Tile label="Cámaras" value={d.cameras.length} />
        <Tile
          label="Cámaras sin asignar"
          value={unassigned.length}
          tone={unassigned.length ? 'text-amber-300' : undefined}
          href={unassigned.length ? '#sin-nvr' : undefined}
        />
        <Tile
          label="Canales libres"
          value={totals.free}
          hint={`de ${totals.capacity}${totals.undefinedCount ? ` · ${totals.undefinedCount} NVR sin capacidad definida` : ''}`}
        />
      </div>

      <div className="panel mb-6 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted">
            <tr className="border-b border-line">
              <th className="p-3">Nombre</th><th className="p-3">Marca / modelo</th><th className="p-3">IP</th><th className="p-3">Ubicación</th>
              <th className="p-3 text-right">Canales</th><th className="p-3 text-right">Cámaras</th><th className="p-3 text-right">Libres</th>
              <th className="p-3">Ocupación</th><th className="p-3">Estado</th>
            </tr>
          </thead>
          <tbody>
            {d.nvrs.map((n) => {
              const u = d.usage(n);
              return (
                <tr key={n.id} className="cursor-pointer border-b border-line last:border-0 hover:bg-surface-2" onClick={() => navigate(n.id)}>
                  <td className="p-3 font-medium">
                    <Link to={n.id} className="hover:underline" onClick={(e) => e.stopPropagation()}>{n.name}</Link>
                  </td>
                  <td className="p-3 text-ink-2">{[n.brand, n.model].filter(Boolean).join(' ') || '—'}</td>
                  <td className="p-3 text-ink-2 tabular-nums">{n.ip_address ?? '—'}</td>
                  <td className="p-3 text-ink-2">{n.location ?? '—'}</td>
                  <td className="p-3 text-right tabular-nums">{u.total ?? '—'}</td>
                  <td className="p-3 text-right tabular-nums">{u.used}</td>
                  <td className="p-3 text-right tabular-nums">{u.free ?? '—'}</td>
                  <td className="p-3"><OccupancyBar usage={u} compact /></td>
                  <td className={`p-3 whitespace-nowrap ${NVR_LEVEL[u.level].text}`}>
                    {u.level === 'available' || u.level === 'warning' ? 'Disponible' : NVR_LEVEL[u.level].label}
                  </td>
                </tr>
              );
            })}
            {!d.loading && d.nvrs.length === 0 && (
              <tr><td colSpan={9} className="p-6 text-center text-muted">No hay NVR en este proyecto{canEdit ? '. Crea el primero con «Nuevo NVR».' : '.'}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <UnassignedSection projectId={projectId} cameras={unassigned} nvrs={d.nvrs} usage={d.usage} planNames={d.planNames} />

      {creating && <NvrFormModal projectId={projectId} onClose={() => setCreating(false)} onSaved={(n) => navigate(n.id)} />}
    </div>
  );
}

function Tile({ label, value, hint, tone, href }: { label: string; value: number; hint?: string; tone?: string; href?: string }) {
  const body = (
    <>
      <div className="text-xs text-muted">{label}</div>
      <div className={`text-2xl font-semibold tabular-nums ${tone ?? ''}`}>{value}</div>
      {hint && <div className="text-xs text-muted">{hint}</div>}
    </>
  );
  return href ? <a href={href} className="panel block p-3 hover:bg-surface-2">{body}</a> : <div className="panel p-3">{body}</div>;
}

/** Cámaras sin NVR, con asignación rápida a un NVR con canales libres. */
function UnassignedSection({ projectId, cameras, nvrs, usage, planNames }: {
  projectId: string;
  cameras: Camera[];
  nvrs: Nvr[];
  usage: (n: Nvr) => ReturnType<typeof nvrUsage>;
  planNames: Map<string, string>;
}) {
  const { canEdit } = useAuth();
  const assign = useAssignToNvr(projectId);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState('');
  const targetUsage = nvrs.find((n) => n.id === target);
  const free = targetUsage ? usage(targetUsage).free : null;
  const tooMany = free !== null && picked.size > free;

  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <section id="sin-nvr" className="scroll-mt-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="flex-1 font-semibold">Cámaras sin NVR <span className="text-muted">({cameras.length})</span></h2>
        {cameras.length > 0 && (
          <Link to={planLink(projectId, { nvr: NO_NVR })} className="btn-ghost text-xs"><MapIcon className="size-3.5" /> Ver en el plano</Link>
        )}
      </div>
      {cameras.length === 0 ? (
        <p className="panel p-4 text-sm text-muted">Todas las cámaras tienen NVR asignado.</p>
      ) : (
        <div className="panel">
          {canEdit && nvrs.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 border-b border-line p-3 text-sm">
              <label className="flex items-center gap-2 text-ink-2">
                <input
                  type="checkbox"
                  className="accent-accent"
                  checked={picked.size === cameras.length}
                  onChange={(e) => setPicked(e.target.checked ? new Set(cameras.map((c) => c.id)) : new Set())}
                />
                Todas
              </label>
              <span className="text-muted">{picked.size} seleccionadas →</span>
              <select className="input w-auto" value={target} onChange={(e) => setTarget(e.target.value)} aria-label="NVR de destino">
                <option value="">Elegir NVR…</option>
                {nvrs.map((n) => {
                  const u = usage(n);
                  const isFull = u.free === 0;
                  return (
                    <option key={n.id} value={n.id} disabled={isFull}>
                      {n.name} — {u.total === null ? 'capacidad sin definir' : isFull ? 'completo' : `${u.free} libres`}
                    </option>
                  );
                })}
              </select>
              <button
                className="btn-primary"
                disabled={!target || !picked.size || tooMany || assign.isPending}
                onClick={() => assign.mutate({ nvrId: target, cameraIds: [...picked] }, { onSuccess: () => setPicked(new Set()) })}
              >
                Asignar
              </button>
              {tooMany && <span className="text-xs text-red-300">El NVR solo tiene {free} canales libres</span>}
            </div>
          )}
          <ul className="max-h-96 divide-y divide-line overflow-auto">
            {cameras.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                {canEdit && nvrs.length > 0 && (
                  <input type="checkbox" className="accent-accent" checked={picked.has(c.id)} onChange={() => toggle(c.id)} aria-label={`Seleccionar ${c.code}`} />
                )}
                <CameraGlyph type={c.type} status={c.status} size={18} />
                <span className="w-20 shrink-0 text-xs text-muted">{c.code}</span>
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                <span className="hidden text-xs text-muted sm:inline">{planNames.get(c.floor_plan_id)}</span>
                <Link to={planLink(projectId, { camera: c.id, plan: c.floor_plan_id })} className="btn-ghost px-1.5" title="Ver en el plano"><MapIcon className="size-3.5" /></Link>
              </li>
            ))}
          </ul>
          <div className="px-3"><ErrorText error={assign.error} /></div>
        </div>
      )}
    </section>
  );
}

// ================================================================ Detalle
export function NvrDetailPage() {
  const { projectId = '', nvrId = '' } = useParams();
  const { canEdit } = useAuth();
  const navigate = useNavigate();
  const d = useNvrData(projectId);
  const remove = useDeleteNvr(projectId);
  const unassign = useUnassignFromNvr(projectId);
  const move = useAssignToNvr(projectId);
  const [modal, setModal] = useState<'edit' | 'assign' | null>(null);

  const nvr = d.nvrs.find((n) => n.id === nvrId);
  if (d.loading) return <div className="grid h-full place-items-center text-muted">Cargando…</div>;
  if (!nvr) return <div className="grid h-full place-items-center text-muted">NVR no encontrado</div>;

  const usage = d.usage(nvr);
  const cams = d.byNvr.get(nvr.id) ?? [];
  const others = d.nvrs.filter((n) => n.id !== nvr.id);
  const canAssign = usage.free === null || usage.free > 0;

  const del = () => {
    const msg = cams.length
      ? `¿Eliminar ${nvr.name}? Sus ${cams.length} cámaras quedarán sin NVR.`
      : `¿Eliminar ${nvr.name}?`;
    if (confirm(msg)) remove.mutate(nvr.id, { onSuccess: () => navigate(`/projects/${projectId}/nvrs`) });
  };

  return (
    <div className="mx-auto h-full max-w-5xl overflow-auto p-4 sm:p-6">
      <PageHeader
        projectId={projectId}
        projectName={d.project?.name}
        back={`/projects/${projectId}/nvrs`}
        title={<span className="flex items-center gap-2"><Server className="size-5 text-muted" /> {nvr.name}</span>}
      >
        {cams.length > 0 && (
          <Link to={planLink(projectId, { nvr: nvr.id })} className="btn-ghost"><MapIcon className="size-4" /> Ver en el plano</Link>
        )}
        {canEdit && (
          <>
            <button className="btn-ghost" onClick={() => setModal('edit')}><Pencil className="size-4" /> Editar</button>
            <button className="btn-danger" onClick={del} disabled={remove.isPending}><Trash2 className="size-4" /> Eliminar</button>
          </>
        )}
      </PageHeader>

      <div className="mb-4 grid gap-4 md:grid-cols-[1fr_1fr]">
        <dl className="panel grid grid-cols-2 gap-x-4 gap-y-3 p-4 text-sm">
          <Info label="Marca">{nvr.brand}</Info>
          <Info label="Modelo">{nvr.model}</Info>
          <Info label="Dirección IP"><span className="tabular-nums">{nvr.ip_address}</span></Info>
          <Info label="Ubicación">{nvr.location}</Info>
          <Info label="Observaciones" wide>{nvr.notes && <span className="whitespace-pre-wrap">{nvr.notes}</span>}</Info>
        </dl>

        <div className="panel space-y-3 p-4">
          <div className="grid grid-cols-3 text-center">
            <Stat label="Canales" value={usage.total ?? '—'} />
            <Stat label="Cámaras" value={usage.used} />
            <Stat label="Libres" value={usage.free ?? '—'} tone={NVR_LEVEL[usage.level].text} />
          </div>
          <OccupancyBar usage={usage} />
          <p className={`text-center text-sm ${NVR_LEVEL[usage.level].text}`}>
            {usage.total ? `${Math.round((usage.ratio ?? 0) * 100)} % de ocupación · ` : ''}{NVR_LEVEL[usage.level].label}
          </p>
          <OccupancyNotice usage={usage} name={nvr.name} />
        </div>
      </div>

      <div className="mb-2 flex items-center gap-2">
        <h2 className="flex-1 font-semibold">Cámaras <span className="text-muted">({cams.length})</span></h2>
        {canEdit && (
          <button
            className="btn-primary"
            onClick={() => setModal('assign')}
            disabled={!canAssign}
            title={canAssign ? undefined : 'NVR completo: no quedan canales libres'}
          >
            <Plus className="size-4" /> Asociar cámaras
          </button>
        )}
      </div>
      <div className="panel overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted">
            <tr className="border-b border-line">
              <th className="p-3">Canal</th><th className="p-3">Cámara</th><th className="p-3">Tipo</th><th className="p-3">Estado</th>
              <th className="p-3">IP</th><th className="p-3">Plano</th><th />
            </tr>
          </thead>
          <tbody>
            {cams.map((c) => (
              <tr key={c.id} className="border-b border-line last:border-0">
                <td className="p-3 tabular-nums text-ink-2">{channelLabel(c.channel)}</td>
                <td className="p-3">
                  <span className="mr-2 text-xs text-muted">{c.code}</span>{c.name}
                </td>
                <td className="p-3"><span className="inline-flex items-center gap-1.5"><CameraGlyph type={c.type} size={16} />{CAMERA_TYPES[c.type].label}</span></td>
                <td className="p-3"><StatusBadge status={c.status} /></td>
                <td className="p-3 text-ink-2 tabular-nums">{c.ip_address ?? '—'}</td>
                <td className="p-3 text-ink-2">{d.planNames.get(c.floor_plan_id)}</td>
                <td className="p-3 text-right whitespace-nowrap">
                  <Link to={planLink(projectId, { camera: c.id, plan: c.floor_plan_id })} className="btn-ghost px-1.5" title="Ver en el plano">
                    <MapIcon className="size-4" />
                  </Link>
                  {canEdit && others.length > 0 && (
                    <MoveSelect
                      nvrs={others}
                      usage={d.usage}
                      onMove={(target) => move.mutate({ nvrId: target, cameraIds: [c.id] })}
                    />
                  )}
                  {canEdit && (
                    <button
                      className="btn-ghost px-1.5"
                      title="Desasociar del NVR"
                      aria-label={`Desasociar ${c.code}`}
                      onClick={() => unassign.mutate({ nvrId: nvr.id, cameraId: c.id })}
                    >
                      <Unlink className="size-4" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {cams.length === 0 && (
              <tr><td colSpan={7} className="p-6 text-center text-muted">Este NVR no tiene cámaras asociadas.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <ErrorText error={move.error ?? unassign.error ?? remove.error} />

      {modal === 'edit' && <NvrFormModal projectId={projectId} nvr={nvr} onClose={() => setModal(null)} />}
      {modal === 'assign' && (
        <AssignCamerasModal nvr={nvr} usage={usage} cameras={d.cameras} planNames={d.planNames} onClose={() => setModal(null)} />
      )}
    </div>
  );
}

function Info({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'col-span-2' : ''}>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5">{children || <span className="text-muted">—</span>}</dd>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: string }) {
  return (
    <div>
      <div className={`text-2xl font-semibold tabular-nums ${tone ?? ''}`}>{value}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}

/** "Mover a…": desplegable con los demás NVR; los completos aparecen desactivados. */
function MoveSelect({ nvrs, usage, onMove }: { nvrs: Nvr[]; usage: (n: Nvr) => ReturnType<typeof nvrUsage>; onMove: (id: string) => void }) {
  return (
    <label className="relative inline-flex" title="Mover a otro NVR">
      <ArrowRightLeft className="pointer-events-none absolute top-1.5 left-1.5 size-4 text-ink-2" aria-hidden />
      <select
        className="w-7 cursor-pointer appearance-none rounded-md bg-transparent py-1 text-transparent hover:bg-surface-3"
        value=""
        aria-label="Mover a otro NVR"
        onChange={(e) => e.target.value && onMove(e.target.value)}
      >
        <option value="">Mover a…</option>
        {nvrs.map((n) => {
          const u = usage(n);
          return (
            <option key={n.id} value={n.id} disabled={u.free === 0} className="text-ink">
              {n.name} — {u.total === null ? 'sin definir' : u.free === 0 ? 'completo' : `${u.free} libres`}
            </option>
          );
        })}
      </select>
    </label>
  );
}
