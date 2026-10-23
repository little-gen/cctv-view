import { useState, type FormEvent } from 'react';
import { useCreateNvr, useUpdateNvr } from '@/api/hooks';
import { ErrorText, Modal } from '@/components/ui/Modal';
import type { Nvr } from '@/types';

/** Alta o edición de un NVR. Los canales son obligatorios (salvo en NVR antiguos que aún no los tienen). */
export function NvrFormModal({ projectId, nvr, onClose, onSaved }: { projectId: string; nvr?: Nvr; onClose: () => void; onSaved?: (n: Nvr) => void }) {
  const create = useCreateNvr(projectId);
  const update = useUpdateNvr(projectId);
  const save = nvr ? update : create;
  const [form, setForm] = useState({
    name: nvr?.name ?? '',
    brand: nvr?.brand ?? '',
    model: nvr?.model ?? '',
    ip_address: nvr?.ip_address ?? '',
    channels: nvr?.channels ? String(nvr.channels) : '',
    location: nvr?.location ?? '',
    notes: nvr?.notes ?? '',
  });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const { channels, ...rest } = form;
    const body = { ...rest, ...(channels ? { channels: Number(channels) } : {}) };
    const saved = nvr ? await update.mutateAsync({ id: nvr.id, ...body }) : await create.mutateAsync(body);
    onSaved?.(saved);
    onClose();
  };

  return (
    <Modal title={nvr ? `Editar ${nvr.name}` : 'Nuevo NVR'} onClose={onClose} wide>
      <form onSubmit={submit} className="grid grid-cols-2 gap-3">
        <div className="col-span-2 sm:col-span-1">
          <label className="label" htmlFor="nvr-name">Nombre *</label>
          <input id="nvr-name" className="input" required maxLength={120} value={form.name} onChange={set('name')} placeholder="NVR Oficina" />
        </div>
        <div className="col-span-2 sm:col-span-1">
          <label className="label" htmlFor="nvr-channels">Número de canales *</label>
          <input
            id="nvr-channels"
            className="input"
            type="number"
            min={1}
            max={1024}
            required={!nvr || nvr.channels !== null}
            value={form.channels}
            onChange={set('channels')}
            placeholder={nvr && nvr.channels === null ? 'Sin definir' : '16'}
          />
        </div>
        <div>
          <label className="label" htmlFor="nvr-brand">Marca</label>
          <input id="nvr-brand" className="input" value={form.brand} onChange={set('brand')} placeholder="Hikvision, Dahua…" />
        </div>
        <div>
          <label className="label" htmlFor="nvr-model">Modelo</label>
          <input id="nvr-model" className="input" value={form.model} onChange={set('model')} />
        </div>
        <div>
          <label className="label" htmlFor="nvr-ip">Dirección IP</label>
          <input id="nvr-ip" className="input" value={form.ip_address} onChange={set('ip_address')} placeholder="192.168.1.10" />
        </div>
        <div>
          <label className="label" htmlFor="nvr-location">Ubicación</label>
          <input id="nvr-location" className="input" value={form.location} onChange={set('location')} placeholder="Rack sala técnica…" />
        </div>
        <div className="col-span-2">
          <label className="label" htmlFor="nvr-notes">Observaciones</label>
          <textarea id="nvr-notes" className="input" rows={3} value={form.notes} onChange={set('notes')} />
        </div>
        <div className="col-span-2">
          <ErrorText error={save.error} />
        </div>
        <div className="col-span-2 flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" disabled={save.isPending}>{nvr ? 'Guardar' : 'Crear NVR'}</button>
        </div>
      </form>
    </Modal>
  );
}
