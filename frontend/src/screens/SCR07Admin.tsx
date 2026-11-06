import { useCallback, useEffect, useState } from 'react';
import { apiRequest, describeError } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import {
  EmptyState,
  ErrorBanner,
  Loading,
  formatDateTime,
} from '../components/states';
import type { AdminUser, Paginated, Professional } from '../types';

const ROLES = ['patient', 'professional', 'staff', 'admin'] as const;

export default function AdminScreen(): JSX.Element {
  const { withToken } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [selectedProfessional, setSelectedProfessional] = useState('');
  const [slots, setSlots] = useState<Array<{ id: number; start: string; end: string }>>(
    [],
  );
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [slotStart, setSlotStart] = useState('');
  const [slotEnd, setSlotEnd] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newRoles, setNewRoles] = useState<string[]>(['patient']);
  const [formError, setFormError] = useState<string | null>(null);
  const [formNotice, setFormNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const pageSize = 20;

  const loadUsers = useCallback(
    async (targetPage: number) => {
      setLoadingUsers(true);
      setUsersError(null);
      try {
        const result = await withToken((token) =>
          apiRequest<Paginated<AdminUser>>(`/admin/users?page=${targetPage}`, {
            token,
          }),
        );
        setUsers(result.items);
        setTotal(result.total);
      } catch (cause) {
        setUsersError(describeError(cause));
      } finally {
        setLoadingUsers(false);
      }
    },
    [withToken],
  );

  useEffect(() => {
    void loadUsers(page);
  }, [page, loadUsers]);

  useEffect(() => {
    let active = true;
    withToken((token) => apiRequest<Professional[]>('/admin/professionals', { token }))
      .then((list) => {
        if (!active) {
          return;
        }
        setProfessionals(list);
        if (list.length > 0) {
          setSelectedProfessional(String(list[0].id));
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setSlotsError(describeError(cause));
        }
      });
    return () => {
      active = false;
    };
  }, [withToken]);

  const loadSlots = useCallback(
    async (professionalId: string) => {
      if (!professionalId) {
        setSlots([]);
        return;
      }
      setSlotsLoading(true);
      setSlotsError(null);
      try {
        const result = await withToken((token) =>
          apiRequest<{ professionalId: number; slots: typeof slots }>(
            `/admin/professionals/${professionalId}/availability`,
            { token },
          ),
        );
        setSlots(result.slots);
      } catch (cause) {
        setSlotsError(describeError(cause));
      } finally {
        setSlotsLoading(false);
      }
    },
    [withToken, slots],
  );

  useEffect(() => {
    void loadSlots(selectedProfessional);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProfessional]);

  async function createUser() {
    setFormError(null);
    setFormNotice(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail.trim())) {
      setFormError('Enter a valid email address.');
      return;
    }
    if (newRoles.length === 0) {
      setFormError('Select at least one role.');
      return;
    }
    setSaving(true);
    try {
      await withToken((token) =>
        apiRequest<AdminUser>('/admin/users', {
          method: 'POST',
          token,
          body: { email: newEmail.trim().toLowerCase(), roles: newRoles },
        }),
      );
      setNewEmail('');
      setNewRoles(['patient']);
      setFormNotice('User created.');
      await loadUsers(page);
    } catch (cause) {
      setFormError(describeError(cause));
    } finally {
      setSaving(false);
    }
  }

  async function updateRoles(user: AdminUser, role: string) {
    setFormError(null);
    setFormNotice(null);
    const nextRoles = user.roles.includes(role)
      ? user.roles.filter((item) => item !== role)
      : [...user.roles, role];
    if (nextRoles.length === 0) {
      setFormError('A user must keep at least one role.');
      return;
    }
    try {
      await withToken((token) =>
        apiRequest<AdminUser>(`/admin/users/${user.id}/roles`, {
          method: 'PATCH',
          token,
          body: { roles: nextRoles },
        }),
      );
      setFormNotice(`Roles updated for ${user.email}.`);
      await loadUsers(page);
    } catch (cause) {
      setFormError(describeError(cause));
    }
  }

  async function addSlot() {
    setFormError(null);
    setFormNotice(null);
    if (!slotStart || !slotEnd) {
      setFormError('Both slot start and end are required.');
      return;
    }
    const startDate = new Date(slotStart);
    const endDate = new Date(slotEnd);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      setFormError('Enter valid timestamps.');
      return;
    }
    if (endDate.getTime() <= startDate.getTime()) {
      setFormError('The slot end must be after its start.');
      return;
    }
    const nextSlots = [
      ...slots.map((slot) => ({ start: slot.start, end: slot.end })),
      { start: startDate.toISOString(), end: endDate.toISOString() },
    ].sort((a, b) => a.start.localeCompare(b.start));
    setSaving(true);
    try {
      await withToken((token) =>
        apiRequest(`/admin/professionals/${selectedProfessional}/availability`, {
          method: 'PUT',
          token,
          body: { slots: nextSlots },
        }),
      );
      setFormNotice('Availability saved.');
      setSlotStart('');
      setSlotEnd('');
      await loadSlots(selectedProfessional);
    } catch (cause) {
      setFormError(describeError(cause));
    } finally {
      setSaving(false);
    }
  }

  async function removeSlot(slotId: number) {
    setFormError(null);
    const nextSlots = slots
      .filter((slot) => slot.id !== slotId)
      .map((slot) => ({ start: slot.start, end: slot.end }));
    setSaving(true);
    try {
      await withToken((token) =>
        apiRequest(`/admin/professionals/${selectedProfessional}/availability`, {
          method: 'PUT',
          token,
          body: { slots: nextSlots },
        }),
      );
      await loadSlots(selectedProfessional);
    } catch (cause) {
      setFormError(describeError(cause));
    } finally {
      setSaving(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <section className="screen">
      <header className="screen-header">
        <div>
          <h1>Administration</h1>
          <p className="screen-subtitle">Users, roles and professional availability.</p>
        </div>
      </header>

      {formError ? <ErrorBanner message={formError} /> : null}
      {formNotice ? (
        <div className="state state-success" role="status">
          {formNotice}
        </div>
      ) : null}

      <div className="card">
        <h2 className="section-title">Users and roles</h2>
        <form
          className="search-form"
          onSubmit={(event) => {
            event.preventDefault();
            void createUser();
          }}
          noValidate
        >
          <div className="field">
            <label htmlFor="new-user-email">New user email</label>
            <input
              id="new-user-email"
              type="email"
              value={newEmail}
              onChange={(event) => setNewEmail(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="new-user-roles">Roles</label>
            <select
              id="new-user-roles"
              multiple
              value={newRoles}
              onChange={(event) => {
                const selected = Array.from(event.target.selectedOptions).map(
                  (option) => option.value,
                );
                setNewRoles(selected);
              }}
            >
              {ROLES.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="button primary" disabled={saving}>
            Create user
          </button>
        </form>

        {loadingUsers ? <Loading label="Loading users…" /> : null}
        {usersError ? (
          <ErrorBanner message={usersError} onRetry={() => void loadUsers(page)} />
        ) : null}
        {!loadingUsers && !usersError && users.length === 0 ? (
          <EmptyState message="No users found." />
        ) : null}
        {!loadingUsers && users.length > 0 ? (
          <table className="data-table">
            <thead>
              <tr>
                <th>Id</th>
                <th>Email</th>
                <th>Created</th>
                <th>Roles</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>{user.id}</td>
                  <td>{user.email}</td>
                  <td>{formatDateTime(user.createdAt)}</td>
                  <td>
                    <div className="role-chips">
                      {ROLES.map((role) => (
                        <button
                          key={role}
                          type="button"
                          className={
                            user.roles.includes(role)
                              ? 'chip active'
                              : 'chip'
                          }
                          onClick={() => void updateRoles(user, role)}
                        >
                          {role}
                        </button>
                      ))}
                    </div>
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
      </div>

      <div className="card">
        <h2 className="section-title">Professional availability</h2>
        <div className="field">
          <label htmlFor="availability-professional">Professional</label>
          <select
            id="availability-professional"
            value={selectedProfessional}
            onChange={(event) => setSelectedProfessional(event.target.value)}
          >
            {professionals.map((professional) => (
              <option key={professional.id} value={String(professional.id)}>
                {professional.surname}, {professional.name}
              </option>
            ))}
          </select>
        </div>

        <form
          className="search-form"
          onSubmit={(event) => {
            event.preventDefault();
            void addSlot();
          }}
          noValidate
        >
          <div className="field">
            <label htmlFor="slot-start">Slot start</label>
            <input
              id="slot-start"
              type="datetime-local"
              value={slotStart}
              onChange={(event) => setSlotStart(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="slot-end">Slot end</label>
            <input
              id="slot-end"
              type="datetime-local"
              value={slotEnd}
              onChange={(event) => setSlotEnd(event.target.value)}
            />
          </div>
          <button type="submit" className="button primary" disabled={saving}>
            Add slot
          </button>
        </form>

        {slotsLoading ? <Loading label="Loading availability…" /> : null}
        {slotsError ? (
          <ErrorBanner message={slotsError} onRetry={() => void loadSlots(selectedProfessional)} />
        ) : null}
        {!slotsLoading && !slotsError && slots.length === 0 ? (
          <EmptyState message="No future availability configured." />
        ) : null}
        {!slotsLoading && slots.length > 0 ? (
          <ul className="slot-grid">
            {slots.map((slot) => (
              <li key={slot.id} className="slot-chip">
                <span>{formatDateTime(slot.start)}</span>
                <button
                  type="button"
                  className="link-button"
                  onClick={() => void removeSlot(slot.id)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
