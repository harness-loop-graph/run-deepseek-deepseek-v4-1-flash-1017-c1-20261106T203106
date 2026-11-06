import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';

const HOME_BY_ROLE: Array<{ role: string; path: string }> = [
  { role: 'patient', path: '/bookings' },
  { role: 'professional', path: '/agenda' },
  { role: 'staff', path: '/agenda' },
  { role: 'admin', path: '/admin' },
];

function homeFor(roles: string[]): string | null {
  const match = HOME_BY_ROLE.find((entry) => roles.includes(entry.role));
  return match ? match.path : null;
}

/**
 * Role gate per route (RF-20). It complements the API guards: a role that is
 * not allowed to see a screen is sent to its own home screen instead of
 * rendering composition it cannot use.
 */
export function RoleRoute({
  roles,
  children,
}: {
  roles: string[];
  children: ReactNode;
}): JSX.Element {
  const { user } = useAuth();
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  if (!user.roles.some((role) => roles.includes(role))) {
    const home = homeFor(user.roles);
    return <Navigate to={home ?? '/login'} replace />;
  }
  return <>{children}</>;
}
