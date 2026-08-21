// Thin fetch wrapper. VITE_API_URL lets this point elsewhere (e.g. a
// deployed API) without a code change; falls back to the local NestJS dev
// server per docs/Action Plan.md's quickstart.
const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000/api';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: { message?: string | string[]; error?: string } | undefined,
  ) {
    super(
      Array.isArray(body?.message) ? body.message.join(', ') : (body?.message ?? `Request failed with status ${status}`),
    );
  }
}

async function rawRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
  });
  const body = await res.json().catch(() => undefined);
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export const authApi = {
  signup: (data: { organizationName: string; email: string; password: string }) =>
    rawRequest<TokenPair>('/auth/signup', { method: 'POST', body: JSON.stringify(data) }),
  login: (data: { email: string; password: string }) =>
    rawRequest<TokenPair>('/auth/login', { method: 'POST', body: JSON.stringify(data) }),
  refresh: (refreshToken: string) =>
    rawRequest<TokenPair>('/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken }) }),
  logout: (refreshToken: string) =>
    rawRequest<void>('/auth/logout', { method: 'POST', body: JSON.stringify({ refreshToken }) }),
  logoutEverywhere: (accessToken: string) =>
    rawRequest<void>('/auth/logout-everywhere', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    }),
};

export function authedRequest<T>(path: string, accessToken: string, options: RequestInit = {}): Promise<T> {
  return rawRequest<T>(path, {
    ...options,
    headers: { ...(options.headers ?? {}), Authorization: `Bearer ${accessToken}` },
  });
}
