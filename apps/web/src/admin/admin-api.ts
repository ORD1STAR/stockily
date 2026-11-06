import { ApiError } from '../lib/api';

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000/api';
export const ADMIN_REFRESH_KEY = 'stockily.admin.refreshToken';

interface AdminTokens {
  accessToken: string;
  refreshToken: string;
}

async function raw<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) } });
  const body = await res.json().catch(() => undefined);
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

let onRefresh: ((t: AdminTokens) => void) | null = null;
export function setAdminRefreshHandler(fn: ((t: AdminTokens) => void) | null) {
  onRefresh = fn;
}

let refreshInFlight: Promise<string> | null = null;
function refreshAccess(): Promise<string> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const stored = localStorage.getItem(ADMIN_REFRESH_KEY);
      if (!stored) throw new ApiError(401, { message: 'No admin session' });
      const tokens = await raw<AdminTokens>('/admin/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken: stored }) });
      localStorage.setItem(ADMIN_REFRESH_KEY, tokens.refreshToken);
      onRefresh?.(tokens);
      return tokens.accessToken;
    })().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

async function adminReq<T>(path: string, token: string, options: RequestInit = {}): Promise<T> {
  try {
    return await raw<T>(path, { ...options, headers: { ...(options.headers ?? {}), Authorization: `Bearer ${token}` } });
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 401) throw err;
    const fresh = await refreshAccess();
    return raw<T>(path, { ...options, headers: { ...(options.headers ?? {}), Authorization: `Bearer ${fresh}` } });
  }
}

export interface AdminProfile {
  id: string;
  email: string;
  name: string | null;
}

export interface AdminDashboard {
  organizations: number;
  byPlan: { plan: string; count: number }[];
  activeUsers: number;
  activeDevices: number;
  moduleAdoption: { key: string; name: string; orgs: number }[];
  recentOrganizations: { id: string; name: string; plan: string; createdAt: string }[];
  newSuggestions: number;
}

export interface AdminOrgRow {
  id: string;
  name: string;
  plan: string;
  createdAt: string;
  seatsPerSite: number;
  users: number;
  sites: number;
  activeDevices: number;
  activeModules: number;
}

export interface AdminOrgModule {
  key: string;
  name: string;
  phase: number;
  dependencies: string[];
  status: string;
  trialEndsAt: string | null;
  active: boolean;
}

export interface AdminOrgDevice {
  id: string;
  deviceLabel: string | null;
  status: string;
  lastRenewedAt: string;
  licenseExpiresAt: string;
}

export interface AdminOrgDetail {
  organization: { id: string; name: string; plan: string; email: string | null; phone: string | null; address: string | null; nif: string | null; createdAt: string; seatsPerSite: number };
  seats: { used: number; total: number };
  modules: AdminOrgModule[];
  sites: { id: string; name: string; isActive: boolean }[];
  devices: AdminOrgDevice[];
  users: import('../lib/api').MemberView[];
}

export interface AdminPrice {
  moduleKey: string;
  name: string;
  monthlyPrice: number | null;
  currency: string;
  isActive: boolean;
}

export interface AdminSuggestion {
  id: string;
  email: string;
  name: string | null;
  activity: string | null;
  area: string | null;
  need: string;
  priority: string | null;
  currentTool: string | null;
  status: 'new' | 'reviewing' | 'planned' | 'done' | 'declined';
  adminNote: string | null;
  createdAt: string;
}

export interface AdminPayment {
  id: string;
  org: string;
  amount: number;
  currency: string;
  method: string | null;
  status: string;
  reference: string | null;
  checkoutId: string | null;
  trackId: string | null;
  paidAt: string | null;
  createdAt: string;
}

export interface AdminLogRow {
  kind: 'tenant' | 'admin';
  at: string;
  org: string;
  actor: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  detail: unknown;
}

export interface SchemaTable {
  table: string;
  columns: { name: string; type: string; nullable: boolean }[];
}

export interface SqlResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
  write: boolean;
  message?: string;
}

export const adminAuthApi = {
  login: (identifier: string, password: string) => raw<AdminTokens & { admin: AdminProfile }>('/admin/auth/login', { method: 'POST', body: JSON.stringify({ identifier, password }) }),
  refresh: (refreshToken: string) => raw<AdminTokens>('/admin/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken }) }),
  logout: (refreshToken: string) => raw<void>('/admin/auth/logout', { method: 'POST', body: JSON.stringify({ refreshToken }) }),
};

export const adminApi = {
  dashboard: (t: string) => adminReq<AdminDashboard>('/admin/dashboard', t),
  organizations: (t: string, search?: string) => adminReq<AdminOrgRow[]>(`/admin/organizations${search ? `?search=${encodeURIComponent(search)}` : ''}`, t),
  organization: (t: string, id: string) => adminReq<AdminOrgDetail>(`/admin/organizations/${id}`, t),
  setModule: (t: string, id: string, key: string, action: 'activate' | 'suspend' | 'cancel', force?: boolean) =>
    adminReq<{ key: string; status: string }>(`/admin/organizations/${id}/modules/${key}`, t, { method: 'POST', body: JSON.stringify({ action, force }) }),
  setSeats: (t: string, id: string, seatsPerSite: number) => adminReq<{ seatsPerSite: number }>(`/admin/organizations/${id}/seats`, t, { method: 'PATCH', body: JSON.stringify({ seatsPerSite }) }),
  createUser: (t: string, id: string, data: import('../lib/api').MemberInput) => adminReq<import('../lib/api').MemberView>(`/admin/organizations/${id}/users`, t, { method: 'POST', body: JSON.stringify(data) }),
  grantableModules: (t: string) => adminReq<import('../lib/api').GrantableModule[]>('/admin/grantable-modules', t),
  updateUserAccount: (t: string, id: string, userId: string, data: { displayName?: string; username?: string; email?: string; password?: string; isActive?: boolean }) => adminReq<{ ok: boolean }>(`/admin/organizations/${id}/users/${userId}/account`, t, { method: 'PATCH', body: JSON.stringify(data) }),
  updateUser: (t: string, id: string, userId: string, data: Record<string, unknown>) => adminReq<import('../lib/api').MemberView>(`/admin/organizations/${id}/users/${userId}`, t, { method: 'PATCH', body: JSON.stringify(data) }),
  setDevice: (t: string, deviceId: string, action: 'deactivate' | 'revoke') => adminReq<{ id: string; status: string }>(`/admin/devices/${deviceId}/set`, t, { method: 'POST', body: JSON.stringify({ action }) }),
  pricing: (t: string) => adminReq<AdminPrice[]>('/admin/pricing', t),
  setPrice: (t: string, moduleKey: string, monthlyPrice: number, isActive: boolean) => adminReq<AdminPrice>(`/admin/pricing/${moduleKey}`, t, { method: 'PATCH', body: JSON.stringify({ monthlyPrice, isActive }) }),
  payments: (t: string) => adminReq<AdminPayment[]>('/admin/payments', t),
  suggestions: (t: string) => adminReq<AdminSuggestion[]>('/admin/suggestions', t),
  updateSuggestion: (t: string, id: string, data: { status?: string; adminNote?: string }) => adminReq<AdminSuggestion>(`/admin/suggestions/${id}`, t, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteSuggestion: (t: string, id: string) => adminReq<{ ok: boolean }>(`/admin/suggestions/${id}`, t, { method: 'DELETE' }),
  logs: (t: string) => adminReq<AdminLogRow[]>('/admin/logs', t),
  schema: (t: string) => adminReq<SchemaTable[]>('/admin/schema', t),
  sql: (t: string, sql: string, write?: boolean, confirm?: string) => adminReq<SqlResult>('/admin/sql', t, { method: 'POST', body: JSON.stringify({ sql, write, confirm }) }),
};
