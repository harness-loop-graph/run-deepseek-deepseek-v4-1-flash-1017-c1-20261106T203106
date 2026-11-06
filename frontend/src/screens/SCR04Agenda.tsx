import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiRequest, describeError } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import {
  EmptyState,
  ErrorBanner,
  Loading,
  StatusBadge,
  formatDate,
  formatDateTime,
} from '../components/states';
import type { Agenda, Appointment, Professional } from '../types';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

type ViewMode = 'day' | 'week';

export default function AgendaScreen(): JSX.Element {
  const { withToken, user } = useAuth();
  const navigate = useNavigate();
  const isProfessional = user?.roles.includes('professional') ?? false;
  const [from, setFrom] = useState<string>(todayIso());
  const [to, setTo] = useState<string>(addDaysIso(7));
  const [view, setView] = useState<ViewMode>('week');
  const [agenda, setAgenda] = useState<Agenda | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [professionalFilter, setProfessionalFilter] = useState<string>('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ from, to });
      if (!isProfessional && professionalFilter) {
        params.set('professionalId', professionalFilter);
      }
      const result = await withToken((token) =>
        apiRequest<Agenda>(`/agenda?${params.toString()}`, { token }),
      );
      setAgenda(result);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setLoading(false);
    }
  }, [from, to, isProfessional, professionalFilter, withToken]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (isProfessional) {
      return;
    }
    let active = true;
    withToken((token) => apiRequest<Professional[]>('/professionals', { token }))
      .then((list) => {
        if (active) {
          setProfessionals(list);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [isProfessional, withToken]);

  const days = useMemo(() => {
    if (!agenda) {
      return [];
    }
    if (view === 'week') {
      return agenda.days;
    }
    const day = agenda.days.find((entry) => entry.date === from);
    return [{ date: from, appointments: day ? day.appointments : [] }];
  }, [agenda, view, from]);

  const total = days.reduce(
    (sum, day) => sum + day.appointments.length,
    0,
  );

  function changeView(next: ViewMode) {
    setView(next);
    if (next === 'week') {
      setFrom(todayIso());
      setTo(addDaysIso(7));
    } else {
      setTo(from);
    }
  }

  return (
    <section className="screen">
      <header className="screen-header">
        <div>
          <h1>Agenda</h1>
          <p className="screen-subtitle">
            Appointments from {formatDate(from)} to {formatDate(to)}.
          </p>
        </div>
        <div className="segmented" role="group" aria-label="Agenda view">
          <button
            type="button"
            className={view === 'day' ? 'segment active' : 'segment'}
            onClick={() => changeView('day')}
          >
            Day
          </button>
          <button
            type="button"
            className={view === 'week' ? 'segment active' : 'segment'}
            onClick={() => changeView('week')}
          >
            Week
          </button>
        </div>
      </header>

      <form
        className="card search-form"
        onSubmit={(event) => {
          event.preventDefault();
          void load();
        }}
      >
        <div className="field">
          <label htmlFor="agenda-from">From</label>
          <input
            id="agenda-from"
            type="date"
            value={from}
            onChange={(event) => {
              setFrom(event.target.value);
              if (view === 'day') {
                setTo(event.target.value);
              }
            }}
          />
        </div>
        <div className="field">
          <label htmlFor="agenda-to">To</label>
          <input
            id="agenda-to"
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            disabled={view === 'day'}
          />
        </div>
        {!isProfessional ? (
          <div className="field">
            <label htmlFor="agenda-professional">Professional</label>
            <select
              id="agenda-professional"
              value={professionalFilter}
              onChange={(event) => setProfessionalFilter(event.target.value)}
            >
              <option value="">All professionals</option>
              {professionals.map((professional) => (
                <option key={professional.id} value={String(professional.id)}>
                  {professional.surname}, {professional.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <button type="submit" className="button primary">
          Refresh
        </button>
      </form>

      {loading ? <Loading label="Loading the agenda…" /> : null}
      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}

      {!loading && !error && total === 0 ? (
        <EmptyState message="No appointments in this period." />
      ) : null}

      {!loading && !error && total > 0 ? (
        <div className="agenda">
          {days.map((day) => (
            <section key={day.date} className="agenda-day">
              <h2 className="agenda-day-title">{formatDate(day.date)}</h2>
              <ul className="appointment-list">
                {day.appointments.map((appointment: Appointment) => (
                  <li
                    key={appointment.id}
                    className="card appointment-item"
                    data-testid="appointment-item"
                    data-appointment-id={appointment.id}
                    onClick={
                      isProfessional
                        ? () => navigate(`/appointments/${appointment.id}`)
                        : undefined
                    }
                    onKeyDown={
                      isProfessional
                        ? (event) => {
                            if (event.key === 'Enter') {
                              navigate(`/appointments/${appointment.id}`);
                            }
                          }
                        : undefined
                    }
                    role={isProfessional ? 'button' : undefined}
                    tabIndex={isProfessional ? 0 : undefined}
                  >
                    <div className="appointment-main">
                      <span className="appointment-title">
                        {formatDateTime(appointment.start)} · {appointment.patientName}
                      </span>
                      <p className="appointment-meta">
                        {appointment.professionalName} · {appointment.specialty}
                      </p>
                    </div>
                    <div className="appointment-side">
                      <StatusBadge status={appointment.status} />
                      {isProfessional ? (
                        <Link
                          className="link-button"
                          to={`/appointments/${appointment.id}`}
                          onClick={(event) => event.stopPropagation()}
                        >
                          Open
                        </Link>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : null}
    </section>
  );
}
