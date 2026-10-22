import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { useAuth } from './auth/AuthContext';
import { AppShell } from './components/layout/AppShell';
import { AuditPage } from './pages/AuditPage';
import { ForcePasswordChangePage } from './pages/ForcePasswordChangePage';
import { LoginPage } from './pages/LoginPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { UsersPage } from './pages/UsersPage';
import { WorkspacePage } from './pages/WorkspacePage';

function RequireAuth({ children, admin }: { children: ReactNode; admin?: boolean }) {
  const { user, loading, isAdmin } = useAuth();
  const location = useLocation();
  if (loading) return <div className="grid h-full place-items-center text-muted">Cargando…</div>;
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  // Contraseña temporal fijada por el administrador: hay que cambiarla antes de seguir
  if (user.mustChangePassword) return <ForcePasswordChangePage />;
  if (admin && !isAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/restablecer" element={<ResetPasswordPage />} />
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<ProjectsPage />} />
        <Route path="projects/:projectId" element={<WorkspacePage />} />
        <Route path="projects/:projectId/plans/:planId" element={<WorkspacePage />} />
        <Route path="admin/users" element={<RequireAuth admin><UsersPage /></RequireAuth>} />
        <Route path="admin/audit" element={<RequireAuth admin><AuditPage /></RequireAuth>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
