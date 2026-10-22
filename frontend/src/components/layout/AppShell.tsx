import { Cctv, History, KeyRound, Lock, LogOut, Users } from 'lucide-react';
import { useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router';
import { useLockedUsers } from '@/api/hooks';
import { useAuth } from '@/auth/AuthContext';
import { ChangePasswordForm } from '@/components/auth/ChangePasswordForm';
import { GlobalSearch } from '@/components/search/GlobalSearch';
import { Modal } from '@/components/ui/Modal';

const ROLE_LABEL = { admin: 'Administrador', tecnico: 'Técnico', lectura: 'Solo lectura' } as const;

export function AppShell() {
  const { user, logout, isAdmin } = useAuth();
  const [changingPassword, setChangingPassword] = useState(false);
  const locked = useLockedUsers(isAdmin);
  const navCls = ({ isActive }: { isActive: boolean }) =>
    `btn-ghost px-2 ${isActive ? 'bg-surface-3 text-ink' : ''}`;

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-surface px-3">
        <Link to="/" className="flex shrink-0 items-center gap-2 font-semibold tracking-tight">
          <Cctv className="size-5 text-accent" />
          <span className="hidden lg:inline">PlanosCámaras</span>
        </Link>
        <GlobalSearch />
        <nav className="flex shrink-0 items-center gap-1">
          {isAdmin && (
            <>
              <NavLink to="/admin/users" className={navCls} title="Usuarios">
                <Users className="size-4" />
                <span className="hidden xl:inline">Usuarios</span>
              </NavLink>
              {locked.length > 0 && (
                <NavLink
                  to="/admin/users"
                  className="inline-flex items-center gap-1 rounded-full bg-crit/20 px-2 py-0.5 text-xs font-medium text-red-200 hover:bg-crit/30"
                  title={`Cuentas bloqueadas por intentos fallidos: ${locked.map((u) => u.email).join(', ')}`}
                  aria-label={`${locked.length} ${locked.length === 1 ? 'cuenta bloqueada' : 'cuentas bloqueadas'}`}
                >
                  <Lock className="size-3" aria-hidden />
                  {locked.length}
                  <span className="hidden sm:inline">{locked.length === 1 ? 'bloqueada' : 'bloqueadas'}</span>
                </NavLink>
              )}
              <NavLink to="/admin/audit" className={navCls} title="Auditoría">
                <History className="size-4" />
                <span className="hidden xl:inline">Auditoría</span>
              </NavLink>
            </>
          )}
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-2 text-sm">
          <div className="hidden text-right leading-tight xl:block">
            <div className="text-ink">{user?.name}</div>
            <div className="text-xs text-muted">{user && ROLE_LABEL[user.role]}</div>
          </div>
          <button className="btn-ghost px-2" onClick={() => setChangingPassword(true)} title="Cambiar contraseña" aria-label="Cambiar contraseña">
            <KeyRound className="size-4" />
          </button>
          <button className="btn-ghost px-2" onClick={logout} title="Cerrar sesión" aria-label="Cerrar sesión">
            <LogOut className="size-4" />
          </button>
        </div>
      </header>
      {changingPassword && (
        <Modal title="Cambiar contraseña" onClose={() => setChangingPassword(false)}>
          <ChangePasswordForm onDone={() => setChangingPassword(false)} />
        </Modal>
      )}
      <main className="min-h-0 flex-1">
        <Outlet />
      </main>
    </div>
  );
}
