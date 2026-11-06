import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  apiDownload,
  apiRequest,
  apiUpload,
  describeError,
} from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import {
  ErrorBanner,
  Loading,
  StatusBadge,
  formatDateTime,
} from '../components/states';
import type { AppointmentDetail, Attachment } from '../types';

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

export default function AppointmentDetailScreen(): JSX.Element {
  const { id } = useParams();
  const appointmentId = Number.parseInt(id ?? '', 10);
  const { user, withToken } = useAuth();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<AppointmentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [diagnosis, setDiagnosis] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await withToken((token) =>
        apiRequest<AppointmentDetail>(`/appointments/${appointmentId}`, { token }),
      );
      setDetail(result);
      setNotes(result.encounter?.notes ?? '');
      setDiagnosis(result.encounter?.diagnosis ?? '');
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setLoading(false);
    }
  }, [appointmentId, withToken]);

  useEffect(() => {
    if (Number.isNaN(appointmentId)) {
      setError('The appointment identifier is invalid.');
      setLoading(false);
      return;
    }
    void load();
  }, [appointmentId, load]);

  const canRecord =
    (user?.roles.includes('professional') ?? false) &&
    detail !== null &&
    detail.professionalId === user?.professionalId &&
    detail.status !== 'cancelled';
  async function submitEncounter() {
    setFormError(null);
    if (notes.trim().length === 0) {
      setFormError('Clinical notes are required.');
      return;
    }
    if (diagnosis.trim().length === 0) {
      setFormError('A diagnosis is required.');
      return;
    }
    setSubmitting(true);
    try {
      await withToken((token) =>
        apiRequest(`/appointments/${appointmentId}/encounter`, {
          method: 'POST',
          token,
          body: { notes: notes.trim(), diagnosis: diagnosis.trim() },
        }),
      );
      await load();
    } catch (cause) {
      setFormError(describeError(cause));
    } finally {
      setSubmitting(false);
    }
  }

  async function uploadAttachment(file: File) {
    setUploadError(null);
    if (!detail?.encounter) {
      setUploadError('Record an encounter before adding attachments.');
      return;
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      setUploadError('Only PDF, JPEG and PNG files are allowed.');
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setUploadError('The file exceeds the 5 MB limit.');
      return;
    }
    setUploading(true);
    try {
      await withToken((token) =>
        apiUpload<Attachment>(
          `/encounters/${detail.encounter?.id}/attachments`,
          file,
          token,
        ),
      );
      if (fileInput.current) {
        fileInput.current.value = '';
      }
      await load();
    } catch (cause) {
      setUploadError(describeError(cause));
    } finally {
      setUploading(false);
    }
  }

  async function downloadAttachment(attachment: Attachment) {
    setUploadError(null);
    try {
      const { blob, filename } = await withToken((token) =>
        apiDownload(`/attachments/${attachment.id}`, token),
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename ?? attachment.filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setUploadError(describeError(cause));
    }
  }

  if (loading) {
    return <Loading label="Loading the appointment…" />;
  }

  if (error || !detail) {
    return (
      <section className="screen">
        <ErrorBanner message={error ?? 'The appointment was not found.'} onRetry={() => void load()} />
        <p>
          <Link to="/">Back to your workspace</Link>
        </p>
      </section>
    );
  }

  const showClinical =
    user?.roles.includes('patient') || user?.roles.includes('professional');

  return (
    <section className="screen">
      <header className="screen-header">
        <div>
          <h1>Appointment #{detail.id}</h1>
          <p className="screen-subtitle">
            {formatDateTime(detail.start)} – {formatDateTime(detail.end)}
          </p>
        </div>
        <StatusBadge status={detail.status} />
      </header>

      <div className="card detail-grid">
        <div>
          <span className="label">Patient</span>
          <p>{detail.patientName}</p>
        </div>
        <div>
          <span className="label">Professional</span>
          <p>
            {detail.professionalName} · {detail.specialty}
          </p>
        </div>
      </div>

      {showClinical ? (
        <div className="card">
          <h2 className="section-title">
            Encounter{' '}
            {detail.encounter ? (
              <span className="version-tag">version {detail.encounter.version}</span>
            ) : null}
          </h2>

          {canRecord ? (
            <form
              className="encounter-form"
              onSubmit={(event) => {
                event.preventDefault();
                void submitEncounter();
              }}
              noValidate
            >
              {formError ? <ErrorBanner message={formError} /> : null}
              <div className="field">
                <label htmlFor="encounter-notes">Clinical notes</label>
                <textarea
                  id="encounter-notes"
                  data-testid="encounter-notes"
                  rows={6}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="encounter-diagnosis">Diagnosis</label>
                <input
                  id="encounter-diagnosis"
                  data-testid="encounter-diagnosis"
                  type="text"
                  value={diagnosis}
                  onChange={(event) => setDiagnosis(event.target.value)}
                />
              </div>
              <button
                type="submit"
                className="button primary"
                data-testid="encounter-submit"
                disabled={submitting}
              >
                {submitting
                  ? 'Saving…'
                  : detail.encounter
                    ? 'Record new version'
                    : 'Record encounter'}
              </button>
            </form>
          ) : null}

          {detail.encounter ? (
            <div className="encounter-view">
              <div>
                <span className="label">Notes</span>
                <p className="clinical-text">{detail.encounter.notes}</p>
              </div>
              <div>
                <span className="label">Diagnosis</span>
                <p className="clinical-text">{detail.encounter.diagnosis}</p>
              </div>
              <div>
                <span className="label">Recorded</span>
                <p>{formatDateTime(detail.encounter.createdAt)}</p>
              </div>
              <div>
                <span className="label">Attachments</span>
                {detail.encounter.attachments.length === 0 ? (
                  <p className="screen-subtitle">No attachments.</p>
                ) : (
                  <ul className="attachment-list">
                    {detail.encounter.attachments.map((attachment) => (
                      <li key={attachment.id}>
                        <button
                          type="button"
                          className="link-button"
                          onClick={() => void downloadAttachment(attachment)}
                        >
                          {attachment.filename}
                        </button>{' '}
                        <span className="screen-subtitle">
                          ({Math.ceil(attachment.sizeBytes / 1024)} KB)
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : (
            <p className="screen-subtitle">No encounter has been recorded yet.</p>
          )}

          {canRecord && detail.encounter ? (
            <div className="upload-box">
              {uploadError ? <ErrorBanner message={uploadError} /> : null}
              <label htmlFor="attachment-input">Add attachment (PDF, JPEG, PNG · max 5 MB)</label>
              <input
                id="attachment-input"
                ref={fileInput}
                type="file"
                accept="application/pdf,image/jpeg,image/png"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    void uploadAttachment(file);
                  }
                }}
              />
              {uploading ? <Loading label="Uploading…" /> : null}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="card">
          <p className="screen-subtitle">
            Clinical content is not available to your role.
          </p>
        </div>
      )}

      <p>
        <button
          type="button"
          className="button secondary"
          onClick={() => navigate(-1)}
        >
          Back
        </button>
      </p>
    </section>
  );
}
