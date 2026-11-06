import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiDownload, apiRequest, describeError } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import {
  EmptyState,
  ErrorBanner,
  Loading,
  formatDateTime,
} from '../components/states';
import type { ClinicalHistory, Encounter } from '../types';

interface PatientOption {
  id: number;
  name: string;
  appointments: number;
}

export default function ClinicalHistoryScreen(): JSX.Element {
  const { patientId: routePatientId } = useParams();
  const { user, withToken } = useAuth();
  const isPatient = user?.roles.includes('patient') ?? false;
  const [patientId, setPatientId] = useState<string>(
    routePatientId ?? (isPatient ? String(user?.patientId ?? '') : ''),
  );
  const [patients, setPatients] = useState<PatientOption[]>([]);
  const [history, setHistory] = useState<ClinicalHistory | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(
    async (targetId: string) => {
      if (!targetId) {
        setHistory(null);
        setError(null);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const result = await withToken((token) =>
          apiRequest<ClinicalHistory>(
            `/patients/${targetId}/clinical-history`,
            { token },
          ),
        );
        setHistory(result);
      } catch (cause) {
        setHistory(null);
        setError(describeError(cause));
      } finally {
        setLoading(false);
      }
    },
    [withToken],
  );

  useEffect(() => {
    if (isPatient) {
      const ownId = routePatientId ?? String(user?.patientId ?? '');
      setPatientId(ownId);
      void load(ownId);
      return;
    }
    let active = true;
    withToken((token) => apiRequest<PatientOption[]>('/me/patients', { token }))
      .then((list) => {
        if (!active) {
          return;
        }
        setPatients(list);
        if (routePatientId) {
          setPatientId(routePatientId);
          void load(routePatientId);
        } else if (list.length > 0) {
          setPatientId(String(list[0].id));
          void load(String(list[0].id));
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPatient, routePatientId, user?.patientId]);

  async function downloadAttachment(id: number, filename: string) {
    setNotice(null);
    try {
      const { blob, filename: served } = await withToken((token) =>
        apiDownload(`/attachments/${id}`, token),
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = served ?? filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setNotice(describeError(cause));
    }
  }

  function renderEncounter(encounter: Encounter) {
    return (
      <li key={encounter.id} className="card timeline-item">
        <header className="timeline-header">
          <span className="timeline-date">{formatDateTime(encounter.createdAt)}</span>
          <span className="version-tag">version {encounter.version}</span>
        </header>
        <div>
          <span className="label">Notes</span>
          <p className="clinical-text">{encounter.notes}</p>
        </div>
        <div>
          <span className="label">Diagnosis</span>
          <p className="clinical-text">{encounter.diagnosis}</p>
        </div>
        {encounter.replacesEncounterId ? (
          <p className="screen-subtitle">
            Replaces encounter #{encounter.replacesEncounterId}
          </p>
        ) : null}
        {encounter.attachments.length > 0 ? (
          <div>
            <span className="label">Attachments</span>
            <ul className="attachment-list">
              {encounter.attachments.map((attachment) => (
                <li key={attachment.id}>
                  <button
                    type="button"
                    className="link-button"
                    onClick={() =>
                      void downloadAttachment(attachment.id, attachment.filename)
                    }
                  >
                    {attachment.filename}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <p>
          <Link className="link-button" to={`/appointments/${encounter.appointmentId}`}>
            Open appointment #{encounter.appointmentId}
          </Link>
        </p>
      </li>
    );
  }

  return (
    <section className="screen">
      <header className="screen-header">
        <div>
          <h1>Clinical history</h1>
          <p className="screen-subtitle">
            Chronology of recorded encounters with their attachments.
          </p>
        </div>
        {!isPatient && patients.length > 0 ? (
          <div className="field inline">
            <label htmlFor="history-patient">Patient</label>
            <select
              id="history-patient"
              value={patientId}
              onChange={(event) => {
                setPatientId(event.target.value);
                void load(event.target.value);
              }}
            >
              {patients.map((patient) => (
                <option key={patient.id} value={String(patient.id)}>
                  {patient.name} ({patient.appointments})
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </header>

      {notice ? <ErrorBanner message={notice} /> : null}
      {error ? (
        <ErrorBanner
          message={error}
          onRetry={() => {
            void load(patientId);
          }}
        />
      ) : null}
      {loading ? <Loading label="Loading the clinical history…" /> : null}

      {!loading && !error && !patientId ? (
        <EmptyState message="No patient selected." />
      ) : null}

      {!loading && !error && history !== null ? (
        <>
          <h2 className="section-title">{history.patientName}</h2>
          {history.encounters.length === 0 ? (
            <EmptyState message="No encounters recorded for this patient." />
          ) : (
            <ul className="timeline" data-testid="history-timeline">
              {history.encounters.map(renderEncounter)}
            </ul>
          )}
        </>
      ) : null}
    </section>
  );
}
