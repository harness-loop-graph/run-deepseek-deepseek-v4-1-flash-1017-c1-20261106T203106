import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { API_BASE_URL, OAUTH_CLIENT_ID, OAUTH_REDIRECT_URI, describeError } from '../api/client';
import { createPkcePair, createState, savePendingAuthorization } from '../auth/pkce';
import { ErrorBanner, Loading } from '../components/states';

interface PasswordLoginResponse {
  redirect_to: string;
}

/**
 * SCR-01. The credentials are validated by the API's authorization endpoint
 * (EP-01/EP-02 flow): the SPA builds the PKCE request, submits it with the
 * credentials, and exchanges the returned code for tokens.
 */
export default function LoginScreen(): JSX.Element {
  const { user, ready, completeLogin, sessionError } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{
    email?: string;
    password?: string;
  }>({});

  useEffect(() => {
    if (ready && user) {
      const target = (location.state as { from?: string } | null)?.from ?? '/';
      navigate(target, { replace: true });
    }
  }, [ready, user, navigate, location.state]);

  function validate(): boolean {
    const next: { email?: string; password?: string } = {};
    if (email.trim().length === 0) {
      next.email = 'Email is required.';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      next.email = 'Enter a valid email address.';
    }
    if (password.length === 0) {
      next.password = 'Password is required.';
    }
    setFieldErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSignIn() {
    setError(null);
    if (!validate()) {
      return;
    }
    setBusy(true);
    try {
      const { verifier, challenge } = await createPkcePair();
      const state = createState();
      savePendingAuthorization({ verifier, state });
      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          email: email.trim(),
          password,
          response_type: 'code',
          client_id: OAUTH_CLIENT_ID,
          redirect_uri: OAUTH_REDIRECT_URI,
          code_challenge: challenge,
          code_challenge_method: 'S256',
          state,
        }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const envelope = payload as
          | { error?: { message?: string } }
          | null;
        throw new Error(
          envelope?.error?.message ?? 'Sign in failed. Check your credentials.',
        );
      }
      const { redirect_to: redirectTo } = payload as PasswordLoginResponse;
      const target = new URL(redirectTo);
      const code = target.searchParams.get('code');
      const returnedState = target.searchParams.get('state');
      if (!code || !returnedState) {
        throw new Error('The authorization response is incomplete.');
      }
      await completeLogin(code, returnedState);
      navigate('/', { replace: true });
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  }

  if (!ready) {
    return <Loading label="Preparing sign in…" />;
  }

  return (
    <div className="auth-shell">
      <main className="auth-card">
        <h1>Medical Appointments</h1>
        <p className="auth-subtitle">
          Outpatient scheduling and clinical history registry.
        </p>
        {sessionError ? <ErrorBanner message={sessionError} /> : null}
        {error ? <ErrorBanner message={error} /> : null}
        <form
          className="auth-form"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSignIn();
          }}
          noValidate
        >
          <div className="field">
            <label htmlFor="login-email">Email</label>
            <input
              id="login-email"
              data-testid="login-email"
              name="email"
              type="email"
              autoComplete="username"
              placeholder="paciente1@seed.local"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
            {fieldErrors.email ? (
              <p className="field-error">{fieldErrors.email}</p>
            ) : null}
          </div>
          <div className="field">
            <label htmlFor="login-password">Password</label>
            <input
              id="login-password"
              data-testid="login-password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
            {fieldErrors.password ? (
              <p className="field-error">{fieldErrors.password}</p>
            ) : null}
          </div>
          <button
            type="submit"
            className="button primary"
            data-testid="login-submit"
            disabled={busy}
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p className="auth-hint">
          Protected by OAuth 2.0 authorization code flow with PKCE (S256). Access
          tokens last 15 minutes and are refreshed proactively.
        </p>
      </main>
    </div>
  );
}
