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

export interface StockRow {
  productId: string;
  sku: string;
  name: string;
  category: string | null;
  isLotTracked: boolean;
  site: { id: string; name: string };
  quantityOnHand: number;
  quantityQuarantined: number;
  minThreshold: number | null;
  averageCost: number;
  status: 'ok' | 'low' | 'out';
}

export interface ProductDetail {
  id: string;
  sku: string;
  name: string;
  category: string | null;
  isLotTracked: boolean;
  averageCost: number;
  minThreshold: number | null;
  maxThreshold: number | null;
  levels: { site: { id: string; name: string }; quantityOnHand: number; quantityQuarantined: number }[];
}

export interface Site {
  id: string;
  name: string;
  address: string | null;
  isActive: boolean;
}

export interface Transfer {
  id: string;
  status: 'prepared' | 'in_transit' | 'delivered';
  fromSiteId: string;
  toSiteId: string;
  fromSite: { name: string };
  toSite: { name: string };
  driverName: string | null;
  driverPhone: string | null;
  vehicleRef: string | null;
  createdAt: string;
}

export const stockApi = {
  listProducts: (token: string, siteId: string) => authedRequest<StockRow[]>(`/stock/products?siteId=${encodeURIComponent(siteId)}`, token),
  getProduct: (token: string, productId: string) => authedRequest<ProductDetail>(`/stock/products/${productId}`, token),
  createProduct: (token: string, data: { sku: string; name: string; isLotTracked?: boolean; minThreshold?: number; maxThreshold?: number }) =>
    authedRequest<ProductDetail>('/stock/products', token, { method: 'POST', body: JSON.stringify(data) }),
  recordMovement: (
    token: string,
    data: {
      productId: string;
      siteId: string;
      type: 'IN' | 'OUT' | 'TRANSFER' | 'ADJUSTMENT';
      quantity: number;
      unitCost?: number;
      toSiteId?: string;
      adjustmentDirection?: 'increase' | 'decrease';
    },
  ) => authedRequest('/stock/movements', token, { method: 'POST', body: JSON.stringify(data) }),
};

export interface Batch {
  id: string;
  productId: string;
  lotNumber: string;
  expiryDate: string | null;
  quantityReceived: number;
  receivedAt: string;
  status: 'active' | 'quarantined' | 'depleted';
  latestCheck: { result: 'conforme' | 'non_conforme'; checkedAt: string } | null;
}

export interface NonConformity {
  id: string;
  productId: string;
  batchId: string | null;
  severity: string;
  status: 'open' | 'resolved';
  resolutionNotes: string | null;
  createdAt: string;
}

export interface ExpiryAlert {
  id: string;
  batchId: string;
  alertedAt: string;
  batch: { lotNumber: string; expiryDate: string | null; product: { id: string; sku: string; name: string } };
}

export const qualityApi = {
  listBatches: (token: string, productId?: string) =>
    authedRequest<Batch[]>(`/quality/batches${productId ? `?productId=${encodeURIComponent(productId)}` : ''}`, token),
  createBatch: (token: string, data: { productId: string; lotNumber: string; expiryDate?: string; quantityReceived: number }) =>
    authedRequest<Batch>('/quality/batches', token, { method: 'POST', body: JSON.stringify(data) }),
  recordCheck: (
    token: string,
    data: {
      productId: string;
      batchId?: string;
      siteId?: string;
      quantity?: number;
      result: 'conforme' | 'non_conforme';
      notes?: string;
    },
  ) => authedRequest('/quality/checks', token, { method: 'POST', body: JSON.stringify(data) }),
  listNonConformities: (token: string, status?: 'open' | 'resolved') =>
    authedRequest<NonConformity[]>(`/quality/non-conformities${status ? `?status=${status}` : ''}`, token),
  resolveNonConformity: (token: string, id: string, resolutionNotes?: string) =>
    authedRequest<NonConformity>(`/quality/non-conformities/${id}/resolve`, token, {
      method: 'POST',
      body: JSON.stringify({ resolutionNotes }),
    }),
  listExpiryAlerts: (token: string) => authedRequest<ExpiryAlert[]>('/quality/expiry-alerts', token),
};

export const sitesApi = {
  list: (token: string) => authedRequest<Site[]>('/sites', token),
  create: (token: string, data: { name: string; address?: string }) =>
    authedRequest<Site>('/sites', token, { method: 'POST', body: JSON.stringify(data) }),
  listTransfers: (token: string) => authedRequest<Transfer[]>('/sites/transfers', token),
  createTransfer: (token: string, data: { productId: string; fromSiteId: string; toSiteId: string; quantity: number }) =>
    authedRequest<Transfer>('/sites/transfers', token, { method: 'POST', body: JSON.stringify(data) }),
  updateTransfer: (
    token: string,
    id: string,
    data: { status?: Transfer['status']; driverName?: string; driverPhone?: string; vehicleRef?: string },
  ) => authedRequest<Transfer>(`/sites/transfers/${id}`, token, { method: 'PATCH', body: JSON.stringify(data) }),
};
