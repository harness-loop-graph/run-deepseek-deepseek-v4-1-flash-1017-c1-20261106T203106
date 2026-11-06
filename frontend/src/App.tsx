import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthProvider';
import AppLayout from './components/AppLayout';
import { Loading } from './components/states';
import { RequireAuth } from './routes/RequireAuth';
import { RoleRoute } from './routes/RoleRoute';
import LoginScreen from './screens/SCR01Login';
import AuthCallbackScreen from './screens/SCR01Callback';
import PatientBookingsScreen from './screens/SCR02PatientBookings';
import AvailabilitySearchScreen from './screens/SCR03AvailabilitySearch';
import AgendaScreen from './screens/SCR04Agenda';
import AppointmentDetailScreen from './screens/SCR05AppointmentDetail';
import ClinicalHistoryScreen from './screens/SCR06ClinicalHistory';
import AdminScreen from './screens/SCR07Admin';
import AuditScreen from './screens/SCR08Audit';
import { ForbiddenNotice } from './components/ForbiddenNotice';

export function homeRouteFor(roles: string[]): string {
  if (roles.includes('patient')) {
    return '/bookings';
  }
  if (roles.includes('professional') || roles.includes('staff')) {
    return '/agenda';
  }
  if (roles.includes('admin')) {
    return '/admin';
  }
  return '/forbidden';
}

function HomeRedirect(): JSX.Element {
  const { user, ready } = useAuth();
  if (!ready) {
    return <Loading label="Loading your workspace…" />;
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return <Navigate to={homeRouteFor(user.roles)} replace />;
}

export default function App(): JSX.Element {
  return (
    <Routes>
      <Route path="/login" element={<LoginScreen />} />
      <Route path="/auth/callback" element={<AuthCallbackScreen />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route index element={<HomeRedirect />} />
        <Route
          path="bookings"
          element={
            <RoleRoute roles={['patient']}>
              <PatientBookingsScreen />
            </RoleRoute>
          }
        />
        <Route
          path="search"
          element={
            <RoleRoute roles={['patient', 'staff']}>
              <AvailabilitySearchScreen />
            </RoleRoute>
          }
        />
        <Route
          path="agenda"
          element={
            <RoleRoute roles={['professional', 'staff']}>
              <AgendaScreen />
            </RoleRoute>
          }
        />
        <Route
          path="appointments/:id"
          element={
            <RoleRoute roles={['patient', 'professional']}>
              <AppointmentDetailScreen />
            </RoleRoute>
          }
        />
        <Route
          path="history"
          element={
            <RoleRoute roles={['patient', 'professional']}>
              <ClinicalHistoryScreen />
            </RoleRoute>
          }
        />
        <Route
          path="history/:patientId"
          element={
            <RoleRoute roles={['patient', 'professional']}>
              <ClinicalHistoryScreen />
            </RoleRoute>
          }
        />
        <Route
          path="admin"
          element={
            <RoleRoute roles={['admin']}>
              <AdminScreen />
            </RoleRoute>
          }
        />
        <Route
          path="audit"
          element={
            <RoleRoute roles={['admin']}>
              <AuditScreen />
            </RoleRoute>
          }
        />
        <Route path="forbidden" element={<ForbiddenNotice />} />
        <Route path="*" element={<ForbiddenNotice />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
