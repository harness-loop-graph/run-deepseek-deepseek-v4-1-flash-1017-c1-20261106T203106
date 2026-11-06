import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { Loading } from '../components/states';

/**
 * Protected routing (RF-20): unauthenticated access to any SCR-02..08 redirects
 * to SCR-01. The API independently re-checks every operation.
 */
export function RequireAuth({ children }: { children: ReactNode }): JSX.Element {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready) {
    return <Loading label="Restoring your session…" />;
  }
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}
