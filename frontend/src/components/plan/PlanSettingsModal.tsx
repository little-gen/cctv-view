import { useState, type FormEvent } from 'react';
import { useCreatePlan, useUpdatePlan } from '@/api/hooks';
import { ErrorText, Modal } from '@/components/ui/Modal';
import type { FloorPlan } from '@/types';
import { PlanUpload } from './PlanUpload';

/** Crear un plano nuevo o editar nombre/escala y sustituir la imagen de uno existente. */
export function PlanSettingsModal({ projectId, plan, onClose, onCreated }: {
  projectId: string;
  plan?: FloorPlan;
  onClose: () => void;
  onCreated?: (plan: FloorPlan) => void;
}) {
  const create = useCreatePlan(projectId);
  const update = useUpdatePlan(projectId);
  const [name, setName] = useState(plan?.name ?? '');
  const [widthM, setWidthM] = useState(String(plan?.width_m ?? 100));
  const [warning, setWarning] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const data = { name, width_m: Number(widthM) };
    if (plan) {
      await update.mutateAsync({ id: plan.id, ...data });
      onClose();
    } else {
      const created = await create.mutateAsync(data);
      onCreated?.(created);
      onClose();
    }
  };

  return (
    <Modal title={plan ? 'Configuración del plano' : 'Nuevo plano'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="label">Nombre</label>
          <input className="input" required placeholder="Nave 1 - Planta baja" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label">Ancho real que abarca la imagen (metros)</label>
          <input className="input" type="number" min={1} step="any" required value={widthM} onChange={(e) => setWidthM(e.target.value)} />
          <p className="mt-1 text-xs text-muted">Define la escala: se usa para dibujar el alcance de las cámaras en metros.</p>
        </div>
        <ErrorText error={create.error ?? update.error} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" disabled={create.isPending || update.isPending}>{plan ? 'Guardar' : 'Crear plano'}</button>
        </div>
      </form>

      {plan && (
        <div className="mt-5 border-t border-line pt-4">
          <h3 className="mb-1 text-sm font-medium">Sustituir imagen del plano</h3>
          <p className="mb-3 text-xs text-muted">
            Las cámaras conservan su posición relativa. La versión actual ({plan.version}) queda en el histórico.
          </p>
          <PlanUpload compact projectId={projectId} planId={plan.id} onDone={(w) => setWarning(w ?? 'Plano sustituido correctamente.')} />
          {warning && <p className="mt-2 text-sm text-amber-300">{warning}</p>}
        </div>
      )}
    </Modal>
  );
}
