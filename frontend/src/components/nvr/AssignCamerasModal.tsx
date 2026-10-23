import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useAssignToNvr } from '@/api/hooks';
import { CameraGlyph } from '@/components/cameras/CameraGlyph';
import { ErrorText, Modal } from '@/components/ui/Modal';
import type { NvrUsage } from '@/lib/nvr';
import { norm } from '@/lib/text';
import type { Camera, Nvr } from '@/types';

/**
 * Asociar cámaras existentes al NVR. Primero las que no tienen NVR; las de otro NVR
 * se pueden elegir también y se moverán. No deja elegir más que los canales libres.
 */
export function AssignCamerasModal({
  nvr,
  usage,
  cameras,
  planNames,
  onClose,
}: {
  nvr: Nvr;
  usage: NvrUsage;
  cameras: Camera[];
  planNames: Map<string, string>;
  onClose: () => void;
}) {
  const assign = useAssignToNvr(nvr.project_id);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const limit = usage.free; // null = capacidad sin definir

  const candidates = useMemo(() => {
    const nq = norm(q.trim());
    return cameras
      .filter((c) => c.nvr_id !== nvr.id)
      .filter((c) => !nq || norm(`${c.code} ${c.name} ${c.ip_address ?? ''} ${c.nvr_name ?? ''}`).includes(nq))
      .sort((a, b) => Number(!!a.nvr_id) - Number(!!b.nvr_id) || a.code.localeCompare(b.code));
  }, [cameras, nvr.id, q]);

  const full = limit !== null && picked.size >= limit;
  const toggle = (id: string) =>
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else if (!full) next.add(id);
      return next;
    });

  const submit = async () => {
    await assign.mutateAsync({ nvrId: nvr.id, cameraIds: [...picked] });
    onClose();
  };

  return (
    <Modal title={`Asociar cámaras a ${nvr.name}`} onClose={onClose} wide>
      <div className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-2 left-2.5 size-4 text-muted" />
          <input className="input pl-8" placeholder="Buscar por código, nombre, IP o NVR actual" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        </div>
        <p className={`text-sm ${full ? 'text-amber-300' : 'text-ink-2'}`} role="status">
          {picked.size} {picked.size === 1 ? 'seleccionada' : 'seleccionadas'}
          {limit !== null && ` · ${limit} ${limit === 1 ? 'canal libre' : 'canales libres'}`}
          {full && limit > 0 && ' · has llegado al límite de canales'}
        </p>
        <ul className="max-h-[50vh] divide-y divide-line overflow-auto rounded border border-line">
          {candidates.map((c) => {
            const checked = picked.has(c.id);
            return (
              <li key={c.id}>
                <label className={`flex items-center gap-3 px-3 py-2 text-sm ${!checked && full ? 'opacity-50' : 'cursor-pointer hover:bg-surface-2'}`}>
                  <input type="checkbox" className="accent-accent" checked={checked} disabled={!checked && full} onChange={() => toggle(c.id)} />
                  <CameraGlyph type={c.type} status={c.status} size={18} />
                  <span className="w-20 shrink-0 text-xs text-muted">{c.code}</span>
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  <span className="hidden shrink-0 text-xs text-muted sm:inline">{planNames.get(c.floor_plan_id)}</span>
                  <span className={`shrink-0 text-xs ${c.nvr_id ? 'text-amber-300' : 'text-muted'}`}>
                    {c.nvr_id ? `se moverá desde ${c.nvr_name}` : 'sin NVR'}
                  </span>
                </label>
              </li>
            );
          })}
          {candidates.length === 0 && <li className="p-4 text-center text-sm text-muted">No hay cámaras que asociar</li>}
        </ul>
        <ErrorText error={assign.error} />
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" disabled={!picked.size || assign.isPending} onClick={submit}>
            Asociar {picked.size || ''}
          </button>
        </div>
      </div>
    </Modal>
  );
}
