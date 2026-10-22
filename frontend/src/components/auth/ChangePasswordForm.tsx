import { useState, type FormEvent } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { ErrorText } from '@/components/ui/Modal';
import { PasswordFields, passwordProblems } from './PasswordFields';

/** Cambio de la propia contraseña. Al terminar se cierran las demás sesiones del usuario. */
export function ChangePasswordForm({ onDone, submitLabel = 'Cambiar contraseña' }: { onDone?: () => void; submitLabel?: string }) {
  const { changePassword } = useAuth();
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const problems = passwordProblems(password, confirm);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await changePassword(current, password);
      onDone?.();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div>
        <label className="label" htmlFor="current-password">Contraseña actual</label>
        <input id="current-password" className="input" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
      </div>
      <PasswordFields password={password} confirm={confirm} onPassword={setPassword} onConfirm={setConfirm} />
      <ErrorText error={error} />
      <button className="btn-primary w-full" disabled={busy || problems.length > 0 || !current}>
        {busy ? 'Guardando…' : submitLabel}
      </button>
      <p className="text-xs text-muted">Por seguridad, se cerrará tu sesión en los demás dispositivos.</p>
    </form>
  );
}
