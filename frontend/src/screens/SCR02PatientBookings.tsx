import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest, describeError } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import {
  EmptyState,
  ErrorBanner,
  Loading,
  StatusBadge,
  formatDateTime,
} from '../components/states';
import type { Appointment } from '../types';

export default function PatientBookingsScreen(): JSX.Element {
  const { withToken } = useAuth();
  const [appointments, setAppointments] = useState<Appointment[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await withToken((token) =>
        apiRequest<Appointment[]>('/me/appointments', { token }),
      );
      setAppointments(data);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setLoading(false);
    }
  }, [withToken]);

  useEffect(() => {
    void load();
  }, [load]);

  async function cancelAppointment(id: number) {
    setCancelling(id);
    setActionError(null);
    try {
      await withToken((token) =>
        apiRequest<void>(`/appointments/${id}`, { method: 'DELETE', token }),
      );
      await load();
    } catch (cause) {
      setActionError(describeError(cause));
    } finally {
      setCancelling(null);
    }
  }

  return (
    <section className="screen">
      <header className="screen-header">
        <div>
          <h1>My appointments</h1>
          <p className="screen-subtitle">
            Your scheduled, attended and cancelled appointments.
          </p>
        </div>
        <Link className="button primary" to="/search">
          Book a new slot
        </Link>
      </header>

      {actionError ? <ErrorBanner message={actionError} /> : null}
      {loading ? <Loading label="Loading your appointments…" /> : null}
      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}
      {!loading && !error && appointments !== null && appointments.length === 0 ? (
        <EmptyState message="You have no appointments yet. Book your first slot." />
      ) : null}

      {!loading && !error && appointments && appointments.length > 0 ? (
        <ul className="appointment-list">
          {appointments.map((appointment) => (
            <li
              key={appointment.id}
              className="card appointment-item"
              data-testid="appointment-item"
              data-appointment-id={appointment.id}
            >
              <div className="appointment-main">
                <Link
                  className="appointment-title"
                  to={`/appointments/${appointment.id}`}
                >
                  {formatDateTime(appointment.start)}
                </Link>
                <p className="appointment-meta">
                  {appointment.professionalName} · {appointment.specialty}
                </p>
              </div>
              <div className="appointment-side">
                <StatusBadge status={appointment.status} />
                <button
                  type="button"
                  className="button danger"
                  data-testid="cancel-appointment"
                  disabled={
                    cancelling === appointment.id ||
                    appointment.status !== 'scheduled'
                  }
                  onClick={() => void cancelAppointment(appointment.id)}
                >
                  {cancelling === appointment.id ? 'Cancelling…' : 'Cancel'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
