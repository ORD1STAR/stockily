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
      Array.isArray(body?.message) ? body.message.join(', ') : (body?.message ?? `La requête a échoué (statut ${status}).`),
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
  /** Set on a variant (taille/couleur): its modèle. */
  parentId: string | null;
  size: string | null;
  color: string | null;
  /** A modèle with tailles/couleurs: no stock of its own, quantities = sum of its variants. */
  isVariantParent: boolean;
  sku: string;
  name: string;
  barcode: string | null;
  category: string | null;
  isLotTracked: boolean;
  unitsPerCarton: number | null;
  site: { id: string; name: string };
  quantityOnHand: number;
  quantityQuarantined: number;
  quantityReserved: number;
  minThreshold: number | null;
  averageCost: number;
  sellPrice: number | null;
  sellPrice2: number | null;
  margin1: number | null;
  margin2: number | null;
  status: 'ok' | 'low' | 'out';
}

export interface ProductDetail {
  id: string;
  sku: string;
  name: string;
  barcode: string | null;
  categoryId: string | null;
  category: string | null;
  isLotTracked: boolean;
  unitsPerCarton: number | null;
  averageCost: number;
  minThreshold: number | null;
  maxThreshold: number | null;
  sellPrice: number | null;
  sellPrice2: number | null;
  parent: { id: string; name: string; sku: string } | null;
  size: string | null;
  color: string | null;
  variantSizes: string[];
  variantColors: string[];
  variants: {
    id: string;
    sku: string;
    name: string;
    size: string | null;
    color: string | null;
    barcode: string | null;
    sellPrice: number | null;
    sellPrice2: number | null;
    quantityOnHand: number;
    quantityReserved: number;
  }[];
  levels: { site: { id: string; name: string }; quantityOnHand: number; quantityQuarantined: number }[];
}

export interface ProductUsage {
  stockOnHand: number;
  stockMovements: number;
  batches: number;
  invoiceLines: number;
  purchaseOrderLines: number;
  purchaseReceiptLines: number;
  salesOrderLines: number;
  partnerPrices: number;
  qualityChecks: number;
  nonConformities: number;
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
  /** includeParents: also return the modèles (Stock page); pickers leave it off and only get sellable products/variants. */
  listProducts: (token: string, siteId: string, includeParents = false) =>
    authedRequest<StockRow[]>(`/stock/products?siteId=${encodeURIComponent(siteId)}${includeParents ? '&includeParents=1' : ''}`, token),
  setVariants: (token: string, productId: string, data: { sizes: string[]; colors: string[] }) =>
    authedRequest<ProductDetail>(`/stock/products/${productId}/variants`, token, { method: 'PUT', body: JSON.stringify(data) }),
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
      sellPrice2?: number;
      barcode?: string;
      unitsPerCarton?: number | null;
    },
  ) => authedRequest<ProductDetail>('/stock/products', token, { method: 'POST', body: JSON.stringify(data) }),
  updateProduct: (
    token: string,
    productId: string,
    data: {
      name?: string;
      categoryId?: string;
      isLotTracked?: boolean;
      minThreshold?: number;
      maxThreshold?: number;
      sellPrice?: number;
      sellPrice2?: number;
      barcode?: string;
      unitsPerCarton?: number | null;
    },
  ) => authedRequest<ProductDetail>(`/stock/products/${productId}`, token, { method: 'PATCH', body: JSON.stringify(data) }),
  getProductUsage: (token: string, productId: string) => authedRequest<ProductUsage>(`/stock/products/${productId}/usage`, token),
  deleteProduct: (token: string, productId: string) => authedRequest<void>(`/stock/products/${productId}`, token, { method: 'DELETE' }),
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
  nif: string | null;
  nis: string | null;
  rc: string | null;
  taxArticle: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  paymentTermsNetDays: number | null;
  code: string | null;
  openingBalance: number;
  priceTier: number;
  /** Net balance (computed by the API from bons, invoices and payments). */
  balance: number;
  customerBalance: number;
  supplierBalance: number;
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
  /** Droit de timbre on cash invoices (%), null = disabled. */
  stampDutyRate: number | null;
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
  status: 'draft' | 'unpaid' | 'partially_paid' | 'paid' | 'void' | 'proforma';
  kind: 'invoice' | 'proforma';
  /** Generated from bons de livraison — the stock already left with the BL. */
  fromDocuments: boolean;
  siteId: string;
  site?: { name: string };
  partnerId: string | null;
  partner: { name: string; nif: string | null } | null;
  purchaseOrderId: string | null;
  salesOrderId: string | null;
  issuedAt: string;
  finalizedAt: string | null;
  dueDate: string | null;
  lines: InvoiceLineView[];
  totals: { totalHt: number; totalTax: number; totalTtc: number; stampDuty: number; netToPay: number; totalInWordsFr: string; totalInWordsAr: string };
  paymentMode: 'especes' | 'cheque' | 'virement' | 'terme' | null;
  totalPaid: number;
  balance: number;
  /** Bons de livraison this invoice was generated from. */
  deliveryNotes?: { id: string; number: string; type: string }[];
}

export const invoicingApi = {
  listPartners: (token: string) => authedRequest<Partner[]>('/invoicing/partners', token),
  createPartner: (token: string, data: Partial<Omit<Partner, 'id' | 'balance'>> & { name: string }) =>
    authedRequest<Partner>('/invoicing/partners', token, { method: 'POST', body: JSON.stringify(data) }),
  updatePartner: (token: string, id: string, data: Partial<Omit<Partner, 'id' | 'balance'>>) =>
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
      kind?: 'invoice' | 'proforma';
      paymentMode?: 'especes' | 'cheque' | 'virement' | 'terme';
      lines: { productId?: string; description: string; quantity: number; unitPrice: number; taxRateId?: string; salesOrderLineId?: string }[];
    },
  ) => authedRequest<InvoiceView>('/invoicing/invoices', token, { method: 'POST', body: JSON.stringify(data) }),
  convertProforma: (token: string, id: string) => authedRequest<InvoiceView>(`/invoicing/invoices/${id}/convert`, token, { method: 'POST' }),
  finalizeInvoice: (token: string, id: string) => authedRequest<InvoiceView>(`/invoicing/invoices/${id}/finalize`, token, { method: 'POST' }),
  voidInvoice: (token: string, id: string) => authedRequest<InvoiceView>(`/invoicing/invoices/${id}/void`, token, { method: 'POST' }),
  recordPayment: (token: string, id: string, data: { amount: number; method?: string }) =>
    authedRequest(`/invoicing/invoices/${id}/payments`, token, { method: 'POST', body: JSON.stringify(data) }),
  resetPayments: (token: string, id: string) => authedRequest(`/invoicing/invoices/${id}/payments/reset`, token, { method: 'POST' }),
  deletePartner: (token: string, id: string) => authedRequest<void>(`/invoicing/partners/${id}`, token, { method: 'DELETE' }),
  deleteInvoice: (token: string, id: string) => authedRequest<void>(`/invoicing/invoices/${id}`, token, { method: 'DELETE' }),
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
  discountPercent: number | null;
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
  number: string | null;
  supplierId: string | null;
  supplier?: { id: string; name: string; code: string | null } | null;
  purchaseOrder?: { id: string; number: string | null } | null;
  cancelledAt: string | null;
  total: number;
  paid: number;
  payments?: PartnerPaymentView[];
  account?: DocumentAccount | null;
}

/** Ancien solde → montant du bon → versement → nouveau solde, on the bon's side of the account. */
export interface DocumentAccount {
  previousBalance: number;
  documentAmount: number;
  paidWithDocument: number;
  newBalance: number;
}

export interface PartnerPaymentView {
  id: string;
  partnerId: string;
  direction: 'in' | 'out';
  amount: number;
  method: string | null;
  paidAt: string;
  notes: string | null;
  documentType: string | null;
  documentId: string | null;
}

export type TradeDocumentType = 'delivery_note' | 'customer_return' | 'supplier_return';

export interface TradeDocumentView {
  id: string;
  type: TradeDocumentType;
  number: string;
  status: 'validated' | 'cancelled';
  issuedAt: string;
  notes: string | null;
  partner: { id: string; name: string; code: string | null } | null;
  site: { id: string; name: string };
  salesOrder: { id: string; number: string | null } | null;
  invoice: { id: string; number: string | null; status: string } | null;
  lines: {
    id: string;
    productId: string | null;
    sku: string | null;
    unitsPerCarton: number | null;
    description: string;
    quantity: number;
    unitPrice: number;
    discountPercent: number | null;
    taxRate: number | null;
    taxRateId: string | null;
    total: number;
  }[];
  totals: { totalHt: number; totalTax: number; totalTtc: number };
  paid: number;
  payments?: PartnerPaymentView[];
  /** Payments recorded on the facture generated from this bon. */
  invoicePayments?: { id: string; amount: number; method: string | null; paidAt: string }[];
  account?: DocumentAccount | null;
}

export interface TradeDocumentInput {
  type: TradeDocumentType;
  siteId: string;
  partnerId?: string;
  salesOrderId?: string;
  notes?: string;
  payment?: { amount: number; method?: string };
  lines: {
    productId?: string;
    description?: string;
    quantity: number;
    unitPrice?: number;
    discountPercent?: number;
    taxRateId?: string;
    salesOrderLineId?: string;
  }[];
}

export interface StatementEntry {
  side: 'customer' | 'supplier';
  date: string;
  kind: string;
  ref: string | null;
  label: string;
  documentId: string | null;
  amount: number;
  balanceAfter: number;
}

const TRADE_ROUTE: Record<TradeDocumentType, string> = {
  delivery_note: 'delivery-notes',
  customer_return: 'customer-returns',
  supplier_return: 'supplier-returns',
};
const tradeSide = (type: TradeDocumentType) => (type === 'supplier_return' ? 'purchases' : 'sales');

export const tradeApi = {
  create: (token: string, data: TradeDocumentInput) =>
    authedRequest<TradeDocumentView>(`/trade/documents/${TRADE_ROUTE[data.type]}`, token, { method: 'POST', body: JSON.stringify(data) }),
  listSales: (token: string, filters: { type?: 'delivery_note' | 'customer_return'; partnerId?: string; salesOrderId?: string } = {}) => {
    const q = new URLSearchParams(Object.entries(filters).filter(([, v]) => v) as [string, string][]).toString();
    return authedRequest<TradeDocumentView[]>(`/trade/documents/sales${q ? `?${q}` : ''}`, token);
  },
  listSupplierReturns: (token: string) => authedRequest<TradeDocumentView[]>('/trade/documents/purchases', token),
  get: (token: string, type: TradeDocumentType, id: string) => authedRequest<TradeDocumentView>(`/trade/documents/${tradeSide(type)}/${id}`, token),
  cancel: (token: string, type: TradeDocumentType, id: string) =>
    authedRequest<TradeDocumentView>(`/trade/documents/${tradeSide(type)}/${id}/cancel`, token, { method: 'POST' }),
  invoice: (token: string, documentIds: string[]) =>
    authedRequest<InvoiceView>('/trade/documents/invoice', token, { method: 'POST', body: JSON.stringify({ documentIds }) }),
  createPayment: (
    token: string,
    data: { partnerId: string; direction: 'in' | 'out'; amount: number; method?: string; notes?: string; documentType?: string; documentId?: string },
  ) => authedRequest<PartnerPaymentView>('/trade/payments', token, { method: 'POST', body: JSON.stringify(data) }),
  cancelPayment: (token: string, id: string) => authedRequest<void>(`/trade/payments/${id}`, token, { method: 'DELETE' }),
  fetchPdf: async (token: string, type: TradeDocumentType, id: string): Promise<Blob> => {
    const res = await fetch(`${API_BASE}/trade/documents/${tradeSide(type)}/${id}/pdf`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => undefined));
    return res.blob();
  },
  /** État des créances (client) / état des dettes (fournisseur). */
  fetchUnpaidPdf: async (token: string, partnerId: string, side: 'customer' | 'supplier'): Promise<Blob> => {
    const res = await fetch(`${API_BASE}/trade/partners/${partnerId}/unpaid/pdf?side=${side}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => undefined));
    return res.blob();
  },
  statement: (token: string, partnerId: string) =>
    authedRequest<{ entries: StatementEntry[]; customerBalance: number; supplierBalance: number; balance: number }>(`/trade/partners/${partnerId}/statement`, token),
};

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
  deleteOrder: (token: string, id: string) => authedRequest<void>(`/purchasing/orders/${id}`, token, { method: 'DELETE' }),
  deleteOrderLine: (token: string, orderId: string, lineId: string) =>
    authedRequest<PurchaseOrderView>(`/purchasing/orders/${orderId}/lines/${lineId}`, token, { method: 'DELETE' }),
  listReceipts: (token: string, purchaseOrderId?: string) =>
    authedRequest<PurchaseReceiptView[]>(`/purchasing/receipts${purchaseOrderId ? `?purchaseOrderId=${encodeURIComponent(purchaseOrderId)}` : ''}`, token),
  receiveGoods: (
    token: string,
    data: {
      purchaseOrderId?: string;
      supplierId?: string;
      payment?: { amount: number; method?: string };
      siteId: string;
      notes?: string;
      landedCostAmount?: number;
      landedCostNotes?: string;
      lines: {
        purchaseOrderLineId?: string;
        productId: string;
        quantity: number;
        unitCost: number;
        discountPercent?: number;
        newLot?: { lotNumber: string; expiryDate?: string };
        existingBatchId?: string;
        qualityResult?: 'conforme' | 'non_conforme';
        qualityNotes?: string;
      }[];
    },
  ) => authedRequest<PurchaseReceiptView>('/purchasing/receipts', token, { method: 'POST', body: JSON.stringify(data) }),
  getReceipt: (token: string, id: string) => authedRequest<PurchaseReceiptView>(`/purchasing/receipts/${id}`, token),
  cancelReceipt: (token: string, id: string) => authedRequest<PurchaseReceiptView>(`/purchasing/receipts/${id}/cancel`, token, { method: 'POST' }),
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
  /** Already left through bons de livraison. */
  quantityDelivered: number;
  /** Already on a not-yet-finalized draft facture — no longer available to invoice. */
  quantityInDraft: number;
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
  tradeDocuments?: { id: string; number: string; issuedAt: string; invoiceId: string | null }[];
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
  deleteOrder: (token: string, id: string) => authedRequest<void>(`/sales/orders/${id}`, token, { method: 'DELETE' }),
  deleteOrderLine: (token: string, orderId: string, lineId: string) =>
    authedRequest<SalesOrderView>(`/sales/orders/${orderId}/lines/${lineId}`, token, { method: 'DELETE' }),
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

// ───────────────────────── Inventaires ─────────────────────────

export type ReminderFrequency = 'off' | 'weekly' | 'monthly' | 'quarterly' | 'semiannual' | 'yearly';

export interface InventoryReminderStatus {
  frequency: ReminderFrequency;
  frequencyLabel: string;
  lastInventoryAt: string | null;
  dueAt: string | null;
  isDue: boolean;
  daysOverdue: number;
  inProgress: number;
}

export interface InventoryCountSummary {
  id: string;
  number: string;
  status: 'draft' | 'validated' | 'cancelled';
  scope: 'all' | 'category' | 'selection';
  site: { id: string; name: string };
  createdAt: string;
  validatedAt: string | null;
  lineCount: number;
  countedCount: number;
  discrepancyCount: number;
  valueDifference: number | null;
}

export interface InventoryCountLineView {
  productId: string;
  sku: string;
  name: string;
  barcode: string | null;
  category: string | null;
  unitsPerCarton: number | null;
  systemQty: number;
  countedQty: number | null;
  difference: number | null;
  unitCost: number;
  valueDifference: number | null;
}

export interface InventoryCountView {
  id: string;
  number: string;
  status: 'draft' | 'validated' | 'cancelled';
  scope: string;
  notes: string | null;
  site: { id: string; name: string };
  createdAt: string;
  validatedAt: string | null;
  lines: InventoryCountLineView[];
  summary: { lineCount: number; countedCount: number; discrepancyCount: number; valueDifference: number };
}

export const inventoryApi = {
  reminder: (token: string) => authedRequest<InventoryReminderStatus>('/inventory/reminder', token),
  updateSettings: (token: string, inventoryReminder: ReminderFrequency) =>
    authedRequest<InventoryReminderStatus>('/inventory/settings', token, { method: 'PUT', body: JSON.stringify({ inventoryReminder }) }),
  list: (token: string) => authedRequest<InventoryCountSummary[]>('/inventory/counts', token),
  create: (token: string, data: { siteId: string; scope: 'all' | 'category' | 'selection'; categoryId?: string; productIds?: string[]; notes?: string }) =>
    authedRequest<InventoryCountView>('/inventory/counts', token, { method: 'POST', body: JSON.stringify(data) }),
  get: (token: string, id: string) => authedRequest<InventoryCountView>(`/inventory/counts/${id}`, token),
  saveLines: (token: string, id: string, lines: { productId: string; countedQty: number | null }[]) =>
    authedRequest<InventoryCountView>(`/inventory/counts/${id}/lines`, token, { method: 'PUT', body: JSON.stringify({ lines }) }),
  validate: (token: string, id: string, zeroUncounted: boolean) =>
    authedRequest<InventoryCountView>(`/inventory/counts/${id}/validate`, token, { method: 'POST', body: JSON.stringify({ zeroUncounted }) }),
  cancel: (token: string, id: string) => authedRequest<InventoryCountView>(`/inventory/counts/${id}/cancel`, token, { method: 'POST' }),
  fetchPdf: async (token: string, id: string): Promise<Blob> => {
    const res = await fetch(`${API_BASE}/inventory/counts/${id}/pdf`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => undefined));
    return res.blob();
  },
};

// ───────────────────────── Comptoirs (caisses) ─────────────────────────

export interface CounterSessionView {
  id: string;
  number: string;
  status: 'open' | 'closed';
  counter: { id: string; name: string; site: { id: string; name: string } };
  openedAt: string;
  closedAt: string | null;
  openingCash: number;
  salesCount: number;
  salesTotal: number;
  byMethod: { method: string; label: string; count: number; total: number }[];
  cashSales: number;
  cashIn: number;
  cashOut: number;
  expectedCash: number;
  countedCash: number | null;
  difference: number | null;
  notes: string | null;
  movements: { id: string; direction: 'in' | 'out'; amount: number; reason: string; createdAt: string }[];
}

export interface CounterView {
  id: string;
  name: string;
  isActive: boolean;
  site: { id: string; name: string };
  openSession: CounterSessionView | null;
}

export interface CounterSaleResult {
  document: { id: string; number: string; total: number };
  paymentMethod: string | null;
  amountReceived: number | null;
  change: number;
}

const pdfBlob = async (token: string, path: string): Promise<Blob> => {
  const res = await fetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => undefined));
  return res.blob();
};

export const countersApi = {
  list: (token: string) => authedRequest<CounterView[]>('/counters', token),
  create: (token: string, data: { name: string; siteId: string }) => authedRequest<CounterView>('/counters', token, { method: 'POST', body: JSON.stringify(data) }),
  update: (token: string, id: string, data: { name?: string; isActive?: boolean }) =>
    authedRequest<CounterView>(`/counters/${id}`, token, { method: 'PATCH', body: JSON.stringify(data) }),
  open: (token: string, id: string, openingCash: number) =>
    authedRequest<CounterSessionView>(`/counters/${id}/open`, token, { method: 'POST', body: JSON.stringify({ openingCash }) }),
  sessions: (token: string, counterId?: string) => authedRequest<CounterSessionView[]>(`/counters/sessions/list${counterId ? `?counterId=${counterId}` : ''}`, token),
  session: (token: string, id: string) => authedRequest<CounterSessionView>(`/counters/sessions/${id}`, token),
  movement: (token: string, id: string, data: { direction: 'in' | 'out'; amount: number; reason: string }) =>
    authedRequest<CounterSessionView>(`/counters/sessions/${id}/movements`, token, { method: 'POST', body: JSON.stringify(data) }),
  close: (token: string, id: string, countedCash: number, notes?: string) =>
    authedRequest<CounterSessionView>(`/counters/sessions/${id}/close`, token, { method: 'POST', body: JSON.stringify({ countedCash, notes }) }),
  sale: (
    token: string,
    sessionId: string,
    data: { lines: { productId: string; quantity: number; unitPrice?: number; taxRateId?: string }[]; partnerId?: string; paid: boolean; paymentMethod?: 'especes' | 'carte' | 'cheque'; amountReceived?: number },
  ) => authedRequest<CounterSaleResult>(`/counters/sessions/${sessionId}/sales`, token, { method: 'POST', body: JSON.stringify(data) }),
  zPdf: (token: string, sessionId: string) => pdfBlob(token, `/counters/sessions/${sessionId}/z`),
  ticketPdf: (token: string, documentId: string) => pdfBlob(token, `/counters/tickets/${documentId}`),
};

// ───────────────────────── Statistiques ─────────────────────────

export type StatsGranularity = 'day' | 'week' | 'month' | 'year';
export interface StatsOverview {
  period: { from: string; to: string; granularity: StatsGranularity; previousFrom: string; previousTo: string };
  previous: { salesTtc: number; margin: number; purchases: number; count: number; averageBasket: number; collected: number };
  payments: { collected: number; credit: number; byMethod: { method: string; label: string; amount: number }[] };
  sales: {
    totalHt: number;
    totalTtc: number;
    count: number;
    averageBasket: number;
    estimatedMargin: number;
    marginRate: number;
    credit: { count: number; amount: number };
    topProducts: { id: string; name: string; quantity: number; revenue: number }[];
    topCustomers: { id: string; name: string; count: number; revenue: number }[];
  };
  purchases: { total: number; count: number; topSuppliers: { id: string; name: string; count: number; amount: number }[] };
  series: { key: string; sales: number; purchases: number; margin: number; count: number }[];
  balances: {
    customers: { total: number; count: number; top: { id: string; name: string; code: string | null; balance: number }[] };
    suppliers: { total: number; count: number; top: { id: string; name: string; code: string | null; balance: number }[] };
  };
  stock: {
    value: number;
    lowStock: { productId: string; name: string; site: string; quantity: number }[];
    outOfStock: { productId: string; sku: string; name: string; site: string; quantity: number }[];
    outOfStockCount: number;
    lowStockCount: number;
    expired: { lotNumber: string; sku: string; name: string; expiryDate: string; status: string }[];
    expiringSoon: { lotNumber: string; sku: string; name: string; expiryDate: string; status: string }[];
  };
}

export const statsApi = {
  overview: (token: string, params: { from: string; to: string; granularity: StatsGranularity; siteId?: string; compareFrom?: string; compareTo?: string }) =>
    authedRequest<StatsOverview>(`/stats?${new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString()}`, token),
};

// ───────── Caisse ─────────

export type CashMethod = 'especes' | 'carte' | 'cheque' | 'virement' | 'autre' | 'inconnu';
export type CashSource = 'manual' | 'payment' | 'invoice_payment' | 'counter_sale' | 'counter_movement';

export interface CashEntryView {
  id: string;
  source: CashSource;
  date: string;
  direction: 'in' | 'out';
  amount: number;
  method: CashMethod;
  methodLabel: string;
  label: string;
  description: string | null;
  partner: { id: string; name: string } | null;
  product: { id: string; name: string } | null;
  document: { type: string; id: string; number: string } | null;
  site: { id: string; name: string } | null;
  cancellable: boolean;
}

export interface CashJournal {
  period: { from: string; to: string };
  openingBalance: number;
  totalIn: number;
  totalOut: number;
  net: number;
  closingBalance: number;
  byMethod: { method: CashMethod; label: string; in: number; out: number; balance: number }[];
  entries: CashEntryView[];
}

export interface CashOpenDocument {
  type: 'delivery_note' | 'purchase_receipt';
  id: string;
  number: string;
  date: string;
  total: number;
  paid: number;
  remaining: number;
}

export const cashApi = {
  journal: (token: string, params: { from: string; to: string; siteId?: string }) =>
    authedRequest<CashJournal>(`/cash?${new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString()}`, token),
  openDocuments: (token: string, partnerId: string, direction: 'in' | 'out') =>
    authedRequest<CashOpenDocument[]>(`/cash/open-documents?partnerId=${encodeURIComponent(partnerId)}&direction=${direction}`, token),
  create: (
    token: string,
    data: {
      direction: 'in' | 'out';
      amount: number;
      method: CashMethod;
      occurredAt?: string;
      description?: string;
      siteId?: string;
      partnerId?: string;
      productId?: string;
      documentId?: string;
      documentType?: 'delivery_note' | 'purchase_receipt';
      applyToBalance?: boolean;
    },
  ) => authedRequest<{ source: 'manual' | 'payment'; id: string }>('/cash/entries', token, { method: 'POST', body: JSON.stringify(data) }),
  cancel: (token: string, source: 'manual' | 'payment', id: string) => authedRequest<void>(`/cash/entries/${source}/${id}`, token, { method: 'DELETE' }),
};
