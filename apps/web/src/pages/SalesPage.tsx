import { FormEvent, useCallback, useEffect, useState } from 'react';
import { AppShell } from '../lib/AppShell';
import { useAuth } from '../lib/auth-context';
import { SearchableSelect } from '../lib/SearchableSelect';
import {
  ApiError,
  Partner,
  PartnerProductPriceView,
  SalesOrderView,
  Site,
  StockRow,
  TaxRate,
  invoicingApi,
  salesApi,
  sitesApi,
  stockApi,
} from '../lib/api';
import '../lib/data-views.css';

const STATUS_LABEL: Record<string, string> = {
  draft: 'Brouillon',
  sent: 'Envoyé',
  accepted: 'Accepté',
  expired: 'Expiré',
  confirmed: 'Confirmée',
  partially_invoiced: 'Partiellement facturée',
  invoiced: 'Facturée',
  cancelled: 'Annulé',
};

function statusPillClass(status: string): string {
  if (status === 'invoiced' || status === 'accepted') return 'success';
  if (status === 'partially_invoiced' || status === 'sent') return 'warning';
  if (status === 'cancelled' || status === 'expired') return 'danger';
  return 'info';
}

export function SalesPage() {
  const { accessToken } = useAuth();
  const [orders, setOrders] = useState<SalesOrderView[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [products, setProducts] = useState<StockRow[]>([]);
  const [taxRates, setTaxRates] = useState<TaxRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<'all' | 'quote' | 'order'>('all');
  const [showFormKind, setShowFormKind] = useState<'quote' | 'order' | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<SalesOrderView | null>(null);
  const [showPricing, setShowPricing] = useState(false);
  const [dashboard, setDashboard] = useState<{
    openQuotesCount: number;
    openOrdersCount: number;
    openOrdersValue: number;
    overdueCount: number;
  } | null>(null);

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const [orderList, siteList, partnerList, productRows, taxRows, dash] = await Promise.all([
        salesApi.listOrders(accessToken),
        sitesApi.list(accessToken),
        invoicingApi.listPartners(accessToken),
        stockApi.listProducts(accessToken, 'all'),
        invoicingApi.listTaxRates(accessToken),
        salesApi.getDashboard(accessToken),
      ]);
      setOrders(orderList);
      setSites(siteList);
      setPartners(partnerList);
      setProducts(productRows);
      setTaxRates(taxRows);
      setDashboard(dash);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur de chargement.');
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    load();
  }, [load]);

  const customers = partners.filter((p) => p.isCustomer);
  const uniqueProducts = Array.from(new Map(products.map((p) => [p.productId, p])).values());
  const visibleOrders = kindFilter === 'all' ? orders : orders.filter((o) => o.kind === kindFilter);

  return (
    <AppShell>
      <div className="panel-head">
        <div>
          <h2>Ventes</h2>
          <div className="sub">{orders.length} devis/commande(s)</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn-secondary" onClick={() => setShowPricing(true)}>
            Tarifs négociés
          </button>
          <button className="btn-secondary" onClick={() => setShowFormKind('quote')} disabled={sites.length === 0 || customers.length === 0}>
            + Devis
          </button>
          <button className="btn-primary" onClick={() => setShowFormKind('order')} disabled={sites.length === 0 || customers.length === 0}>
            + Commande
          </button>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {!loading && sites.length === 0 && <p className="sub">Créez d&apos;abord un site (module Multi-Sites) pour passer une commande.</p>}
      {!loading && sites.length > 0 && customers.length === 0 && (
        <p className="sub">Aucun client enregistré — ajoutez-en un depuis Fournisseurs &amp; clients.</p>
      )}

      {dashboard && (
        <div className="stat-strip">
          <div className="stat-card">
            <div className="num">{dashboard.openQuotesCount}</div>
            <div className="label">Devis ouverts</div>
          </div>
          <div className="stat-card">
            <div className="num">{dashboard.openOrdersCount}</div>
            <div className="label">Commandes en cours</div>
          </div>
          <div className="stat-card">
            <div className="num">{dashboard.openOrdersValue.toFixed(2)} DZD</div>
            <div className="label">Valeur en cours</div>
          </div>
          <div className="stat-card warn">
            <div className="num">{dashboard.overdueCount}</div>
            <div className="label">En retard</div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {(['all', 'quote', 'order'] as const).map((k) => (
          <button key={k} className={`toggle-btn ${kindFilter === k ? 'on' : ''}`} onClick={() => setKindFilter(k)} type="button">
            {k === 'all' ? 'Tous' : k === 'quote' ? 'Devis' : 'Commandes'}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="sub">Chargement…</p>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>N°</th>
              <th>Type</th>
              <th>Client</th>
              <th>Site</th>
              <th>Statut</th>
              <th>Total</th>
              <th>Créé le</th>
            </tr>
          </thead>
          <tbody>
            {visibleOrders.map((o) => {
              const total = o.lines.reduce((s, l) => s + l.unitPrice * l.quantityOrdered * (1 - (l.discountPercent ?? 0) / 100), 0);
              return (
                <tr key={o.id} onClick={() => setSelectedOrder(o)} style={{ cursor: 'pointer' }}>
                  <td className="mono">{o.number ?? '—'}</td>
                  <td>{o.kind === 'quote' ? 'Devis' : 'Commande'}</td>
                  <td>{o.customer.name}</td>
                  <td>{o.site.name}</td>
                  <td>
                    <span className={`pill ${statusPillClass(o.status)}`}>{STATUS_LABEL[o.status] ?? o.status}</span>
                  </td>
                  <td>{total.toFixed(2)} DZD</td>
                  <td>{new Date(o.createdAt).toLocaleDateString('fr-FR')}</td>
                </tr>
              );
            })}
            {visibleOrders.length === 0 && (
              <tr>
                <td colSpan={7} className="sub">
                  Aucun document pour le moment.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {showFormKind && (
        <OrderFormModal
          kind={showFormKind}
          sites={sites}
          customers={customers}
          products={uniqueProducts}
          taxRates={taxRates}
          onClose={() => setShowFormKind(null)}
          onSaved={() => {
            setShowFormKind(null);
            load();
          }}
        />
      )}
      {selectedOrder && (
        <OrderDetailModal
          order={selectedOrder}
          onClose={() => setSelectedOrder(null)}
          onChanged={() => {
            setSelectedOrder(null);
            load();
          }}
        />
      )}
      {showPricing && (
        <PricingModal customers={customers} products={uniqueProducts} onClose={() => setShowPricing(false)} />
      )}
    </AppShell>
  );
}

interface DraftLine {
  productId: string;
  productLabel: string;
  description: string;
  isService: boolean;
  quantity: number;
  unitPrice: string; // empty string = let backend resolve the price
  discountPercent: string;
  taxRateId: string;
}

function blankLine(defaultTaxRateId: string): DraftLine {
  return { productId: '', productLabel: '', description: '', isService: false, quantity: 1, unitPrice: '', discountPercent: '', taxRateId: defaultTaxRateId };
}

function OrderFormModal({
  kind,
  sites,
  customers,
  products,
  taxRates,
  onClose,
  onSaved,
}: {
  kind: 'quote' | 'order';
  sites: Site[];
  customers: Partner[];
  products: StockRow[];
  taxRates: TaxRate[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { accessToken } = useAuth();
  const defaultTaxRateId = taxRates.find((t) => t.isDefault)?.id ?? '';
  const [siteId, setSiteId] = useState(sites[0]?.id ?? '');
  const [customerId, setCustomerId] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([blankLine(defaultTaxRateId)]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shortageMessage, setShortageMessage] = useState<string | null>(null);

  function updateLine(i: number, patch: Partial<DraftLine>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  function buildPayload(acknowledgeShortage: boolean) {
    return {
      kind,
      siteId,
      customerId,
      expectedDate: expectedDate || undefined,
      acknowledgeShortage,
      lines: lines
        .filter((l) => (l.isService ? l.description : l.productId) && l.quantity > 0)
        .map((l) => ({
          productId: l.isService ? undefined : l.productId,
          description: l.isService ? l.description : undefined,
          quantity: l.quantity,
          unitPrice: l.unitPrice ? Number(l.unitPrice) : undefined,
          discountPercent: l.discountPercent ? Number(l.discountPercent) : undefined,
          taxRateId: l.taxRateId || undefined,
        })),
    };
  }

  async function submit(acknowledgeShortage: boolean) {
    if (!accessToken || !customerId) return;
    setSubmitting(true);
    setError(null);
    try {
      await salesApi.createOrder(accessToken, buildPayload(acknowledgeShortage));
      onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setShortageMessage(err.message);
      } else {
        setError(err instanceof ApiError ? err.message : 'Erreur lors de la création.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setShortageMessage(null);
    await submit(false);
  }

  return (
    <div className="modal-backdrop open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <div className="modal-header-titles">
            <h3>{kind === 'quote' ? 'Nouveau devis' : 'Nouvelle commande'}</h3>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>
        <form onSubmit={handleSubmit} className="field-form">
          <div className="field-row">
            <label>Client</label>
            <SearchableSelect
              value={customerId}
              onChange={setCustomerId}
              options={customers.map((c) => ({ value: c.id, label: c.name, sublabel: c.nif }))}
              placeholder="Rechercher un client…"
            />
          </div>
          <div className="field-row">
            <label>Site</label>
            <select value={siteId} onChange={(e) => setSiteId(e.target.value)} required>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field-row">
            <label>Date prévue (optionnel)</label>
            <input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
          </div>

          <div className="sub" style={{ marginTop: 4 }}>
            Lignes
          </div>
          {lines.map((l, i) => (
            <div key={i} className="lot-mini-table" style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                {l.isService ? (
                  <input
                    value={l.description}
                    onChange={(e) => updateLine(i, { description: e.target.value })}
                    placeholder="Description du service"
                    style={{ flex: '1 1 200px' }}
                    required
                  />
                ) : (
                  <div style={{ flex: '1 1 200px' }}>
                    <SearchableSelect
                      value={l.productId}
                      onChange={(v) => {
                        const p = products.find((pr) => pr.productId === v);
                        updateLine(i, { productId: v, productLabel: p ? `${p.sku} — ${p.name}` : v });
                      }}
                      options={products.map((p) => ({ value: p.productId, label: p.name, sublabel: p.sku }))}
                      placeholder="Produit…"
                    />
                  </div>
                )}
                <button type="button" className="btn-link" onClick={() => updateLine(i, { isService: !l.isService, productId: '', description: '' })}>
                  {l.isService ? 'Utiliser un produit' : 'Ligne de service'}
                </button>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <input
                  type="number"
                  min={0.001}
                  step="any"
                  value={l.quantity}
                  onChange={(e) => updateLine(i, { quantity: Number(e.target.value) })}
                  placeholder="Qté"
                  style={{ width: 90 }}
                  required
                />
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={l.unitPrice}
                  onChange={(e) => updateLine(i, { unitPrice: e.target.value })}
                  placeholder={l.isService ? 'Prix unitaire (requis)' : 'Prix (auto si vide)'}
                  style={{ width: 160 }}
                  required={l.isService}
                />
                <input
                  type="number"
                  min={0}
                  max={100}
                  step="any"
                  value={l.discountPercent}
                  onChange={(e) => updateLine(i, { discountPercent: e.target.value })}
                  placeholder="Remise %"
                  style={{ width: 100 }}
                />
                <select value={l.taxRateId} onChange={(e) => updateLine(i, { taxRateId: e.target.value })}>
                  <option value="">Sans TVA</option>
                  {taxRates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.rate}%)
                    </option>
                  ))}
                </select>
                {lines.length > 1 && (
                  <button type="button" className="btn-link" onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}>
                    Retirer
                  </button>
                )}
              </div>
            </div>
          ))}
          <button type="button" className="btn-link" onClick={() => setLines((ls) => [...ls, blankLine(defaultTaxRateId)])}>
            + Ajouter une ligne
          </button>

          {kind === 'order' && (
            <p className="sub" style={{ marginTop: 4 }}>
              Une commande réserve immédiatement le stock disponible pour chaque ligne produit.
            </p>
          )}

          {shortageMessage && (
            <div className="error-banner">
              <strong>Rupture de stock détectée :</strong> {shortageMessage}
              <div style={{ marginTop: 8 }}>
                <button type="button" className="btn-primary" disabled={submitting} onClick={() => submit(true)}>
                  {submitting ? 'Confirmation…' : 'Confirmer malgré la rupture (backorder)'}
                </button>
              </div>
            </div>
          )}
          {error && <div className="error-banner">{error}</div>}
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Annuler
            </button>
            <button type="submit" className="btn-primary" disabled={submitting || !customerId}>
              {submitting ? 'Création…' : kind === 'quote' ? 'Créer le devis' : 'Créer la commande'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function OrderDetailModal({ order, onClose, onChanged }: { order: SalesOrderView; onClose: () => void; onChanged: () => void }) {
  const { accessToken } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shortageMessage, setShortageMessage] = useState<string | null>(null);
  const [showInvoice, setShowInvoice] = useState(false);

  const canPromote = order.kind === 'quote' && order.status !== 'cancelled';
  const canCancel = order.status !== 'cancelled' && order.status !== 'invoiced' && !order.lines.some((l) => l.quantityInvoiced > 0);
  const remainingToInvoice = order.lines.reduce((s, l) => s + (l.quantityOrdered - l.quantityInvoiced), 0);
  const canInvoice = order.kind === 'order' && order.status !== 'cancelled' && remainingToInvoice > 0;

  async function handlePromote(acknowledgeShortage = false) {
    if (!accessToken) return;
    setBusy(true);
    setError(null);
    setShortageMessage(null);
    try {
      await salesApi.promoteOrder(accessToken, order.id, acknowledgeShortage);
      onChanged();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setShortageMessage(err.message);
      } else {
        setError(err instanceof ApiError ? err.message : 'Erreur lors de la promotion.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel() {
    if (!accessToken) return;
    setBusy(true);
    setError(null);
    try {
      await salesApi.cancelOrder(accessToken, order.id);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Erreur lors de l'annulation.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <div className="modal-header-titles">
            <h3>{order.number ?? (order.kind === 'quote' ? 'Devis' : 'Commande')}</h3>
            <p className="modal-sub">
              {order.customer.name} · {order.site.name} · <span className={`pill ${statusPillClass(order.status)}`}>{STATUS_LABEL[order.status] ?? order.status}</span>
            </p>
            {order.promotedFromQuoteNumber && <p className="modal-sub">Promue depuis le devis {order.promotedFromQuoteNumber}</p>}
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>
        <table className="data">
          <thead>
            <tr>
              <th>Produit / Description</th>
              <th>Commandé</th>
              <th>Facturé</th>
              <th>Prix unitaire</th>
              <th>Remise</th>
            </tr>
          </thead>
          <tbody>
            {order.lines.map((l) => (
              <tr key={l.id}>
                <td>{l.product ? `${l.product.sku} — ${l.product.name}` : l.description}</td>
                <td>{l.quantityOrdered}</td>
                <td>{l.quantityInvoiced}</td>
                <td>{l.unitPrice.toFixed(2)} DZD</td>
                <td>{l.discountPercent != null ? `${l.discountPercent}%` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {order.invoices && order.invoices.length > 0 && (
          <div className="sub" style={{ marginTop: 8 }}>
            Factures liées : {order.invoices.map((inv) => inv.number ?? `#${inv.id.slice(0, 8)} (${inv.status})`).join(', ')}
          </div>
        )}
        {shortageMessage && (
          <div className="error-banner">
            <strong>Rupture de stock détectée :</strong> {shortageMessage}
            <div style={{ marginTop: 8 }}>
              <button type="button" className="btn-primary" disabled={busy} onClick={() => handlePromote(true)}>
                {busy ? 'Confirmation…' : 'Confirmer malgré la rupture (backorder)'}
              </button>
            </div>
          </div>
        )}
        {error && <div className="error-banner">{error}</div>}
        <div className="modal-footer">
          {canCancel && (
            <button type="button" className="btn-secondary" onClick={handleCancel} disabled={busy}>
              {busy ? 'Annulation…' : 'Annuler'}
            </button>
          )}
          <button type="button" className="btn-secondary" onClick={onClose}>
            Fermer
          </button>
          {canPromote && (
            <button type="button" className="btn-primary" onClick={() => handlePromote(false)} disabled={busy}>
              {busy ? 'Promotion…' : 'Promouvoir en commande'}
            </button>
          )}
          {canInvoice && (
            <button type="button" className="btn-primary" onClick={() => setShowInvoice(true)}>
              Facturer
            </button>
          )}
        </div>
      </div>
      {showInvoice && (
        <InvoiceOrderModal
          order={order}
          onClose={() => setShowInvoice(false)}
          onInvoiced={() => {
            setShowInvoice(false);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

function InvoiceOrderModal({ order, onClose, onInvoiced }: { order: SalesOrderView; onClose: () => void; onInvoiced: () => void }) {
  const { accessToken } = useAuth();
  const invoiceableLines = order.lines.filter((l) => l.quantityOrdered - l.quantityInvoiced > 0);
  const [quantities, setQuantities] = useState<Record<string, number>>(
    Object.fromEntries(invoiceableLines.map((l) => [l.id, l.quantityOrdered - l.quantityInvoiced])),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!accessToken) return;
    setSubmitting(true);
    setError(null);
    try {
      await salesApi.invoiceOrder(accessToken, order.id, {
        lines: invoiceableLines.filter((l) => quantities[l.id] > 0).map((l) => ({ salesOrderLineId: l.id, quantity: quantities[l.id] })),
      });
      onInvoiced();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur lors de la facturation.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <div className="modal-header-titles">
            <h3>Facturer {order.number}</h3>
            <p className="modal-sub">Génère une facture client brouillon — à finaliser depuis le module Factures.</p>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>
        <form onSubmit={handleSubmit} className="field-form">
          {invoiceableLines.map((l) => {
            const remaining = l.quantityOrdered - l.quantityInvoiced;
            return (
              <div key={l.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 220px' }}>{l.product ? `${l.product.sku} — ${l.product.name}` : l.description}</div>
                <input
                  type="number"
                  min={0}
                  max={remaining}
                  step="any"
                  value={quantities[l.id]}
                  onChange={(e) => setQuantities((q) => ({ ...q, [l.id]: Number(e.target.value) }))}
                  style={{ width: 100 }}
                />
                <span className="sub">/ {remaining} restant</span>
              </div>
            );
          })}
          {error && <div className="error-banner">{error}</div>}
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Annuler
            </button>
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? 'Facturation…' : 'Générer la facture'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function PricingModal({ customers, products, onClose }: { customers: Partner[]; products: StockRow[]; onClose: () => void }) {
  const { accessToken } = useAuth();
  const [partnerId, setPartnerId] = useState('');
  const [prices, setPrices] = useState<PartnerProductPriceView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [productId, setProductId] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  const [discountPercent, setDiscountPercent] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!accessToken) return;
    try {
      setPrices(await salesApi.listPricing(accessToken, partnerId || undefined));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur de chargement.');
    }
  }, [accessToken, partnerId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    if (!accessToken || !partnerId || !productId) return;
    setSubmitting(true);
    setError(null);
    try {
      await salesApi.upsertPricing(accessToken, {
        partnerId,
        productId,
        unitPrice: unitPrice ? Number(unitPrice) : undefined,
        discountPercent: discountPercent ? Number(discountPercent) : undefined,
      });
      setProductId('');
      setUnitPrice('');
      setDiscountPercent('');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Erreur lors de l'enregistrement.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    if (!accessToken) return;
    try {
      await salesApi.deletePricing(accessToken, id);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur lors de la suppression.');
    }
  }

  return (
    <div className="modal-backdrop open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide">
        <div className="modal-header">
          <div className="modal-header-titles">
            <h3>Tarifs négociés par client</h3>
            <p className="modal-sub">Prix ou remise fixe appliqué automatiquement sur une ligne de commande pour ce client/produit.</p>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>
        <div className="modal-section">
          <div className="field-row">
            <label>Filtrer par client</label>
            <SearchableSelect
              value={partnerId}
              onChange={setPartnerId}
              options={customers.map((c) => ({ value: c.id, label: c.name, sublabel: c.nif }))}
              placeholder="Tous les clients…"
            />
          </div>

          {error && <div className="error-banner">{error}</div>}
          <table className="data">
            <thead>
              <tr>
                <th>Client</th>
                <th>Produit</th>
                <th>Prix négocié</th>
                <th>Remise</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(prices ?? []).map((p) => (
                <tr key={p.id}>
                  <td>{p.partner?.name ?? p.partnerId}</td>
                  <td>{p.product ? `${p.product.sku} — ${p.product.name}` : p.productId}</td>
                  <td>{p.unitPrice != null ? `${p.unitPrice.toFixed(2)} DZD` : '—'}</td>
                  <td>{p.discountPercent != null ? `${p.discountPercent}%` : '—'}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button type="button" className="btn-link" onClick={() => handleDelete(p.id)}>
                      Retirer
                    </button>
                  </td>
                </tr>
              ))}
              {prices !== null && prices.length === 0 && (
                <tr>
                  <td colSpan={5} className="sub">
                    Aucun tarif négocié.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <form onSubmit={handleAdd} className="field-form" style={{ marginTop: 16 }}>
            <div className="sub">Ajouter / mettre à jour un tarif</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ flex: '1 1 200px' }}>
                <SearchableSelect
                  value={productId}
                  onChange={setProductId}
                  options={products.map((p) => ({ value: p.productId, label: p.name, sublabel: p.sku }))}
                  placeholder="Produit…"
                />
              </div>
              <input type="number" min={0} step="any" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} placeholder="Prix négocié" style={{ width: 140 }} />
              <input type="number" min={0} max={100} step="any" value={discountPercent} onChange={(e) => setDiscountPercent(e.target.value)} placeholder="Remise %" style={{ width: 110 }} />
              <button type="submit" className="btn-primary" disabled={submitting || !partnerId || !productId}>
                {submitting ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
            {!partnerId && <p className="sub">Sélectionnez d&apos;abord un client ci-dessus.</p>}
          </form>
        </div>
      </div>
    </div>
  );
}

export default SalesPage;
