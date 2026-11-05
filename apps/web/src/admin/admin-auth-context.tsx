import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { ADMIN_REFRESH_KEY, AdminProfile, adminAuthApi, setAdminRefreshHandler } from './admin-api';

interface AdminAuthValue {
  admin: AdminProfile | null;
  accessToken: string | null;
  loading: boolean;
  login: (identifier: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AdminAuthValue | undefined>(undefined);

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [admin, setAdmin] = useState<AdminProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setAdminRefreshHandler((t) => setAccessToken(t.accessToken));
    return () => setAdminRefreshHandler(null);
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem(ADMIN_REFRESH_KEY);
    if (!stored) {
      setLoading(false);
      return;
    }
    adminAuthApi
      .refresh(stored)
      .then((t) => {
        localStorage.setItem(ADMIN_REFRESH_KEY, t.refreshToken);
        setAccessToken(t.accessToken);
        // The refresh response doesn't carry the profile; a minimal placeholder
        // is enough — pages don't depend on it beyond a display name.
        setAdmin((a) => a ?? { id: '', email: '', name: null });
      })
      .catch(() => localStorage.removeItem(ADMIN_REFRESH_KEY))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (identifier: string, password: string) => {
    const r = await adminAuthApi.login(identifier, password);
    localStorage.setItem(ADMIN_REFRESH_KEY, r.refreshToken);
    setAccessToken(r.accessToken);
    setAdmin(r.admin);
  }, []);

  const logout = useCallback(async () => {
    const stored = localStorage.getItem(ADMIN_REFRESH_KEY);
    if (stored) await adminAuthApi.logout(stored).catch(() => undefined);
    localStorage.removeItem(ADMIN_REFRESH_KEY);
    setAccessToken(null);
    setAdmin(null);
  }, []);

  return <Ctx.Provider value={{ admin, accessToken, loading, login, logout }}>{children}</Ctx.Provider>;
}

export function useAdminAuth(): AdminAuthValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAdminAuth must be used within AdminAuthProvider');
  return ctx;
}
