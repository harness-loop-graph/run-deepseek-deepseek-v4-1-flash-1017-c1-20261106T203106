import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';

interface NavItem {
  testId: string;
  label: string;
  to: string;
}

const ITEMS: Record<string, NavItem> = {
  bookings: { testId: 'nav-bookings', label: 'My appointments', to: '/bookings' },
  search: { testId: 'nav-search', label: 'Book a slot', to: '/search' },
  agenda: { testId: 'nav-agenda', label: 'Agenda', to: '/agenda' },
  history: { testId: 'nav-history', label: 'Clinical history', to: '/history' },
  admin: { testId: 'nav-admin', label: 'Administration', to: '/admin' },
  audit: { testId: 'nav-audit', label: 'Audit log', to: '/audit' },
};

export function navigationFor(roles: string[]): NavItem[] {
  const items: NavItem[] = [];
  const has = (role: string) => roles.includes(role);
  if (has('patient')) {
    items.push(ITEMS.bookings, ITEMS.search, ITEMS.history);
  }
  if (has('professional')) {
    items.push(ITEMS.agenda, ITEMS.history);
  }
  if (has('staff')) {
    items.push(ITEMS.agenda, ITEMS.search);
  }
  if (has('admin')) {
    items.push(ITEMS.admin, ITEMS.audit);
  }
  const unique = items.filter(
    (item, index) => items.findIndex((other) => other.testId === item.testId) === index,
  );
  // Staff never gets clinical navigation (RF-10), unless the same account is
  // also a patient, in which case it only reaches its own history.
  if (has('staff') && !has('patient')) {
    return unique.filter((item) => item.testId !== 'nav-history');
  }
  return unique;
}

export default function AppLayout(): JSX.Element {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const items = navigationFor(user?.roles ?? []);

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            ✚
          </span>
          <span>MedApp</span>
        </div>
        <nav className="main-nav" aria-label="Main">
          {items.map((item) => (
            <NavLink
              key={item.testId}
              to={item.to}
              data-testid={item.testId}
              className={({ isActive }) => (isActive ? 'active' : undefined)}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="session-box">
          <span className="session-email" title={user?.email}>
            {user?.email}
          </span>
          <span className="session-roles">{user?.roles.join(', ')}</span>
          <button type="button" className="button secondary" onClick={handleLogout}>
            Sign out
          </button>
        </div>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
