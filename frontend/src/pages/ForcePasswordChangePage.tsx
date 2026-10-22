import { Cctv, KeyRound } from 'lucide-react';
import { useAuth } from '@/auth/AuthContext';
import { ChangePasswordForm } from '@/components/auth/ChangePasswordForm';

/** Pantalla obligatoria cuando el administrador ha fijado una contraseña temporal. */
export function ForcePasswordChangePage() {
  const { user, logout } = useAuth();
  return (
    <div className="grid h-full place-items-center bg-page p-4">
      <div className="panel w-full max-w-sm space-y-4 p-6 shadow-2xl">
        <div className="flex items-center gap-2">
          <Cctv className="size-7 text-accent" />
          <div>
            <h1 className="flex items-center gap-1.5 text-lg font-semibold"><KeyRound className="size-4" /> Elige tu contraseña</h1>
            <p className="text-xs text-muted">{user?.email}</p>
          </div>
        </div>
        <p className="text-sm text-ink-2">
          Tu contraseña actual es temporal. Para continuar, cámbiala por una que solo conozcas tú.
        </p>
        <ChangePasswordForm submitLabel="Guardar y continuar" />
        <button className="btn-ghost w-full text-xs" onClick={logout}>Salir</button>
      </div>
    </div>
  );
}
