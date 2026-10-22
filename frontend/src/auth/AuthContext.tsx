import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, tokenStore } from '@/api/client';
import type { User } from '@/types';

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  /** Cierra la sesión también en el servidor (invalida los tokens de este usuario) */
  logout: () => Promise<void>;
  /** Cambia la propia contraseña; el servidor devuelve un token nuevo para esta sesión */
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  /** Puede crear/editar cámaras, planos, NVR y adjuntos */
  canEdit: boolean;
  isAdmin: boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(!!tokenStore.get());

  useEffect(() => {
    if (!tokenStore.get()) return;
    api<User>('/auth/me')
      .then(setUser)
      .catch(() => tokenStore.clear())
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const onLogout = () => setUser(null);
    // El servidor exige cambiar la contraseña (fijada por el administrador)
    const onPasswordChange = () => setUser((u) => (u ? { ...u, mustChangePassword: true } : u));
    window.addEventListener('auth:logout', onLogout);
    window.addEventListener('auth:password-change', onPasswordChange);
    return () => {
      window.removeEventListener('auth:logout', onLogout);
      window.removeEventListener('auth:password-change', onPasswordChange);
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api<{ token: string; user: User }>('/auth/login', { method: 'POST', body: { email, password } });
    tokenStore.set(res.token);
    setUser(res.user);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api<void>('/auth/logout', { method: 'POST' });
    } catch {
      // Sin conexión o sesión ya caducada: basta con olvidar el token local
    }
    tokenStore.clear();
    setUser(null);
  }, []);

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    const res = await api<{ token: string; user: User }>('/auth/change-password', {
      method: 'POST',
      body: { currentPassword, newPassword },
    });
    tokenStore.set(res.token);
    setUser(res.user);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      login,
      logout,
      changePassword,
      canEdit: user?.role === 'admin' || user?.role === 'tecnico',
      isAdmin: user?.role === 'admin',
    }),
    [user, loading, login, logout, changePassword],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
}
