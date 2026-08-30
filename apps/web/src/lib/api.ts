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

// The access token has a short TTL (15 minutes — apps/api's JWT_ACCESS_TTL)
// and, until this, was never refreshed except on a full page reload. Any
// request made after it expired — including one mid-way through filling out
// a long form, like a real multi-line wholesale invoice — surfaced a raw
// "Invalid or expired access token" and threw away whatever the user had
// just entered, since the failed submit doesn't preserve the modal's state
// across the resulting forced re-login. Found by actually taking the few
// minutes a real order takes to fill in and hitting exactly that wall.
//
// REFRESH_TOKEN_STORAGE_KEY lives here (not auth-context.tsx) so this
// module — which has no React dependency — can silently refresh on its own;
// auth-context registers a callback via setSilentRefreshHandler so its own
// in-memory accessToken stays in sync with whatever this module rotates to,
// instead of the two drifting apart.
export const REFRESH_TOKEN_STORAGE_KEY = 'stockily.refreshToken';

let onSilentRefresh: ((tokens: TokenPair) => void) | null = null;
export function setSilentRefreshHandler(fn: ((tokens: TokenPair) => void) | null) {
  onSilentRefresh = fn;
}

// Several requests can hit a 401 around the same moment (e.g. a page's
// initial Promise.all of several endpoints) — coalesced into one in-flight
// refresh instead of each independently calling /auth/refresh with the same
// now-stale token, which would just race each other if refresh tokens
// rotate on use.
let refreshInFlight: Promise<string> | null = null;

function silentlyRefreshAccessToken(): Promise<string> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const stored = localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY);
      if (!stored) throw new ApiError(401, { message: 'No refresh token available' });
      const tokens = await authApi.refresh(stored);
      localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, tokens.refreshToken);
      onSilentRefresh?.(tokens);
      return tokens.accessToken;
    })().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

export async function authedRequest<T>(path: string, accessToken: string, options: RequestInit = {}): Promise<T> {
  try {
    return await rawRequest<T>(path, {
      ...options,
      headers: { ...(options.headers ?? {}), Authorization: `Bearer ${accessToken}` },
    });
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 401) throw err;
    const freshAccessToken = await silentlyRefreshAccessToken();
    return rawRequest<T>(path, {
      ...options,
      headers: { ...(options.headers ?? {}), Authorization: `Bearer ${freshAccessToken}` },
    });
  }
}

export interface StockRow {
  productId: string;
  sku: string;
  name: string;
  barcode: string | null;
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
  barcode: string | null;
  category: string | null;
  isLotTracked: boolean;
  averageCost: number;
  minThreshold: number | null;
  maxThreshold: number | null;
  sellPrice: number | null;
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
    data: {
      sku: string;
      name: string;
      categoryId?: string;
      isLotTracked?: boolean;
      minThreshold?: number;
      maxThreshold?: number;
      sellPrice?: number;
      barcode?: string;
    },
  ) => authedRequest<ProductDetail>('/stock/products', token, { method: 'POST', body: JSON.stringify(data) }),
  updateProduct: (
    token: string,
    productId: string,
    data: { name?: string; isLotTracked?: boolean; minThreshold?: number; maxThreshold?: number; sellPrice?: number; barcode?: string },
  ) => authedRequest<ProductDetail>(`/stock/products/${productId}`, token, { method: 'PATCH', body: JSON.stringify(data) }),
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
      batchId?: string;
      unitCost?: number;
      toSiteId?: string;
      adjustmentDirection?: 'increase' | 'decrease';
      partnerId?: string;
    },
  ) => authedRequest('/stock/movements', token, { method: 'POST', body: JSON.stringify(data) }),
};

export interface Batch {
  id: string;
  productId: string;
  lotNumber: string;
  expiryDate: string | null;
  quantityReceived: number;
  remainingQuantity: number;
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
  paymentTermsNetDays: number | null;
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
  logo: string | null;
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
  purchaseOrderId: string | null;
  salesOrderId: string | null;
  issuedAt: string;
  finalizedAt: string | null;
  dueDate: string | null;
  lines: InvoiceLineView[];
  totals: { totalHt: number; totalTax: number; totalTtc: number; totalInWordsFr: string; totalInWordsAr: string };
  totalPaid: number;
  balance: number;
}

export const invoicingApi = {
  listPartners: (token: string) => authedRequest<Partner[]>('/invoicing/partners', token),
  createPartner: (token: string, data: Omit<Partner, 'id'>) =>
    authedRequest<Partner>('/invoicing/partners', token, { method: 'POST', body: JSON.stringify(data) }),
  updatePartner: (token: string, id: string, data: Partial<Omit<Partner, 'id'>>) =>
    authedRequest<Partner>(`/invoicing/partners/${id}`, token, { method: 'PATCH', body: JSON.stringify(data) }),
  listTaxRates: (token: string) => authedRequest<TaxRate[]>('/invoicing/tax-rates', token),
  createTaxRate: (token: string, data: { name: string; rate: number; isDefault?: boolean }) =>
    authedRequest<TaxRate>('/invoicing/tax-rates', token, { method: 'POST', body: JSON.stringify(data) }),
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
      purchaseOrderId?: string;
      salesOrderId?: string;
      lines: { productId?: string; description: string; quantity: number; unitPrice: number; taxRateId?: string; salesOrderLineId?: string }[];
    },
  ) => authedRequest<InvoiceView>('/invoicing/invoices', token, { method: 'POST', body: JSON.stringify(data) }),
  finalizeInvoice: (token: string, id: string) => authedRequest<InvoiceView>(`/invoicing/invoices/${id}/finalize`, token, { method: 'POST' }),
  voidInvoice: (token: string, id: string) => authedRequest<InvoiceView>(`/invoicing/invoices/${id}/void`, token, { method: 'POST' }),
  recordPayment: (token: string, id: string, data: { amount: number; method?: string }) =>
    authedRequest(`/invoicing/invoices/${id}/payments`, token, { method: 'POST', body: JSON.stringify(data) }),
  resetPayments: (token: string, id: string) => authedRequest(`/invoicing/invoices/${id}/payments/reset`, token, { method: 'POST' }),
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
  product: { id: string; sku: string; name: string; isLotTracked: boolean; sellPrice: number | null };
  matchedBatch: { id: string; lotNumber: string; expiryDate: string | null } | null;
  suggestedBatch: { id: string; lotNumber: string; expiryDate: string | null } | null;
  availableQuantity: number | null;
}

export interface BarcodeLabelView {
  id: string;
  codeValue: string;
  symbology: string;
  printedCount: number;
  product: { sku: string; name: string } | null;
  batch: { lotNumber: string } | null;
}

export interface PurchaseOrderLineView {
  id: string;
  productId: string;
  product?: { sku: string; name: string };
  quantityOrdered: number;
  quantityReceived: number;
  unitCost: number;
}

export interface PurchaseOrderView {
  id: string;
  number: string | null;
  status: 'draft' | 'confirmed' | 'partially_received' | 'received' | 'cancelled' | 'rfq' | 'rfq_rejected';
  siteId: string;
  site: { name: string };
  supplierId: string;
  supplier: { name: string };
  expectedDate: string | null;
  notes: string | null;
  createdAt: string;
  comparisonGroupId: string | null;
  lines: PurchaseOrderLineView[];
  receipts?: { id: string; receivedAt: string }[];
}

export interface PurchaseReceiptLineView {
  id: string;
  purchaseOrderLineId: string | null;
  productId: string;
  product?: { sku: string; name: string };
  quantityReceived: number;
  unitCost: number;
  landedCostShare: number | null;
  batchId: string | null;
  qualityCheckId: string | null;
}

export interface PurchaseReceiptView {
  id: string;
  purchaseOrderId: string | null;
  siteId: string;
  site: { name: string };
  landedCostAmount: number | null;
  landedCostNotes: string | null;
  receivedAt: string;
  notes: string | null;
  lines: PurchaseReceiptLineView[];
}

export const purchasingApi = {
  listOrders: (token: string, siteId?: string) =>
    authedRequest<PurchaseOrderView[]>(`/purchasing/orders${siteId ? `?siteId=${encodeURIComponent(siteId)}` : ''}`, token),
  getOrder: (token: string, id: string) => authedRequest<PurchaseOrderView>(`/purchasing/orders/${id}`, token),
  createOrder: (
    token: string,
    data: {
      siteId: string;
      supplierId: string;
      expectedDate?: string;
      notes?: string;
      lines: { productId: string; quantityOrdered: number; unitCost: number }[];
    },
  ) => authedRequest<PurchaseOrderView>('/purchasing/orders', token, { method: 'POST', body: JSON.stringify(data) }),
  cancelOrder: (token: string, id: string) =>
    authedRequest<PurchaseOrderView>(`/purchasing/orders/${id}`, token, { method: 'PATCH', body: JSON.stringify({ status: 'cancelled' }) }),
  listReceipts: (token: string, purchaseOrderId?: string) =>
    authedRequest<PurchaseReceiptView[]>(`/purchasing/receipts${purchaseOrderId ? `?purchaseOrderId=${encodeURIComponent(purchaseOrderId)}` : ''}`, token),
  receiveGoods: (
    token: string,
    data: {
      purchaseOrderId?: string;
      siteId: string;
      notes?: string;
      landedCostAmount?: number;
      landedCostNotes?: string;
      lines: {
        purchaseOrderLineId?: string;
        productId: string;
        quantity: number;
        unitCost: number;
        newLot?: { lotNumber: string; expiryDate?: string };
        existingBatchId?: string;
        qualityResult?: 'conforme' | 'non_conforme';
        qualityNotes?: string;
      }[];
    },
  ) => authedRequest<PurchaseReceiptView>('/purchasing/receipts', token, { method: 'POST', body: JSON.stringify(data) }),
  createSupplierInvoice: (
    token: string,
    purchaseOrderId: string,
    data: { number: string; lines: { productId?: string; description: string; quantity: number; unitPrice: number; taxRateId?: string }[] },
  ) => authedRequest<InvoiceView>(`/purchasing/orders/${purchaseOrderId}/invoice`, token, { method: 'POST', body: JSON.stringify(data) }),
  createRfq: (token: string, data: { siteId: string; supplierIds: string[]; productLines: { productId: string; quantity: number }[] }) =>
    authedRequest<{ comparisonGroupId: string; candidates: PurchaseOrderView[] }>('/purchasing/rfq', token, { method: 'POST', body: JSON.stringify(data) }),
  getRfqGroup: (token: string, groupId: string) => authedRequest<PurchaseOrderView[]>(`/purchasing/rfq/${groupId}`, token),
  awardRfq: (token: string, groupId: string, purchaseOrderId: string) =>
    authedRequest<PurchaseOrderView>(`/purchasing/rfq/${groupId}/award/${purchaseOrderId}`, token, { method: 'POST' }),
  updateRfqPrices: (token: string, purchaseOrderId: string, data: { lines: { lineId: string; unitCost: number }[] }) =>
    authedRequest<PurchaseOrderView>(`/purchasing/rfq/orders/${purchaseOrderId}/prices`, token, { method: 'PATCH', body: JSON.stringify(data) }),
  getLastPricePaid: (token: string, productId: string, supplierId?: string) =>
    authedRequest<{ unitCost: number; receivedAt: string; supplier: { id: string; name: string } | null } | null>(
      `/purchasing/products/${productId}/last-price${supplierId ? `?supplierId=${encodeURIComponent(supplierId)}` : ''}`,
      token,
    ),
  getDashboard: (token: string) =>
    authedRequest<{
      openOrdersCount: number;
      openOrdersValue: number;
      overdueCount: number;
      overdueOrders: { id: string; number: string | null; supplier: string; expectedDate: string | null }[];
      expectedSoonCount: number;
    }>('/purchasing/dashboard', token),
  // Not JSON — same rationale as invoicingApi.fetchPdf: real PDF bytes,
  // opened in a new tab via an object URL.
  fetchOrderPdf: async (token: string, id: string): Promise<Blob> => {
    const res = await fetch(`${API_BASE}/purchasing/orders/${id}/pdf`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => undefined));
    return res.blob();
  },
  fetchReceiptPdf: async (token: string, id: string): Promise<Blob> => {
    const res = await fetch(`${API_BASE}/purchasing/receipts/${id}/pdf`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => undefined));
    return res.blob();
  },
};

export interface SalesOrderLineView {
  id: string;
  productId: string | null;
  product?: { sku: string; name: string } | null;
  description: string;
  quantityOrdered: number;
  quantityInvoiced: number;
  unitPrice: number;
  discountPercent: number | null;
  taxRateId: string | null;
}

export interface SalesOrderView {
  id: string;
  kind: 'quote' | 'order';
  number: string | null;
  promotedFromQuoteNumber: string | null;
  // quote: draft | sent | accepted | expired | cancelled
  // order: confirmed | partially_invoiced | invoiced | cancelled
  status: string;
  siteId: string;
  site: { name: string };
  customerId: string;
  customer: { name: string };
  expectedDate: string | null;
  notes: string | null;
  createdAt: string;
  lines: SalesOrderLineView[];
  invoices?: { id: string; number: string | null; status: string }[];
}

export interface PartnerProductPriceView {
  id: string;
  partnerId: string;
  partner?: { name: string };
  productId: string;
  product?: { sku: string; name: string };
  unitPrice: number | null;
  discountPercent: number | null;
}

export const salesApi = {
  listOrders: (token: string, filters?: { kind?: 'quote' | 'order'; siteId?: string; customerId?: string }) => {
    const params = new URLSearchParams();
    if (filters?.kind) params.set('kind', filters.kind);
    if (filters?.siteId) params.set('siteId', filters.siteId);
    if (filters?.customerId) params.set('customerId', filters.customerId);
    const qs = params.toString();
    return authedRequest<SalesOrderView[]>(`/sales/orders${qs ? `?${qs}` : ''}`, token);
  },
  getOrder: (token: string, id: string) => authedRequest<SalesOrderView>(`/sales/orders/${id}`, token),
  createOrder: (
    token: string,
    data: {
      kind: 'quote' | 'order';
      siteId: string;
      customerId: string;
      expectedDate?: string;
      notes?: string;
      acknowledgeShortage?: boolean;
      lines: { productId?: string; description?: string; quantity: number; unitPrice?: number; discountPercent?: number; taxRateId?: string }[];
    },
  ) => authedRequest<SalesOrderView>('/sales/orders', token, { method: 'POST', body: JSON.stringify(data) }),
  cancelOrder: (token: string, id: string) =>
    authedRequest<SalesOrderView>(`/sales/orders/${id}/status`, token, { method: 'PATCH', body: JSON.stringify({ action: 'cancelled' }) }),
  promoteOrder: (token: string, id: string, acknowledgeShortage?: boolean) =>
    authedRequest<SalesOrderView>(`/sales/orders/${id}/status`, token, {
      method: 'PATCH',
      body: JSON.stringify({ action: 'promote', acknowledgeShortage }),
    }),
  invoiceOrder: (token: string, id: string, data: { lines: { salesOrderLineId: string; quantity: number }[] }) =>
    authedRequest<InvoiceView>(`/sales/orders/${id}/invoice`, token, { method: 'POST', body: JSON.stringify(data) }),
  listPricing: (token: string, partnerId?: string) =>
    authedRequest<PartnerProductPriceView[]>(`/sales/pricing${partnerId ? `?partnerId=${encodeURIComponent(partnerId)}` : ''}`, token),
  upsertPricing: (token: string, data: { partnerId: string; productId: string; unitPrice?: number; discountPercent?: number }) =>
    authedRequest<PartnerProductPriceView>('/sales/pricing', token, { method: 'POST', body: JSON.stringify(data) }),
  deletePricing: (token: string, id: string) => authedRequest<void>(`/sales/pricing/${id}`, token, { method: 'DELETE' }),
  getDashboard: (token: string) =>
    authedRequest<{
      openQuotesCount: number;
      openOrdersCount: number;
      openOrdersValue: number;
      overdueCount: number;
      overdueOrders: { id: string; number: string | null; customer: string; expectedDate: string | null }[];
    }>('/sales/dashboard', token),
  // Not JSON — same rationale as invoicingApi.fetchPdf: real PDF bytes,
  // opened in a new tab via an object URL.
  fetchOrderPdf: async (token: string, id: string): Promise<Blob> => {
    const res = await fetch(`${API_BASE}/sales/orders/${id}/pdf`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => undefined));
    return res.blob();
  },
  fetchDeliveryNotePdf: async (token: string, id: string): Promise<Blob> => {
    const res = await fetch(`${API_BASE}/sales/orders/${id}/delivery-note`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => undefined));
    return res.blob();
  },
};

export const scanApi = {
  resolveCode: (token: string, code: string, siteId?: string) =>
    authedRequest<ScanResolution>(`/scan/resolve/${encodeURIComponent(code)}${siteId ? `?siteId=${encodeURIComponent(siteId)}` : ''}`, token),
  listLabels: (token: string, productId?: string) =>
    authedRequest<BarcodeLabelView[]>(`/scan/labels${productId ? `?productId=${encodeURIComponent(productId)}` : ''}`, token),
  generateLabel: (token: string, data: { productId?: string; batchId?: string; symbology?: 'EAN13' | 'QR' }) =>
    authedRequest<BarcodeLabelView>('/scan/labels', token, { method: 'POST', body: JSON.stringify(data) }),
  recordPrint: (token: string, id: string) => authedRequest<BarcodeLabelView>(`/scan/labels/${id}/print`, token, { method: 'POST' }),
  // Not JSON — same rationale as invoicingApi.fetchPdf: real PDF bytes,
  // opened via an object URL rather than parsed as a JSON body.
  fetchLabelPdf: async (token: string, id: string): Promise<Blob> => {
    const res = await fetch(`${API_BASE}/scan/labels/${id}/pdf`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => undefined));
    return res.blob();
  },
};
