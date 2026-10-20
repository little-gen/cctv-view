import { Server, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useCreateNvr, useDeleteNvr, useNvrs } from '@/api/hooks';
import { useAuth } from '@/auth/AuthContext';
import { ErrorText, Modal } from '@/components/ui/Modal';

export function NvrModal({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const { canEdit } = useAuth();
  const { data: nvrs } = useNvrs(projectId);
  const create = useCreateNvr(projectId);
  const remove = useDeleteNvr(projectId);
  const empty = { name: '', brand: '', model: '', ip_address: '', channels: '', location: '' };
  const [form, setForm] = useState(empty);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await create.mutateAsync({ ...form, channels: form.channels ? Number(form.channels) : null });
    setForm(empty);
  };

  return (
    <Modal title="Grabadores (NVR)" onClose={onClose} wide>
      <ul className="mb-4 divide-y divide-line rounded border border-line">
        {nvrs?.map((n) => (
          <li key={n.id} className="flex items-center gap-3 px-3 py-2 text-sm">
            <Server className="size-4 text-muted" />
            <div className="min-w-0 flex-1">
              <div>{n.name} <span className="text-muted">{[n.brand, n.model].filter(Boolean).join(' ')}</span></div>
              <div className="text-xs text-muted">{n.ip_address ?? 'sin IP'} · {n.camera_count} cámaras{n.channels ? ` / ${n.channels} canales` : ''} {n.location ? `· ${n.location}` : ''}</div>
            </div>
            {canEdit && (
              <button className="btn-ghost px-1.5" onClick={() => confirm(`¿Eliminar ${n.name}?`) && remove.mutate(n.id)} aria-label="Eliminar NVR">
                <Trash2 className="size-4" />
              </button>
            )}
          </li>
        ))}
        {nvrs?.length === 0 && <li className="px-3 py-4 text-center text-sm text-muted">No hay NVR registrados</li>}
      </ul>

      {canEdit && (
        <form onSubmit={submit} className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <input className="input" placeholder="Nombre *" required value={form.name} onChange={set('name')} />
          <input className="input" placeholder="Marca" value={form.brand} onChange={set('brand')} />
          <input className="input" placeholder="Modelo" value={form.model} onChange={set('model')} />
          <input className="input" placeholder="IP" value={form.ip_address} onChange={set('ip_address')} />
          <input className="input" placeholder="Canales" type="number" min={1} value={form.channels} onChange={set('channels')} />
          <input className="input" placeholder="Ubicación (rack, sala…)" value={form.location} onChange={set('location')} />
          <div className="col-span-full flex items-center justify-between">
            <ErrorText error={create.error} />
            <button className="btn-primary ml-auto" disabled={create.isPending}>Añadir NVR</button>
          </div>
        </form>
      )}
    </Modal>
  );
}
