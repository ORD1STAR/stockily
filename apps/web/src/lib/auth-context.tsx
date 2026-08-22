import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { ApiError, authApi, authedRequest, REFRESH_TOKEN_STORAGE_KEY, setSilentRefreshHandler } from './api';

export interface MeResponse {
  user: { id: string; email: string };
  organization: { id: string; name: string; plan: string };
  entitlements: { module: string; status: string; trialEndsAt: string | null }[];
  roles: { role: string; site: string | null }[];
}

interface AuthContextValue {
  me: MeResponse | null;
  loading: boolean;
  /** Null only while `loading` or logged out — pages behind ProtectedRoute can treat this as always present. */
  accessToken: string | null;
  signup: (organizationName: string, email: string, password: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  logoutEverywhere: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const applySession = useCallback(async (tokens: { accessToken: string; refreshToken: string }) => {
    // Only the refresh token is persisted. The access token lives in memory
    // only and is re-derived via a silent refresh on every page load — a
    // stale access token sitting in localStorage would otherwise outlive
    // its own short TTL for no benefit.
    localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, tokens.refreshToken);
    setAccessToken(tokens.accessToken);
    const meResponse = await authedRequest<MeResponse>('/me', tokens.accessToken);
    setMe(meResponse);
  }, []);

  const clearSession = useCallback(() => {
    localStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY);
    setAccessToken(null);
    setMe(null);
  }, []);

  useEffect(() => {
    // api.ts's authedRequest silently refreshes and retries on its own
    // whenever a request 401s (a short-TTL access token expiring mid-use) —
    // this keeps THIS component's in-memory accessToken in sync with
    // whatever it rotates to there, instead of the two drifting apart.
    setSilentRefreshHandler((tokens) => setAccessToken(tokens.accessToken));
    return () => setSilentRefreshHandler(null);
  }, []);

  useEffect(() => {
    const storedRefreshToken = localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY);
    if (!storedRefreshToken) {
      setLoading(false);
      return;
    }
    authApi
      .refresh(storedRefreshToken)
      .then((tokens) => applySession(tokens))
      .catch(() => clearSession())
      .finally(() => setLoading(false));
    // Runs once on mount only — applySession/clearSession are stable
    // (useCallback with no deps that change), and re-running this on every
    // render would re-issue a refresh call repeatedly.
  }, []);

  const signup = useCallback(
    async (organizationName: string, email: string, password: string) => {
      const tokens = await authApi.signup({ organizationName, email, password });
      await applySession(tokens);
    },
    [applySession],
  );

  const login = useCallback(
    async (email: string, password: string) => {
      const tokens = await authApi.login({ email, password });
      await applySession(tokens);
    },
    [applySession],
  );

  const logout = useCallback(async () => {
    const storedRefreshToken = localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY);
    if (storedRefreshToken) {
      // Best-effort: if this fails, the token is unusable to the caller
      // anyway once localStorage is cleared below.
      await authApi.logout(storedRefreshToken).catch(() => undefined);
    }
    clearSession();
  }, [clearSession]);

  const logoutEverywhere = useCallback(async () => {
    if (accessToken) {
      await authApi.logoutEverywhere(accessToken).catch(() => undefined);
    }
    clearSession();
  }, [accessToken, clearSession]);

  return (
    <AuthContext.Provider value={{ me, loading, accessToken, signup, login, logout, logoutEverywhere }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}

// Re-exported so a caller that already has `useAuth()`'s ApiError from a
// failed call can narrow on it without importing from ./api directly.
export { ApiError };
