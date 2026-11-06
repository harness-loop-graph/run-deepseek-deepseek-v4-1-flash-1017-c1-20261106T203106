import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { describeError } from '../api/client';
import { ErrorBanner, Loading } from '../components/states';

export default function AuthCallbackScreen(): JSX.Element {
  const [params] = useSearchParams();
  const { completeLogin } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) {
      return;
    }
    started.current = true;
    const code = params.get('code');
    const state = params.get('state');
    const errorParam = params.get('error');
    if (errorParam) {
      setError(`The authorization server returned an error: ${errorParam}`);
      setBusy(false);
      return;
    }
    if (!code || !state) {
      setError('The authorization response is incomplete.');
      setBusy(false);
      return;
    }
    completeLogin(code, state)
      .then(() => {
        navigate('/', { replace: true });
      })
      .catch((cause: unknown) => {
        setError(describeError(cause));
        setBusy(false);
      });
  }, [params, completeLogin, navigate]);

  if (busy) {
    return <Loading label="Completing sign in…" />;
  }

  return (
    <div className="auth-shell">
      <main className="auth-card">
        <h1>Sign in could not be completed</h1>
        <ErrorBanner message={error ?? 'Unknown authorization error.'} />
        <p>
          <Link to="/login">Return to the sign in screen</Link>
        </p>
      </main>
    </div>
  );
}
