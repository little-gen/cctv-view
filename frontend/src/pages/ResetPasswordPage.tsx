import { Cctv } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { api } from '@/api/client';
import { PasswordFields, passwordProblems } from '@/components/auth/PasswordFields';
import { ErrorText } from '@/components/ui/Modal';

/**
 * Página pública del enlace de restablecimiento que genera el administrador:
 * /restablecer#token=…  (el token va en el fragmento: el navegador no lo envía al servidor,
 * así que no queda en los logs ni en la cabecera Referer).
 */
export function ResetPasswordPage() {
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [doneEmail, setDoneEmail] = useState<string | null>(null);
  const problems = passwordProblems(password, confirm);

  // Quita el token de la barra de direcciones y del historial en cuanto se ha leído
  useEffect(() => {
    if (window.location.hash) history.replaceState(null, '', window.location.pathname);
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ email: string }>('/auth/reset-password', { method: 'POST', body: { token, password } });
      setDoneEmail(res.email);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid h-full place-items-center bg-page p-4">
      <div className="panel w-full max-w-sm space-y-4 p-6 shadow-2xl">
        <div className="flex items-center gap-2">
          <Cctv className="size-7 text-accent" />
          <div>
            <h1 className="text-lg font-semibold">Restablecer contraseña</h1>
            <p className="text-xs text-muted">PlanosCámaras</p>
          </div>
        </div>

        {doneEmail ? (
          <>
            <p className="text-sm text-ink-2">
              Contraseña guardada para <strong className="text-ink">{doneEmail}</strong>. Ya puedes iniciar sesión.
            </p>
            <Link to="/login" className="btn-primary w-full">Ir a iniciar sesión</Link>
          </>
        ) : !token ? (
          <>
            <p className="text-sm text-ink-2">
              El enlace no es válido. Pide al administrador que restablezca tu acceso y abre el enlace completo que te envíe.
            </p>
            <Link to="/login" className="btn-ghost w-full">Volver</Link>
          </>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <PasswordFields password={password} confirm={confirm} onPassword={setPassword} onConfirm={setConfirm} />
            <ErrorText error={error} />
            <button className="btn-primary w-full" disabled={busy || problems.length > 0}>
              {busy ? 'Guardando…' : 'Guardar contraseña'}
            </button>
            <p className="text-xs text-muted">El enlace solo se puede usar una vez y caduca a las 24 horas.</p>
          </form>
        )}
      </div>
    </div>
  );
}
