import { Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useSaveUser, useUsers } from '@/api/hooks';
import { ErrorText, Modal } from '@/components/ui/Modal';
import type { Role, User } from '@/types';

const ROLES: { value: Role; label: string; hint: string }[] = [
  { value: 'admin', label: 'Administrador', hint: 'Acceso total, usuarios y auditoría' },
  { value: 'tecnico', label: 'Técnico', hint: 'Edita planos, cámaras, NVR y adjuntos' },
  { value: 'lectura', label: 'Solo lectura', hint: 'Consulta y exporta' },
];

export function UsersPage() {
  const { data: users } = useUsers();
  const save = useSaveUser();
  const [editing, setEditing] = useState<Partial<User> | null>(null);

  return (
    <div className="mx-auto h-full max-w-4xl overflow-auto p-4 sm:p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Usuarios</h1>
        <button className="btn-primary" onClick={() => setEditing({ role: 'tecnico' })}><Plus className="size-4" /> Nuevo usuario</button>
      </div>
      <div className="panel overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted">
            <tr className="border-b border-line">
              <th className="p-3">Nombre</th><th className="p-3">Correo</th><th className="p-3">Rol</th><th className="p-3">Último acceso</th><th className="p-3">Estado</th><th />
            </tr>
          </thead>
          <tbody>
            {users?.map((u) => (
              <tr key={u.id} className="border-b border-line last:border-0">
                <td className="p-3">{u.name}</td>
                <td className="p-3 text-ink-2">{u.email}</td>
                <td className="p-3">{ROLES.find((r) => r.value === u.role)?.label}</td>
                <td className="p-3 text-ink-2 tabular-nums">{u.last_login_at ? new Date(u.last_login_at).toLocaleString('es-ES') : '—'}</td>
                <td className="p-3">{u.active ? 'Activo' : <span className="text-muted">Inactivo</span>}</td>
                <td className="p-3 text-right">
                  <button className="btn-ghost text-xs" onClick={() => setEditing(u)}>Editar</button>
                  <button className="btn-ghost text-xs" onClick={() => save.mutate({ id: u.id, active: !u.active })}>
                    {u.active ? 'Desactivar' : 'Activar'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ErrorText error={save.error} />
      {editing && <UserModal user={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function UserModal({ user, onClose }: { user: Partial<User>; onClose: () => void }) {
  const save = useSaveUser();
  const [form, setForm] = useState({ name: user.name ?? '', email: user.email ?? '', role: user.role ?? 'tecnico', password: '' });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const { password, ...rest } = form;
    await save.mutateAsync({ id: user.id, ...rest, ...(password ? { password } : {}) });
    onClose();
  };

  return (
    <Modal title={user.id ? 'Editar usuario' : 'Nuevo usuario'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div><label className="label">Nombre</label><input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
        <div><label className="label">Correo</label><input className="input" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
        <div>
          <label className="label">Rol</label>
          <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
            {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label} — {r.hint}</option>)}
          </select>
        </div>
        <div>
          <label className="label">{user.id ? 'Nueva contraseña (opcional)' : 'Contraseña'}</label>
          <input className="input" type="password" minLength={8} required={!user.id} autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </div>
        <ErrorText error={save.error} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" disabled={save.isPending}>Guardar</button>
        </div>
      </form>
    </Modal>
  );
}
