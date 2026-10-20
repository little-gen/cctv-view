import { AlertTriangle, Building2, Cctv, Map, Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useCreateProject, useProjects } from '@/api/hooks';
import { useAuth } from '@/auth/AuthContext';
import { ErrorText, Modal } from '@/components/ui/Modal';

export function ProjectsPage() {
  const { data: projects, isLoading } = useProjects();
  const { isAdmin } = useAuth();
  const [creating, setCreating] = useState(false);

  return (
    <div className="mx-auto h-full max-w-6xl overflow-auto p-4 sm:p-6">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Proyectos</h1>
          <p className="text-sm text-muted">Ubicaciones e instalaciones documentadas</p>
        </div>
        {isAdmin && (
          <button className="btn-primary" onClick={() => setCreating(true)}>
            <Plus className="size-4" /> Nuevo proyecto
          </button>
        )}
      </div>

      {isLoading && <p className="text-muted">Cargando…</p>}
      {projects?.length === 0 && (
        <div className="panel p-8 text-center text-muted">
          Todavía no hay proyectos. {isAdmin ? 'Crea el primero para empezar.' : 'Pide a un administrador que cree uno.'}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {projects?.map((p) => (
          <Link key={p.id} to={`/projects/${p.id}`} className="panel group p-4 transition-colors hover:border-accent">
            <div className="flex items-start gap-3">
              <Building2 className="mt-0.5 size-5 shrink-0 text-muted group-hover:text-accent" />
              <div className="min-w-0">
                <h2 className="truncate font-medium">{p.name}</h2>
                <p className="truncate text-sm text-muted">{[p.client, p.address].filter(Boolean).join(' · ') || '—'}</p>
              </div>
            </div>
            <div className="mt-4 flex gap-4 text-sm text-ink-2">
              <span className="inline-flex items-center gap-1"><Map className="size-4" /> {p.plan_count} planos</span>
              <span className="inline-flex items-center gap-1"><Cctv className="size-4" /> {p.camera_count} cámaras</span>
              {!!p.broken_count && (
                <span className="inline-flex items-center gap-1 text-red-300">
                  <AlertTriangle className="size-4" /> {p.broken_count} averiadas
                </span>
              )}
            </div>
          </Link>
        ))}
      </div>

      {creating && <CreateProjectModal onClose={() => setCreating(false)} />}
    </div>
  );
}

function CreateProjectModal({ onClose }: { onClose: () => void }) {
  const create = useCreateProject();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', client: '', address: '', description: '' });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const p = await create.mutateAsync(form);
    navigate(`/projects/${p.id}`);
  };

  return (
    <Modal title="Nuevo proyecto" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div><label className="label">Nombre *</label><input className="input" required value={form.name} onChange={set('name')} /></div>
        <div><label className="label">Cliente</label><input className="input" value={form.client} onChange={set('client')} /></div>
        <div><label className="label">Dirección</label><input className="input" value={form.address} onChange={set('address')} /></div>
        <div><label className="label">Descripción</label><textarea className="input" rows={3} value={form.description} onChange={set('description')} /></div>
        <ErrorText error={create.error} />
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" disabled={create.isPending}>Crear</button>
        </div>
      </form>
    </Modal>
  );
}
