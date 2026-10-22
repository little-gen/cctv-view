import { Check, Copy, KeyRound, Lock, Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useResetUserAccess, useSaveUser, useUnlockUser, useUsers } from '@/api/hooks';
import { useAuth } from '@/auth/AuthContext';
import { PASSWORD_MIN } from '@/components/auth/PasswordFields';
import { ErrorText, Modal } from '@/components/ui/Modal';
import type { Role, User } from '@/types';

const ROLES: { value: Role; label: string; hint: string }[] = [
  { value: 'admin', label: 'Administrador', hint: 'Acceso total, usuarios y auditoría' },
  { value: 'tecnico', label: 'Técnico', hint: 'Edita planos, cámaras, NVR y adjuntos' },
  { value: 'lectura', label: 'Solo lectura', hint: 'Consulta y exporta' },
];

export function UsersPage() {
  const { user: me } = useAuth();
  const { data: users } = useUsers();
  const save = useSaveUser();
  const unlock = useUnlockUser();
  const [editing, setEditing] = useState<Partial<User> | null>(null);
  const [resetting, setResetting] = useState<User | null>(null);
  const lockedUsers = (users ?? []).filter((u) => u.locked_until && new Date(u.locked_until) > new Date());

  return (
    <div className="mx-auto h-full max-w-5xl overflow-auto p-4 sm:p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Usuarios</h1>
        <button className="btn-primary" onClick={() => setEditing({ role: 'tecnico' })}><Plus className="size-4" /> Nuevo usuario</button>
      </div>
      {lockedUsers.length > 0 && (
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-crit/40 bg-crit/10 p-3 text-sm" role="status">
          <Lock className="mt-0.5 size-4 shrink-0 text-red-300" aria-hidden />
          <div>
            <p className="font-medium text-ink">
              {lockedUsers.length === 1 ? '1 cuenta bloqueada' : `${lockedUsers.length} cuentas bloqueadas`} por intentos fallidos:{' '}
              {lockedUsers.map((u) => u.name).join(', ')}
            </p>
            <p className="mt-0.5 text-xs text-ink-2">
              Se desbloquean solas pasado el tiempo indicado. Si el usuario ha olvidado la contraseña, usa «Restablecer acceso»; si
              no reconoce los intentos, revisa <Link to="/admin/audit" className="underline">Auditoría</Link> (accesos fallidos).
            </p>
          </div>
        </div>
      )}
      <div className="panel overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted">
            <tr className="border-b border-line">
              <th className="p-3">Nombre</th><th className="p-3">Correo</th><th className="p-3">Rol</th><th className="p-3">Último acceso</th><th className="p-3">Estado</th><th />
            </tr>
          </thead>
          <tbody>
            {users?.map((u) => (
              <tr key={u.id} className="border-b border-line align-top last:border-0">
                <td className="p-3">{u.name}</td>
                <td className="p-3 text-ink-2">{u.email}</td>
                <td className="p-3">{ROLES.find((r) => r.value === u.role)?.label}</td>
                <td className="p-3 text-ink-2 tabular-nums">{u.last_login_at ? new Date(u.last_login_at).toLocaleString('es-ES') : '—'}</td>
                <td className="p-3">
                  <div>{u.active ? 'Activo' : <span className="text-muted">Inactivo</span>}</div>
                  {u.locked_until && (
                    <div className="mt-0.5 inline-flex items-center gap-1 text-xs text-red-300">
                      <Lock className="size-3" aria-hidden /> Bloqueado hasta {new Date(u.locked_until).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  )}
                  {u.reset_pending && <div className="mt-0.5 text-xs text-muted">Enlace de restablecimiento pendiente</div>}
                  {u.must_change_password && !u.reset_pending && <div className="mt-0.5 text-xs text-muted">Debe cambiar la contraseña</div>}
                </td>
                <td className="p-3 text-right whitespace-nowrap">
                  <button className="btn-ghost text-xs" onClick={() => setEditing(u)}>Editar</button>
                  {u.id !== me?.id && u.active && (
                    <button className="btn-ghost text-xs" onClick={() => setResetting(u)} title="Genera un enlace de un solo uso para que elija contraseña">
                      <KeyRound className="size-3.5" /> Restablecer acceso
                    </button>
                  )}
                  {u.locked_until && (
                    <button className="btn-ghost text-xs" onClick={() => unlock.mutate(u.id)}>Desbloquear</button>
                  )}
                  {u.id !== me?.id && (
                    <button className="btn-ghost text-xs" onClick={() => save.mutate({ id: u.id, active: !u.active })}>
                      {u.active ? 'Desactivar' : 'Activar'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ErrorText error={save.error ?? unlock.error} />
      {editing && <UserModal user={editing} onClose={() => setEditing(null)} />}
      {resetting && <ResetAccessModal user={resetting} onClose={() => setResetting(null)} />}
    </div>
  );
}

function UserModal({ user, onClose }: { user: Partial<User>; onClose: () => void }) {
  const { user: me } = useAuth();
  const save = useSaveUser();
  const [form, setForm] = useState({ name: user.name ?? '', email: user.email ?? '', role: user.role ?? 'tecnico', password: '' });
  const self = user.id === me?.id;

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
          <select className="input" value={form.role} disabled={self} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
            {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label} — {r.hint}</option>)}
          </select>
        </div>
        {!self && (
          <div>
            <label className="label">{user.id ? 'Contraseña temporal (opcional)' : 'Contraseña temporal'}</label>
            <input
              className="input"
              type="password"
              minLength={PASSWORD_MIN}
              required={!user.id}
              autoComplete="new-password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
            <p className="mt-1 text-xs text-muted">
              Mínimo {PASSWORD_MIN} caracteres. El usuario deberá cambiarla al entrar. Mejor que fijar una contraseña:
              «Restablecer acceso», que genera un enlace para que la elija él.
            </p>
          </div>
        )}
        <ErrorText error={save.error} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" disabled={save.isPending}>Guardar</button>
        </div>
      </form>
    </Modal>
  );
}

/** Genera el enlace de un solo uso y lo muestra una única vez para entregárselo al usuario. */
function ResetAccessModal({ user, onClose }: { user: User; onClose: () => void }) {
  const reset = useResetUserAccess();
  const [copied, setCopied] = useState(false);
  const result = reset.data;

  const copy = async () => {
    if (!result) return;
    await navigator.clipboard.writeText(result.url);
    setCopied(true);
  };

  return (
    <Modal title="Restablecer acceso" onClose={onClose}>
      {!result ? (
        <div className="space-y-3 text-sm">
          <p className="text-ink-2">
            Se generará un enlace de un solo uso, válido 24 horas, para que <strong className="text-ink">{user.name}</strong> ({user.email}) elija una
            contraseña nueva.
          </p>
          <ul className="list-disc space-y-1 pl-5 text-xs text-muted">
            <li>Se cerrarán todas sus sesiones abiertas y se quitará el bloqueo si lo tiene.</li>
            <li>Su contraseña actual deja de valer cuando use el enlace.</li>
            <li>Entrégaselo por un canal privado (Teams o correo interno), nunca en un canal compartido.</li>
          </ul>
          <ErrorText error={reset.error} />
          <div className="flex justify-end gap-2">
            <button className="btn-ghost" onClick={onClose}>Cancelar</button>
            <button className="btn-primary" disabled={reset.isPending} onClick={() => reset.mutate(user.id)}>
              <KeyRound className="size-4" /> Generar enlace
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          <p className="text-ink-2">Enlace para {result.email}. <strong className="text-ink">Solo se muestra ahora</strong>: cópialo antes de cerrar.</p>
          <div className="flex gap-2">
            <input className="input font-mono text-xs" readOnly value={result.url} onFocus={(e) => e.target.select()} aria-label="Enlace de restablecimiento" />
            <button className="btn-primary shrink-0 px-2" onClick={copy} aria-label="Copiar enlace">
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            </button>
          </div>
          <p className="text-xs text-muted">Caduca el {new Date(result.expiresAt).toLocaleString('es-ES')}.</p>
          <div className="flex justify-end">
            <button className="btn-ghost" onClick={onClose}>Cerrar</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
