import { useCallback, useEffect, useState } from 'react';
import { apiRequest, describeError } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import {
  EmptyState,
  ErrorBanner,
  Loading,
  formatDateTime,
} from '../components/states';
import type { AuditEntry, Paginated } from '../types';

const ACTIONS = [
  '',
  'auth.login',
  'cita.create',
  'cita.cancel',
  'encuentro.create',
  'encuentro.read',
  'historia.read',
  'adjunto.create',
  'adjunto.read',
  'usuario.create',
  'usuario.roles.update',
  'disponibilidad.replace',
];

export default function AuditScreen(): JSX.Element {
  const { withToken } = useAuth();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [actor, setActor] = useState('');
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const pageSize = 50;

  const load = useCallback(
    async (targetPage: number) => {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({ page: String(targetPage) });
      if (actor.trim()) {
        params.set('actor', actor.trim());
      }
      if (action) {
        params.set('action', action);
      }
      if (from) {
        params.set('from', from);
      }
      if (to) {
        params.set('to', to);
      }
      try {
        const result = await withToken((token) =>
          apiRequest<Paginated<AuditEntry>>(`/admin/audit?${params.toString()}`, {
            token,
          }),
        );
        setEntries(result.items);
        setTotal(result.total);
      } catch (cause) {
        setError(describeError(cause));
      } finally {
        setLoading(false);
      }
    },
    [actor, action, from, to, withToken],
  );

  useEffect(() => {
    void load(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <section className="screen">
      <header className="screen-header">
        <div>
          <h1>Audit log</h1>
          <p className="screen-subtitle">
            Append-only record of every write and clinical read.
          </p>
        </div>
      </header>

      <form
        className="card search-form"
        onSubmit={(event) => {
          event.preventDefault();
          setPage(1);
          void load(1);
        }}
      >
        <div className="field">
          <label htmlFor="audit-actor">Actor id</label>
          <input
            id="audit-actor"
            type="number"
            min={1}
            value={actor}
            onChange={(event) => setActor(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="audit-action">Action</label>
          <select
            id="audit-action"
            value={action}
            onChange={(event) => setAction(event.target.value)}
          >
            {ACTIONS.map((item) => (
              <option key={item || 'all'} value={item}>
                {item || 'All actions'}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="audit-from">From</label>
          <input
            id="audit-from"
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="audit-to">To</label>
          <input
            id="audit-to"
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
        </div>
        <button type="submit" className="button primary">
          Filter
        </button>
      </form>

      {loading ? <Loading label="Loading the audit log…" /> : null}
      {error ? <ErrorBanner message={error} onRetry={() => void load(page)} /> : null}
      {!loading && !error && entries.length === 0 ? (
        <EmptyState message="No audit entries match the filters." />
      ) : null}
      {!loading && entries.length > 0 ? (
        <table className="data-table">
          <thead>
            <tr>
              <th>Id</th>
              <th>When</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Resource</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td>{entry.id}</td>
                <td>{formatDateTime(entry.creado_en)}</td>
                <td>{entry.usuario_id}</td>
                <td>{entry.accion}</td>
                <td>
                  {entry.recurso_tipo}
                  {entry.recurso_id !== null ? ` #${entry.recurso_id}` : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {total > pageSize ? (
        <div className="pager">
          <button
            type="button"
            className="button secondary"
            disabled={page <= 1}
            onClick={() => setPage((value) => Math.max(1, value - 1))}
          >
            Previous
          </button>
          <span>
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            className="button secondary"
            disabled={page >= totalPages}
            onClick={() => setPage((value) => value + 1)}
          >
            Next
          </button>
        </div>
      ) : null}
    </section>
  );
}
