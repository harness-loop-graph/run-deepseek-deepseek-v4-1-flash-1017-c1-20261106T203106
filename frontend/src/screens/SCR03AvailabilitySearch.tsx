import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest, describeError } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import {
  EmptyState,
  ErrorBanner,
  Loading,
  formatDateTime,
} from '../components/states';
import type { Professional, Slot } from '../types';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

export default function AvailabilitySearchScreen(): JSX.Element {
  const { withToken, user } = useAuth();
  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [professionalId, setProfessionalId] = useState<string>('');
  const [from, setFrom] = useState<string>(todayIso());
  const [to, setTo] = useState<string>(addDaysIso(13));
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [selected, setSelected] = useState<Slot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [booking, setBooking] = useState(false);
  const [booked, setBooked] = useState<{ id: number; start: string } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const isPatient = user?.roles.includes('patient') ?? false;

  useEffect(() => {
    let active = true;
    withToken((token) => apiRequest<Professional[]>('/professionals', { token }))
      .then((list) => {
        if (!active) {
          return;
        }
        setProfessionals(list);
        if (list.length > 0) {
          setProfessionalId((current) => current || String(list[0].id));
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(describeError(cause));
        }
      });
    return () => {
      active = false;
    };
  }, [withToken]);

  const search = useCallback(async () => {
    setFormError(null);
    if (!professionalId) {
      setFormError('Select a professional.');
      return;
    }
    if (!from || !to) {
      setFormError('Both dates are required.');
      return;
    }
    if (from > to) {
      setFormError('The start date must be before or equal to the end date.');
      return;
    }
    setLoading(true);
    setError(null);
    setSelected(null);
    try {
      const params = new URLSearchParams({ professionalId, from, to });
      const result = await withToken((token) =>
        apiRequest<Slot[]>(`/availability?${params.toString()}`, { token }),
      );
      setSlots(result);
    } catch (cause) {
      setError(describeError(cause));
      setSlots(null);
    } finally {
      setLoading(false);
    }
  }, [professionalId, from, to, withToken]);

  useEffect(() => {
    if (professionalId) {
      void search();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [professionalId]);

  async function book() {
    if (!selected) {
      setFormError('Select a slot first.');
      return;
    }
    setBooking(true);
    setFormError(null);
    setError(null);
    try {
      const created = await withToken((token) =>
        apiRequest<{ id: number; start: string }>('/appointments', {
          method: 'POST',
          token,
          body: { professionalId: Number(professionalId), slotStart: selected.start },
        }),
      );
      setBooked(created);
      setSelected(null);
      await search();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBooking(false);
    }
  }

  return (
    <section className="screen">
      <header className="screen-header">
        <div>
          <h1>Availability search</h1>
          <p className="screen-subtitle">
            Find a free slot and book it. One active booking per slot.
          </p>
        </div>
      </header>

      <form
        className="card search-form"
        onSubmit={(event) => {
          event.preventDefault();
          void search();
        }}
      >
        <div className="field">
          <label htmlFor="search-professional">Professional</label>
          <select
            id="search-professional"
            data-testid="search-professional"
            value={professionalId}
            onChange={(event) => setProfessionalId(event.target.value)}
          >
            <option value="">Select a professional…</option>
            {professionals.map((professional) => (
              <option key={professional.id} value={String(professional.id)}>
                {professional.surname}, {professional.name} — {professional.specialty}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="search-from">From</label>
          <input
            id="search-from"
            data-testid="search-from"
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="search-to">To</label>
          <input
            id="search-to"
            data-testid="search-to"
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
        </div>
        <button
          type="submit"
          className="button primary"
          data-testid="search-submit"
          disabled={loading}
        >
          Search slots
        </button>
      </form>

      {formError ? <ErrorBanner message={formError} /> : null}
      {error ? <ErrorBanner message={error} onRetry={() => void search()} /> : null}
      {booked ? (
        <div className="state state-success" role="status">
          Appointment #{booked.id} booked for {formatDateTime(booked.start)}.{' '}
          <Link to="/bookings">View my appointments</Link>
        </div>
      ) : null}

      {loading ? <Loading label="Searching availability…" /> : null}

      {!loading && slots !== null && slots.length === 0 ? (
        <EmptyState message="No free slots in the selected range." />
      ) : null}

      {!loading && slots !== null && slots.length > 0 ? (
        <div className="card">
          <h2 className="section-title">Available slots</h2>
          <ul className="slot-grid">
            {slots.map((slot) => (
              <li key={slot.start}>
                <button
                  type="button"
                  className={
                    selected?.start === slot.start
                      ? 'slot-item selected'
                      : 'slot-item'
                  }
                  data-testid="slot-item"
                  data-slot-start={slot.start}
                  aria-pressed={selected?.start === slot.start}
                  onClick={() => setSelected(slot)}
                >
                  {formatDateTime(slot.start)}
                </button>
              </li>
            ))}
          </ul>
          {isPatient ? (
            <button
              type="button"
              className="button primary"
              data-testid="book-submit"
              disabled={booking || selected === null}
              onClick={() => void book()}
            >
              {booking ? 'Booking…' : 'Book selected slot'}
            </button>
          ) : (
            <p className="screen-subtitle">
              Staff view: booking is performed by patients.
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
}
