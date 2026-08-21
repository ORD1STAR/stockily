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

export interface ProductCategory {
  id: string;
  name: string;
  parentId: string | null;
}

export const stockApi = {
  listProducts: (token: string, siteId: string) => authedRequest<StockRow[]>(`/stock/products?siteId=${encodeURIComponent(siteId)}`, token),
  getProduct: (token: string, productId: string) => authedRequest<ProductDetail>(`/stock/products/${productId}`, token),
  createProduct: (
    token: string,
    data: { sku: string; name: string; categoryId?: string; isLotTracked?: boolean; minThreshold?: number; maxThreshold?: number },
  ) => authedRequest<ProductDetail>('/stock/products', token, { method: 'POST', body: JSON.stringify(data) }),
  listCategories: (token: string) => authedRequest<ProductCategory[]>('/stock/categories', token),
  createCategory: (token: string, data: { name: string; parentId?: string }) =>
    authedRequest<ProductCategory>('/stock/categories', token, { method: 'POST', body: JSON.stringify(data) }),
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

export interface Partner {
  id: string;
  name: string;
  isCustomer: boolean;
  isSupplier: boolean;
  nif: string;
  nis: string | null;
  rc: string | null;
  taxArticle: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
}

export interface TaxRate {
  id: string;
  name: string;
  rate: number;
  isDefault: boolean;
}

export interface OrganizationProfile {
  id: string;
  name: string;
  address: string | null;
  nif: string | null;
  nis: string | null;
  rc: string | null;
  taxArticle: string | null;
  phone: string | null;
  email: string | null;
}

export interface InvoiceLineView {
  id: string;
  productId: string | null;
  product: { name: string } | null;
  description: string;
  quantity: number;
  unitPrice: number;
  discountPercent: number | null;
  discountAmount: number | null;
  taxRate: TaxRate | null;
}

export interface InvoiceView {
  id: string;
  type: 'CUSTOMER' | 'SUPPLIER';
  number: string | null;
  status: 'draft' | 'unpaid' | 'partially_paid' | 'paid' | 'void';
  siteId: string;
  site?: { name: string };
  partnerId: string | null;
  partner: { name: string; nif: string } | null;
  issuedAt: string;
  finalizedAt: string | null;
  lines: InvoiceLineView[];
  totals: { totalHt: number; totalTax: number; totalTtc: number; totalInWordsFr: string; totalInWordsAr: string };
  totalPaid: number;
  balance: number;
}

export const invoicingApi = {
  listPartners: (token: string) => authedRequest<Partner[]>('/invoicing/partners', token),
  createPartner: (token: string, data: Omit<Partner, 'id'>) =>
    authedRequest<Partner>('/invoicing/partners', token, { method: 'POST', body: JSON.stringify(data) }),
  listTaxRates: (token: string) => authedRequest<TaxRate[]>('/invoicing/tax-rates', token),
  getOrganizationProfile: (token: string) => authedRequest<OrganizationProfile>('/invoicing/organization-profile', token),
  updateOrganizationProfile: (token: string, data: Partial<Omit<OrganizationProfile, 'id'>>) =>
    authedRequest<OrganizationProfile>('/invoicing/organization-profile', token, { method: 'POST', body: JSON.stringify(data) }),
  listInvoices: (token: string, status?: string) =>
    authedRequest<InvoiceView[]>(`/invoicing/invoices${status ? `?status=${encodeURIComponent(status)}` : ''}`, token),
  getInvoice: (token: string, id: string) => authedRequest<InvoiceView>(`/invoicing/invoices/${id}`, token),
  createInvoice: (
    token: string,
    data: {
      type: 'CUSTOMER' | 'SUPPLIER';
      siteId: string;
      partnerId?: string;
      number?: string;
      lines: { productId?: string; description: string; quantity: number; unitPrice: number; taxRateId?: string }[];
    },
  ) => authedRequest<InvoiceView>('/invoicing/invoices', token, { method: 'POST', body: JSON.stringify(data) }),
  finalizeInvoice: (token: string, id: string) => authedRequest<InvoiceView>(`/invoicing/invoices/${id}/finalize`, token, { method: 'POST' }),
  voidInvoice: (token: string, id: string) => authedRequest<InvoiceView>(`/invoicing/invoices/${id}/void`, token, { method: 'POST' }),
  recordPayment: (token: string, id: string, data: { amount: number; method?: string }) =>
    authedRequest(`/invoicing/invoices/${id}/payments`, token, { method: 'POST', body: JSON.stringify(data) }),
  // Not JSON — fetched directly (not via authedRequest/rawRequest, which
  // always parse a JSON body) so the real PDF bytes can be opened in a new
  // tab via an object URL, giving a genuine print/download action rather
  // than a window.print() on an HTML mock.
  fetchPdf: async (token: string, id: string): Promise<Blob> => {
    const res = await fetch(`${API_BASE}/invoicing/invoices/${id}/pdf`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => undefined));
    return res.blob();
  },
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

export interface ScanResolution {
  product: { id: string; sku: string; name: string; isLotTracked: boolean };
  matchedBatch: { id: string; lotNumber: string; expiryDate: string | null } | null;
  suggestedBatch: { id: string; lotNumber: string; expiryDate: string | null } | null;
}

export interface BarcodeLabelView {
  id: string;
  codeValue: string;
  symbology: string;
  printedCount: number;
  product: { sku: string; name: string } | null;
  batch: { lotNumber: string } | null;
}

export const scanApi = {
  resolveCode: (token: string, code: string) => authedRequest<ScanResolution>(`/scan/resolve/${encodeURIComponent(code)}`, token),
  listLabels: (token: string, productId?: string) =>
    authedRequest<BarcodeLabelView[]>(`/scan/labels${productId ? `?productId=${encodeURIComponent(productId)}` : ''}`, token),
  generateLabel: (token: string, data: { productId?: string; batchId?: string; symbology?: 'EAN13' | 'QR' }) =>
    authedRequest<BarcodeLabelView>('/scan/labels', token, { method: 'POST', body: JSON.stringify(data) }),
  recordPrint: (token: string, id: string) => authedRequest<BarcodeLabelView>(`/scan/labels/${id}/print`, token, { method: 'POST' }),
};
