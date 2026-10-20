import { ChevronLeft, Download, FileSpreadsheet, FileText, Layers, ListFilter, Map, Plus, Server, Settings } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { downloadFile } from '@/api/client';
import { useCameras, useCreateCamera, useProject, useUpdateCamera } from '@/api/hooks';
import { useAuth } from '@/auth/AuthContext';
import { CameraSheet } from '@/components/cameras/CameraSheet';
import { CameraSidebar } from '@/components/cameras/CameraSidebar';
import { CameraPalette } from '@/components/plan/CameraPalette';
import { NvrModal } from '@/components/plan/NvrModal';
import { PlanCanvas } from '@/components/plan/PlanCanvas';
import { PlanSettingsModal } from '@/components/plan/PlanSettingsModal';
import { PlanUpload } from '@/components/plan/PlanUpload';
import { Dropdown, MenuItem, MenuToggle } from '@/components/ui/Dropdown';
import { computeCoverage, HEATMAP_LEGEND } from '@/lib/coverage';
import { filterCameras } from '@/lib/filters';
import { useEditor } from '@/store/editorStore';
import type { CameraType } from '@/types';

export function WorkspacePage() {
  const { projectId = '', planId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { canEdit } = useAuth();
  const { data: project, isLoading } = useProject(projectId);
  const { data: cameras = [] } = useCameras(projectId);
  const createCamera = useCreateCamera(projectId);
  const updateCamera = useUpdateCamera(projectId);
  const editor = useEditor();
  const [modal, setModal] = useState<'newPlan' | 'planSettings' | 'nvr' | null>(null);

  const plan = project?.plans.find((p) => p.id === planId) ?? project?.plans[0];

  // URL canónica con el plano activo (conservando ?camera= del buscador global)
  useEffect(() => {
    if (plan && plan.id !== planId) navigate(`/projects/${projectId}/plans/${plan.id}${location.search}`, { replace: true });
  }, [plan, planId, projectId, navigate, location.search]);

  // Al cambiar de plano se cierra la ficha abierta
  useEffect(() => editor.select(null), [plan?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const planCameras = useMemo(() => cameras.filter((c) => c.floor_plan_id === plan?.id), [cameras, plan?.id]);
  const visible = useMemo(() => filterCameras(planCameras, editor.filters), [planCameras, editor.filters]);

  // Llegada desde el buscador global: ?camera=<id>[&select=0]. Se espera a que carguen
  // las cámaras del plano; si los filtros locales la ocultan, se quitan; después se
  // centra, se hace zoom y se resalta (PlanCanvas consume la petición de foco).
  const targetCamera = searchParams.get('camera');
  useEffect(() => {
    if (!targetCamera) return;
    const cam = planCameras.find((c) => c.id === targetCamera);
    if (!cam) return;
    if (!filterCameras([cam], editor.filters).length) editor.resetFilters();
    editor.focusCamera(cam.id, searchParams.get('select') !== '0');
    setSearchParams({}, { replace: true });
  }, [targetCamera, planCameras]); // eslint-disable-line react-hooks/exhaustive-deps
  const selected = planCameras.find((c) => c.id === editor.selectedId);

  const coverage = useMemo(() => {
    if (!plan?.width_px || !plan.height_px) return null;
    const source = editor.coverageOnlyOperational ? planCameras.filter((c) => c.status === 'operativa') : planCameras;
    return computeCoverage(source, { widthPx: plan.width_px, heightPx: plan.height_px, widthM: plan.width_m });
  }, [planCameras, plan?.width_px, plan?.height_px, plan?.width_m, editor.coverageOnlyOperational]);

  const onCreate = (type: CameraType, pos: { pos_x: number; pos_y: number }) => {
    if (!plan) return;
    createCamera.mutate({ floor_plan_id: plan.id, type, ...pos }, { onSuccess: (cam) => editor.select(cam.id) });
  };

  if (isLoading) return <div className="grid h-full place-items-center text-muted">Cargando proyecto…</div>;
  if (!project) return <div className="grid h-full place-items-center text-muted">Proyecto no encontrado</div>;

  return (
    <div className="flex h-full flex-col">
      {/* Barra de herramientas */}
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-line bg-surface px-2">
        <Link to="/" className="btn-ghost px-1.5" title="Proyectos"><ChevronLeft className="size-4" /></Link>
        <button className="btn-ghost px-1.5 lg:hidden" onClick={() => editor.toggle('sidebarOpen')} aria-label="Listado y filtros">
          <ListFilter className="size-4" />
        </button>
        <span className="hidden max-w-48 truncate font-medium md:inline">{project.name}</span>
        <span className="hidden text-muted md:inline">/</span>

        {project.plans.length > 0 && (
          <select
            className="input w-auto max-w-44 py-1"
            value={plan?.id}
            onChange={(e) => navigate(`/projects/${projectId}/plans/${e.target.value}`)}
            aria-label="Plano"
          >
            {project.plans.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.camera_count})</option>)}
          </select>
        )}
        {canEdit && (
          <button className="btn-ghost px-1.5" onClick={() => setModal('newPlan')} title="Nuevo plano"><Plus className="size-4" /></button>
        )}
        {plan && canEdit && (
          <button className="btn-ghost px-1.5" onClick={() => setModal('planSettings')} title="Configurar / sustituir plano"><Settings className="size-4" /></button>
        )}

        <div className="ml-auto flex items-center gap-1">
          <button className="btn-ghost px-2" onClick={() => setModal('nvr')} title="NVR">
            <Server className="size-4" /><span className="hidden md:inline">NVR</span>
          </button>
          <Dropdown trigger={<button className="btn-ghost px-2" title="Capas"><Layers className="size-4" /><span className="hidden md:inline">Capas</span></button>}>
            <MenuToggle checked={editor.showCones} onChange={() => editor.toggle('showCones')}>Conos de visión</MenuToggle>
            <MenuToggle checked={editor.showLabels} onChange={() => editor.toggle('showLabels')}>Etiquetas</MenuToggle>
            <div className="my-1 border-t border-line" />
            <div className="px-2 pt-1 text-xs text-muted">Análisis de cobertura</div>
            {(['none', 'heatmap', 'gaps'] as const).map((m) => (
              <label key={m} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-ink-2 hover:bg-surface-3">
                <input type="radio" name="coverage" checked={editor.coverageMode === m} onChange={() => editor.setCoverageMode(m)} className="accent-accent" />
                {{ none: 'Desactivado', heatmap: 'Mapa de calor', gaps: 'Zonas sin cobertura' }[m]}
              </label>
            ))}
            <MenuToggle checked={editor.coverageOnlyOperational} onChange={() => editor.toggle('coverageOnlyOperational')}>
              Solo cámaras operativas
            </MenuToggle>
          </Dropdown>
          <Dropdown trigger={<button className="btn-ghost px-2" title="Exportar"><Download className="size-4" /><span className="hidden md:inline">Exportar</span></button>}>
            {plan?.storage_key && (
              <MenuItem icon={<Map className="size-4" />} onClick={() => downloadFile(`/plans/${plan.id}/export/pdf`, 'plano.pdf')}>
                Plano con cámaras (PDF)
              </MenuItem>
            )}
            <MenuItem icon={<FileText className="size-4" />} onClick={() => downloadFile(`/projects/${projectId}/export/report.pdf`, 'informe.pdf')}>
              Informe técnico (PDF)
            </MenuItem>
            <MenuItem icon={<FileSpreadsheet className="size-4" />} onClick={() => downloadFile(`/projects/${projectId}/export/inventory.xlsx`, 'inventario.xlsx')}>
              Inventario (Excel)
            </MenuItem>
          </Dropdown>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1">
        {/* Panel lateral: fijo en escritorio, superpuesto en tablet/móvil */}
        {editor.sidebarOpen && (
          <div className="absolute inset-y-0 left-0 z-20 w-full max-w-sm shadow-2xl lg:static lg:w-auto lg:max-w-none lg:shadow-none">
            <CameraSidebar allCameras={planCameras} visibleCameras={visible} coverageRatio={coverage?.coveredRatio ?? null} />
          </div>
        )}

        <div className="relative min-w-0 flex-1">
          {!plan ? (
            <div className="grid h-full place-items-center p-6 text-center">
              <div>
                <p className="mb-3 text-muted">Este proyecto aún no tiene planos.</p>
                {canEdit && <button className="btn-primary" onClick={() => setModal('newPlan')}><Plus className="size-4" /> Crear plano</button>}
              </div>
            </div>
          ) : !plan.storage_key ? (
            canEdit ? <PlanUpload projectId={projectId} planId={plan.id} /> : <div className="grid h-full place-items-center text-muted">Plano sin imagen</div>
          ) : (
            <>
              <PlanCanvas
                plan={plan}
                cameras={visible}
                coverage={coverage}
                editable={canEdit}
                onCreate={onCreate}
                onUpdate={(id, patch) => updateCamera.mutate({ id, ...patch })}
              />
              {canEdit && <CameraPalette />}
              {editor.coverageMode !== 'none' && <CoverageLegend mode={editor.coverageMode} />}
            </>
          )}
        </div>

        {/* Ficha: panel derecho en escritorio, pantalla completa en móvil */}
        {selected && (
          <div className="absolute inset-0 z-30 sm:inset-y-0 sm:right-0 sm:left-auto sm:w-96 sm:shadow-2xl lg:static lg:shadow-none">
            <CameraSheet camera={selected} />
          </div>
        )}
      </div>

      {modal === 'newPlan' && (
        <PlanSettingsModal projectId={projectId} onClose={() => setModal(null)} onCreated={(p) => navigate(`/projects/${projectId}/plans/${p.id}`)} />
      )}
      {modal === 'planSettings' && plan && <PlanSettingsModal projectId={projectId} plan={plan} onClose={() => setModal(null)} />}
      {modal === 'nvr' && <NvrModal projectId={projectId} onClose={() => setModal(null)} />}
    </div>
  );
}

function CoverageLegend({ mode }: { mode: 'heatmap' | 'gaps' }) {
  return (
    <div className="panel pointer-events-none absolute right-14 bottom-3 px-3 py-2 text-xs">
      {mode === 'gaps' ? (
        <div className="flex items-center gap-2">
          <span className="size-3 rounded-sm" style={{ background: 'rgb(208 59 59 / 0.6)' }} /> Zona sin cobertura
        </div>
      ) : (
        <div>
          <div className="mb-1 text-muted">Cámaras que ven la zona</div>
          <div className="flex gap-2">
            {HEATMAP_LEGEND.map((l) => (
              <span key={l.label} className="flex items-center gap-1">
                <span className="size-3 rounded-sm" style={{ background: l.color }} />{l.label}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
