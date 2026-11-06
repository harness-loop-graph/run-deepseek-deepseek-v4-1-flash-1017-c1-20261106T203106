import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  API_BASE_URL,
  ApiClientError,
  OAUTH_CLIENT_ID,
  OAUTH_REDIRECT_URI,
} from '../api/client';
import type { SessionUser, TokenResponse } from '../types';
import {
  clearPendingAuthorization,
  createPkcePair,
  createState,
  readPendingAuthorization,
  savePendingAuthorization,
} from './pkce';
import {
  StoredSession,
  exchangeCodeForTokens,
  readStoredRefreshToken,
  refreshTokens,
  revokeToken,
  shouldRefreshProactively,
  toStoredSession,
  writeStoredRefreshToken,
} from './tokenPolicy';

interface AuthContextValue {
  user: SessionUser | null;
  ready: boolean;
  sessionError: string | null;
  login: () => Promise<void>;
  completeLogin: (code: string, state: string) => Promise<void>;
  logout: () => Promise<void>;
  withToken: <T>(operation: (token: string) => Promise<T>) => Promise<T>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const REFRESH_TIMER_MS = 30_000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<StoredSession | null>(null);
  const [ready, setReady] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const sessionRef = useRef<StoredSession | null>(null);
  const refreshInFlight = useRef<Promise<StoredSession | null> | null>(null);

  const applySession = useCallback((next: StoredSession | null) => {
    sessionRef.current = next;
    setSession(next);
    writeStoredRefreshToken(next ? next.refreshToken : null);
  }, []);

  const refreshNow = useCallback(async (): Promise<StoredSession | null> => {
    if (refreshInFlight.current) {
      return refreshInFlight.current;
    }
    const current = sessionRef.current;
    const token = current?.refreshToken ?? readStoredRefreshToken();
    if (!token) {
      return null;
    }
    const task = (async () => {
      try {
        const tokens = await refreshTokens(token);
        const next = toStoredSession(tokens);
        applySession(next);
        setSessionError(null);
        return next;
      } catch {
        applySession(null);
        setSessionError('Your session expired. Please sign in again.');
        return null;
      } finally {
        refreshInFlight.current = null;
      }
    })();
    refreshInFlight.current = task;
    return task;
  }, [applySession]);

  const login = useCallback(async () => {
    const { verifier, challenge } = await createPkcePair();
    const state = createState();
    savePendingAuthorization({ verifier, state });
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: OAUTH_CLIENT_ID,
      redirect_uri: OAUTH_REDIRECT_URI,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
    });
    window.location.assign(
      `${API_BASE_URL}/auth/authorize?${params.toString()}`,
    );
  }, []);

  const completeLogin = useCallback(
    async (code: string, returnedState: string) => {
      const pending = readPendingAuthorization();
      if (!pending) {
        throw new Error('The authorization request is missing. Start again.');
      }
      if (pending.state !== returnedState) {
        throw new Error('The authorization state does not match. Start again.');
      }
      const tokens: TokenResponse = await exchangeCodeForTokens(
        code,
        pending.verifier,
        OAUTH_REDIRECT_URI,
        OAUTH_CLIENT_ID,
      );
      clearPendingAuthorization();
      applySession(toStoredSession(tokens));
      setSessionError(null);
    },
    [applySession],
  );

  const logout = useCallback(async () => {
    const current = sessionRef.current;
    const token = current?.refreshToken ?? readStoredRefreshToken();
    if (token) {
      try {
        await revokeToken(token);
      } catch {
        // local session is cleared even when revocation fails
      }
    }
    applySession(null);
    setSessionError(null);
  }, [applySession]);

  const withToken = useCallback(
    async <T,>(operation: (token: string) => Promise<T>): Promise<T> => {
      let current = sessionRef.current;
      if (!current) {
        throw new ApiClientError(
          'UNAUTHORIZED',
          'You must sign in to continue.',
          401,
          null,
        );
      }
      if (shouldRefreshProactively(current)) {
        current = (await refreshNow()) ?? current;
      }
      try {
        return await operation(current.accessToken);
      } catch (error) {
        if (error instanceof ApiClientError && error.status === 401) {
          const refreshed = await refreshNow();
          if (!refreshed) {
            throw error;
          }
          return operation(refreshed.accessToken);
        }
        throw error;
      }
    },
    [refreshNow],
  );

  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      const stored = readStoredRefreshToken();
      if (stored) {
        try {
          const tokens = await refreshTokens(stored);
          if (!cancelled) {
            applySession(toStoredSession(tokens));
          }
        } catch {
          if (!cancelled) {
            applySession(null);
          }
        }
      }
      if (!cancelled) {
        setReady(true);
      }
    }
    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [applySession]);

  useEffect(() => {
    if (!session) {
      return;
    }
    const timer = window.setInterval(() => {
      const current = sessionRef.current;
      if (current && shouldRefreshProactively(current)) {
        void refreshNow();
      }
    }, REFRESH_TIMER_MS);
    return () => window.clearInterval(timer);
  }, [session, refreshNow]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user: session?.user ?? null,
      ready,
      sessionError,
      login,
      completeLogin,
      logout,
      withToken,
    }),
    [session, ready, sessionError, login, completeLogin, logout, withToken],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return context;
}
