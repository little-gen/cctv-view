import { Server, X } from 'lucide-react';
import { Link } from 'react-router';
import { NVR_RING } from '@/components/plan/CameraMarker';
import { inNvrGroup, NO_NVR } from '@/lib/nvr';
import { useEditor } from '@/store/editorStore';
import type { Camera, Nvr } from '@/types';

/** Barra sobre el plano mientras hay un NVR resaltado: recuento, "solo estas" y cerrar. */
export function NvrHighlightBar({ groupId, nvrs, cameras, onPlan, projectId }: {
  groupId: string;
  nvrs: Nvr[];
  cameras: Camera[];
  onPlan: number;
  projectId: string;
}) {
  const { nvrOnly, setNvrOnly, highlightNvr } = useEditor();
  const nvr = nvrs.find((n) => n.id === groupId);
  const total = cameras.filter((c) => inNvrGroup(c, groupId)).length;
  const name = groupId === NO_NVR ? 'Cámaras sin NVR' : (nvr?.name ?? 'NVR');

  return (
    <div className="panel absolute top-3 right-3 left-16 z-10 flex flex-wrap sm:right-auto sm:left-1/2 sm:max-w-[calc(100%-9rem)] sm:-translate-x-1/2 items-center gap-x-3 gap-y-1 px-3 py-2 text-sm shadow-xl" role="status">
      <span className="flex items-center gap-2 font-medium">
        <span className="size-3 rounded-full border-[3px]" style={{ borderColor: NVR_RING }} aria-hidden />
        {nvr ? (
          <Link to={`/projects/${projectId}/nvrs/${nvr.id}`} className="inline-flex items-center gap-1 hover:underline">
            <Server className="size-3.5 text-muted" />{name}
          </Link>
        ) : name}
      </span>
      <span className="text-xs text-muted">
        {onPlan} en este plano{total > onPlan ? ` · ${total - onPlan} en otros planos` : ''}
      </span>
      <label className="flex cursor-pointer items-center gap-1.5 text-xs text-ink-2">
        <input type="checkbox" className="accent-accent" checked={nvrOnly} onChange={(e) => setNvrOnly(e.target.checked)} />
        Mostrar solo estas
      </label>
      <button className="btn-ghost px-1" onClick={() => highlightNvr(null)} aria-label="Quitar resaltado">
        <X className="size-4" />
      </button>
    </div>
  );
}
