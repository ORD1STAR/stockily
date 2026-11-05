import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ActionMenu } from '../lib/ActionMenu';
import { AppShell } from '../lib/AppShell';
import { Icon } from '../lib/Icon';
import { useAuth } from '../lib/auth-context';
import { useDataChangeListener } from '../lib/data-events';
import { CartonInput } from '../lib/CartonInput';
import { SearchableSelect } from '../lib/SearchableSelect';
import { toast } from '../lib/toast';
import {
  ApiError,
  Partner,
  PartnerProductPriceView,
  SalesOrderView,
  Site,
  StockRow,
  TaxRate,
  TradeDocumentType,
  TradeDocumentView,
  invoicingApi,
  salesApi,
  sitesApi,
  stockApi,
  tradeApi,
} from '../lib/api';
import { useListControls } from '../lib/ListControls';
import { DocumentDetailModal, DocumentFormModal, DocumentTable } from '../lib/TradeDocuments';
import '../lib/data-views.css';

const STATUS_LABEL: Record<string, string> = {
  draft: 'Brouillon',
  sent: 'Envoyé',
  accepted: 'Accepté',
  expired: 'Expiré',
  confirmed: 'Confirmée',
  partially_invoiced: 'Partiellement facturée',
  partially_delivered: 'Partiellement livrée',
  delivered: 'Livrée',
  invoiced: 'Facturée',
  cancelled: 'Annulé',
};

function statusPillClass(status: string): string {
  if (status === 'invoiced' || status === 'accepted' || status === 'delivered') return 'success';
  if (status === 'partially_invoiced' || status === 'partially_delivered' || status === 'sent') return 'warning';
  if (status === 'cancelled' || status === 'expired') return 'danger';
  return 'info';
}

export function SalesPage() {
  const { accessToken, can } = useAuth();
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
  const [tab, setTab] = useState<'orders' | 'delivery_note' | 'customer_return'>('orders');
  const [docs, setDocs] = useState<TradeDocumentView[]>([]);
  const [docForm, setDocForm] = useState<TradeDocumentType | null>(null);
  const [deliverOrder, setDeliverOrder] = useState<SalesOrderView | null>(null);
  const [openDoc, setOpenDoc] = useState<{ id: string; type: TradeDocumentType } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [invoicing, setInvoicing] = useState(false);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Deep link from a facture: /sales?doc=<id> opens that bon de livraison.
  useEffect(() => {
    const docId = searchParams.get('doc');
    if (!docId) return;
    setTab('delivery_note');
    setOpenDoc({ id: docId, type: 'delivery_note' });
    setSearchParams({}, { replace: true });
  }, [searchParams]);
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
      const [orderList, siteList, partnerList, productRows, taxRows, dash, docList] = await Promise.all([
        salesApi.listOrders(accessToken),
        sitesApi.list(accessToken),
        invoicingApi.listPartners(accessToken),
        stockApi.listProducts(accessToken, 'all'),
        invoicingApi.listTaxRates(accessToken),
        salesApi.getDashboard(accessToken),
        tradeApi.listSales(accessToken),
      ]);
      setOrders(orderList);
      setDocs(docList);
      setSelected(new Set());
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

  useDataChangeListener('partners', load);
  useDataChangeListener('sites', load);

  const customers = partners.filter((p) => p.isCustomer);
  const uniqueProducts = Array.from(new Map(products.map((p) => [p.productId, p])).values());
  const orderTotal = (o: (typeof orders)[number]) => o.lines.reduce((s, l) => s + l.unitPrice * l.quantityOrdered * (1 - (l.discountPercent ?? 0) / 100), 0);
  const orderList = useListControls(kindFilter === 'all' ? orders : orders.filter((o) => o.kind === kindFilter), {
    id: 'sales-orders',
    noun: ['document', 'documents'],
    searchPlaceholder: 'N°, client, produit…',
    search: (o) => [o.number, o.customer.name, ...o.lines.map((l) => l.product?.name ?? l.description)],
    filters: [
      { key: 'customer', label: 'Client', type: 'select', value: (o) => o.customer.name },
      { key: 'status', label: 'Statut', type: 'select', value: (o) => STATUS_LABEL[o.status] ?? o.status },
      { key: 'date', label: 'Créé le', type: 'dates', value: (o) => o.createdAt },
      { key: 'site', label: 'Dépôt', type: 'select', value: (o) => o.site.name },
      { key: 'total', label: 'Total', type: 'range', unit: 'DA', value: orderTotal },
    ],
    sorts: [
      { key: 'number', label: 'N°', value: (o) => o.number, desc: true },
      { key: 'kind', label: 'Type', value: (o) => o.kind },
      { key: 'customer', label: 'Client', value: (o) => o.customer.name },
      { key: 'site', label: 'Dépôt', value: (o) => o.site.name },
      { key: 'status', label: 'Statut', value: (o) => STATUS_LABEL[o.status] ?? o.status },
      { key: 'total', label: 'Total', value: orderTotal, desc: true },
      { key: 'date', label: 'Créé le', value: (o) => o.createdAt, desc: true },
    ],
  });
  const visibleOrders = orderList.rows;
  const deliveryNotes = docs.filter((d) => d.type === 'delivery_note');
  const customerReturns = docs.filter((d) => d.type === 'customer_return');
  const selectedDocs = deliveryNotes.filter((d) => selected.has(d.id));
  const canInvoiceDoc = (d: TradeDocumentView) =>
    d.status === 'validated' && !d.invoice && (selectedDocs.length === 0 || (selectedDocs[0].partner?.id ?? '') === (d.partner?.id ?? ''));

  async function invoiceSelection() {
    if (!accessToken || selectedDocs.length === 0) return;
    setInvoicing(true);
    try {
      const inv = await tradeApi.invoice(accessToken, selectedDocs.map((d) => d.id));
      toast.success(`Facture ${inv.number ?? ''} créée.`);
      navigate(`/invoicing?open=${inv.id}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Échec de la facturation.');
    } finally {
      setInvoicing(false);
    }
  }

  return (
    <AppShell>
      <div className="panel-head">
        <div>
          <h2>Ventes</h2>
          <div className="sub">Devis, commandes, livraisons et retours clients</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <ActionMenu
            items={[
              ...(can('sales.order.create') ? [
                { label: 'Bon de livraison', hint: 'Sortie de stock, avec ou sans commande', icon: 'truck' as const, onClick: () => setDocForm('delivery_note'), disabled: sites.length === 0 },
                { label: 'Retour client', hint: 'Marchandise rendue par un client', icon: 'chevronLeft' as const, onClick: () => setDocForm('customer_return'), disabled: sites.length === 0 },
                { label: 'Nouveau devis', hint: 'Proposition de prix au client', icon: 'receipt' as const, onClick: () => setShowFormKind('quote'), disabled: sites.length === 0 || customers.length === 0 },
              ] : []),
              { label: 'Tarifs négociés', hint: can('sales.pricing.write') ? 'Prix et remises par client' : 'Consulter les prix par client', icon: 'handshake' as const, onClick: () => setShowPricing(true) },
            ]}
          />
          {can('sales.order.create') && (
            <button className="btn-primary" onClick={() => setShowFormKind('order')} disabled={sites.length === 0 || customers.length === 0}>
              <Icon name="plus" size={16} /> Bon de commande
            </button>
          )}
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

      <div className="page-tabs" role="tablist">
        {(
          [
            ['orders', 'Devis & commandes', orders.length],
            ['delivery_note', 'Bons de livraison', deliveryNotes.length],
            ['customer_return', 'Retours clients', customerReturns.length],
          ] as const
        ).map(([k, label, count]) => (
          <button key={k} type="button" role="tab" className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {label}
            <span className="tab-count">{count}</span>
          </button>
        ))}
      </div>

      {tab === 'delivery_note' && (
        <>
          {selectedDocs.length > 0 && (
            <div className="selection-bar">
              <span>
                {selectedDocs.length} bon(s) sélectionné(s) · {selectedDocs[0].partner?.name ?? 'Client comptoir'}
              </span>
              <button type="button" className="btn-primary btn-sm" disabled={invoicing} onClick={invoiceSelection}>
                {invoicing ? 'Facturation…' : 'Générer la facture'}
              </button>
            </div>
          )}
          <DocumentTable
            listId="bl"
            docs={deliveryNotes}
            partnerLabel="Client"
            onOpen={(d) => setOpenDoc({ id: d.id, type: d.type })}
            selectable={canInvoiceDoc}
            selected={selected}
            onToggle={(id) =>
              setSelected((cur) => {
                const next = new Set(cur);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              })
            }
          />
        </>
      )}
      {tab === 'customer_return' && <DocumentTable listId="customer-returns" docs={customerReturns} partnerLabel="Client" onOpen={(d) => setOpenDoc({ id: d.id, type: d.type })} />}

      {tab === 'orders' && (
      <>
      {orderList.toolbar(
        <div className="toggle-row">
          {(['all', 'quote', 'order'] as const).map((k) => (
            <button key={k} className={`toggle-btn ${kindFilter === k ? 'on' : ''}`} onClick={() => setKindFilter(k)} type="button">
              {k === 'all' ? 'Tous' : k === 'quote' ? 'Devis' : 'Commandes'}
            </button>
          ))}
        </div>,
      )}

      {loading ? (
        <div className="page-loader"><span className="spinner" /> Chargement…</div>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                {orderList.th('number', 'N°')}
                {orderList.th('kind', 'Type')}
                {orderList.th('customer', 'Client')}
                {orderList.th('site', 'Dépôt')}
                {orderList.th('status', 'Statut')}
                {orderList.th('total', 'Total', 'num')}
                {orderList.th('date', 'Créé le')}
              </tr>
            </thead>
            <tbody>
              {visibleOrders.map((o) => {
                const total = orderTotal(o);
                return (
                  <tr key={o.id} className="clickable" onClick={() => setSelectedOrder(o)}>
                    <td className="mono">{o.number ?? '—'}</td>
                    <td>{o.kind === 'quote' ? 'Devis' : 'Bon de commande'}</td>
                    <td>{o.customer.name}</td>
                    <td>{o.site.name}</td>
                    <td>
                      <span className={`pill ${statusPillClass(o.status)}`}>{STATUS_LABEL[o.status] ?? o.status}</span>
                    </td>
                    <td className="num">{total.toFixed(2)} DZD</td>
                    <td>{new Date(o.createdAt).toLocaleDateString('fr-FR')}</td>
                  </tr>
                );
              })}
              {visibleOrders.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted" style={{ textAlign: 'center', padding: '24px 0' }}>
                    {orderList.filtered ? (
                  <>
                    Aucun résultat pour ces filtres.{' '}
                    <button type="button" className="btn-link" onClick={orderList.reset}>
                      Effacer les filtres
                    </button>
                  </>
                ) : (
                  'Aucun document pour le moment.'
                )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      </>
      )}

      {(docForm || deliverOrder) && (
        <DocumentFormModal
          type={deliverOrder ? 'delivery_note' : (docForm as TradeDocumentType)}
          order={deliverOrder ?? undefined}
          partners={partners}
          sites={sites}
          products={products}
          taxRates={taxRates}
          onClose={() => {
            setDocForm(null);
            setDeliverOrder(null);
          }}
          onCreated={(doc) => {
            setDocForm(null);
            setDeliverOrder(null);
            setTab(doc.type === 'customer_return' ? 'customer_return' : 'delivery_note');
            setOpenDoc({ id: doc.id, type: doc.type });
            load();
          }}
        />
      )}
      {openDoc && <DocumentDetailModal docId={openDoc.id} type={openDoc.type} onClose={() => setOpenDoc(null)} onChanged={load} />}

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
          onDeliver={() => {
            setDeliverOrder(selectedOrder);
            setSelectedOrder(null);
          }}
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
      toast.success(kind === 'quote' ? 'Devis créé.' : 'Commande créée.');
      onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setShortageMessage(err.message);
      } else {
        const message = err instanceof ApiError ? err.message : 'Erreur lors de la création.';
        setError(message);
        toast.error(message);
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
    <div className="modal-backdrop open">
      <div className="modal xwide">
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
          <div className="field-grid">
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
              <label>Date prévue</label>
              <input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
            </div>
          </div>

          <div className="lines-head">
            <span className="modal-section-label">Articles</span>
            <span className="lines-count">{lines.length}</span>
          </div>
          <div className="line-items">
            <div className="line-item line-item-head">
              <span className="li-grow">Produit / service</span>
              <span className="li-num">Cartons</span>
              <span className="li-num">Quantité</span>
              <span className="li-money">Prix unitaire</span>
              <span className="li-num">Remise %</span>
              <span className="li-select">TVA</span>
              <span className="li-remove" />
            </div>
            {lines.map((l, i) => {
              const product = l.isService ? undefined : products.find((p) => p.productId === l.productId);
              return (
                <div key={i} className="line-item">
                  <div className="li-grow" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    {l.isService ? (
                      <input
                        value={l.description}
                        onChange={(e) => updateLine(i, { description: e.target.value })}
                        placeholder="Description du service"
                        aria-label="Description du service"
                        className="control"
                        style={{ flex: 1 }}
                        required
                      />
                    ) : (
                      <div style={{ flex: 1, minWidth: 0 }}>
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
                    <button
                      type="button"
                      className="btn-link"
                      style={{ whiteSpace: 'nowrap', fontSize: '0.78rem' }}
                      onClick={() => updateLine(i, { isService: !l.isService, productId: '', description: '' })}
                      title={l.isService ? 'Utiliser un produit du stock' : 'Ligne de service (sans stock)'}
                    >
                      {l.isService ? 'Produit' : 'Service'}
                    </button>
                  </div>
                  {l.isService ? (
                    <span className="li-num" />
                  ) : (
                    <CartonInput unitsPerCarton={product?.unitsPerCarton} quantity={l.quantity} onQuantityChange={(q) => updateLine(i, { quantity: q })} />
                  )}
                  <input
                    type="number"
                    min={0.001}
                    step="any"
                    value={l.quantity}
                    onChange={(e) => updateLine(i, { quantity: Number(e.target.value) })}
                    placeholder="Qté"
                    aria-label="Quantité"
                    className="control li-num"
                    required
                  />
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={l.unitPrice}
                    onChange={(e) => updateLine(i, { unitPrice: e.target.value })}
                    placeholder={l.isService ? 'Prix (requis)' : 'Auto'}
                    aria-label="Prix unitaire"
                    title={l.isService ? 'Prix unitaire (requis)' : 'Laisser vide pour le prix automatique'}
                    className="control li-money"
                    required={l.isService}
                  />
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step="any"
                    value={l.discountPercent}
                    onChange={(e) => updateLine(i, { discountPercent: e.target.value })}
                    placeholder="0"
                    aria-label="Remise %"
                    className="control li-num"
                  />
                  <select value={l.taxRateId} onChange={(e) => updateLine(i, { taxRateId: e.target.value })} className="control li-select" aria-label="TVA">
                    <option value="">Sans TVA</option>
                    {taxRates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.rate}%)
                      </option>
                    ))}
                  </select>
                  {lines.length > 1 ? (
                    <button type="button" className="li-remove" onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))} aria-label="Retirer la ligne" title="Retirer">
                      ✕
                    </button>
                  ) : (
                    <span className="li-remove" />
                  )}
                </div>
              );
            })}
          </div>
          <button type="button" className="btn-link" onClick={() => setLines((ls) => [...ls, blankLine(defaultTaxRateId)])}>
            + Ajouter un article
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

function OrderDetailModal({ order, onClose, onChanged, onDeliver }: { order: SalesOrderView; onClose: () => void; onChanged: () => void; onDeliver: () => void }) {
  const { accessToken, can } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shortageMessage, setShortageMessage] = useState<string | null>(null);
  const [showInvoice, setShowInvoice] = useState(false);
  const [printing, setPrinting] = useState<'order' | 'delivery' | null>(null);
  const [confirmingLineId, setConfirmingLineId] = useState<string | null>(null);
  const [deletingLineId, setDeletingLineId] = useState<string | null>(null);

  const canPromote = can('sales.order.update') && order.kind === 'quote' && order.status !== 'cancelled';
  const canCancel = can('sales.order.cancel') && order.status !== 'cancelled' && order.status !== 'invoiced' && !order.lines.some((l) => l.quantityInvoiced > 0);
  const remainingToInvoice = order.lines.reduce((s, l) => s + remainingToInvoiceOn(l), 0);
  const canInvoice = can('sales.invoice.create') && order.kind === 'order' && order.status !== 'cancelled' && remainingToInvoice > 0;
  const canDeliver = can('sales.order.update') && order.kind === 'order' && order.status !== 'cancelled' && remainingToInvoice > 0;
  const canDelete = can('sales.order.delete') && !order.lines.some((l) => l.quantityInvoiced > 0 || l.quantityInDraft > 0 || l.quantityDelivered > 0);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  async function handleDelete() {
    if (!accessToken) return;
    setBusy(true);
    setError(null);
    try {
      await salesApi.deleteOrder(accessToken, order.id);
      toast.success(order.kind === 'quote' ? 'Devis supprimé.' : 'Commande supprimée.');
      onChanged();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Erreur lors de la suppression.';
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
      setConfirmingDelete(false);
    }
  }

  async function handleDeleteLine(lineId: string) {
    if (!accessToken) return;
    setDeletingLineId(lineId);
    setError(null);
    try {
      await salesApi.deleteOrderLine(accessToken, order.id, lineId);
      toast.success('Ligne supprimée.');
      onChanged();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Erreur lors de la suppression de la ligne.';
      setError(message);
      toast.error(message);
    } finally {
      setDeletingLineId(null);
      setConfirmingLineId(null);
    }
  }

  async function handlePromote(acknowledgeShortage = false) {
    if (!accessToken) return;
    setBusy(true);
    setError(null);
    setShortageMessage(null);
    try {
      await salesApi.promoteOrder(accessToken, order.id, acknowledgeShortage);
      toast.success('Devis transformé en commande.');
      onChanged();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setShortageMessage(err.message);
      } else {
        const message = err instanceof ApiError ? err.message : 'Erreur lors de la promotion.';
        setError(message);
        toast.error(message);
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
      toast.success(order.kind === 'quote' ? 'Devis annulé.' : 'Commande annulée.');
      onChanged();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Erreur lors de l'annulation.";
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  async function printOrder() {
    if (!accessToken) return;
    setPrinting('order');
    setError(null);
    try {
      const blob = await salesApi.fetchOrderPdf(accessToken, order.id);
      window.open(URL.createObjectURL(blob), '_blank');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossible de générer le document.');
    } finally {
      setPrinting(null);
    }
  }

  async function printDeliveryNote() {
    if (!accessToken) return;
    setPrinting('delivery');
    setError(null);
    try {
      const blob = await salesApi.fetchDeliveryNotePdf(accessToken, order.id);
      window.open(URL.createObjectURL(blob), '_blank');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de générer le bon de livraison.");
    } finally {
      setPrinting(null);
    }
  }

  return (
    <div className="modal-backdrop open">
      <div className="modal wide">
        <div className="modal-header">
          <div className="modal-header-titles">
            <h3>{order.number ?? (order.kind === 'quote' ? 'Devis' : 'Commande')}</h3>
            <p className="modal-sub">
              {order.customer.name} · {order.site.name} · <span className={`pill ${statusPillClass(order.status)}`}>{STATUS_LABEL[order.status] ?? order.status}</span>
            </p>
            {order.promotedFromQuoteNumber && <p className="modal-sub">Issue du devis {order.promotedFromQuoteNumber}</p>}
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Produit</th>
                <th className="num">Commandé</th>
                <th className="num">Livré</th>
                <th className="num">Facturé</th>
                <th className="num">Prix unitaire</th>
                <th className="num">Remise</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {order.lines.map((l) => (
                <tr key={l.id}>
                  <td>
                    <div className="cell-title">{l.product ? l.product.name : l.description}</div>
                    {l.product && <div className="cell-sub mono">{l.product.sku}</div>}
                  </td>
                  <td className="num">{l.quantityOrdered}</td>
                  <td className="num">{l.quantityDelivered || '—'}</td>
                  <td className="num">
                    {l.quantityInvoiced}
                    {l.quantityInDraft > 0 && <div className="cell-sub">+{l.quantityInDraft} en brouillon</div>}
                  </td>
                  <td className="num">{l.unitPrice.toFixed(2)} DZD</td>
                  <td className="num">{l.discountPercent != null ? `${l.discountPercent}%` : '—'}</td>
                  <td>
                    {can('sales.orderline.delete') && (                    <button
                      type="button"
                      className="btn-link danger"
                      disabled={l.quantityInvoiced > 0 || l.quantityDelivered > 0 || deletingLineId === l.id}
                      title={l.quantityInvoiced > 0 || l.quantityDelivered > 0 ? 'Cette ligne a déjà été facturée ou livrée, elle ne peut plus être supprimée.' : undefined}
                      onClick={() => (confirmingLineId === l.id ? handleDeleteLine(l.id) : setConfirmingLineId(l.id))}
                      onBlur={() => setConfirmingLineId((c) => (c === l.id ? null : c))}
                    >
                      {deletingLineId === l.id ? 'Suppression…' : confirmingLineId === l.id ? 'Confirmer ?' : 'Retirer'}
                    </button>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {order.invoices && order.invoices.length > 0 && (
          <div className="sub" style={{ marginTop: 10 }}>
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
        <div className="modal-footer modal-footer-split">
          <div className="modal-footer-group">
            <button type="button" className="btn-link" onClick={printOrder} disabled={printing !== null}>
              {printing === 'order' ? 'Génération…' : order.kind === 'quote' ? 'Imprimer le devis' : 'Imprimer le BC'}
            </button>
            {order.kind === 'order' && (
              <button type="button" className="btn-link" onClick={printDeliveryNote} disabled={printing !== null}>
                {printing === 'delivery' ? 'Génération…' : 'Imprimer le BL'}
              </button>
            )}
            {canDelete && (
              <button
                type="button"
                className="btn-link danger"
                disabled={busy}
                onClick={() => (confirmingDelete ? handleDelete() : setConfirmingDelete(true))}
                onBlur={() => setConfirmingDelete(false)}
              >
                {confirmingDelete ? 'Confirmer la suppression ?' : order.kind === 'quote' ? 'Supprimer le devis' : 'Supprimer la commande'}
              </button>
            )}
          </div>
          <div className="modal-footer-group">
            {canCancel && (
              <button type="button" className="btn-secondary" onClick={handleCancel} disabled={busy}>
                {busy ? 'Annulation…' : 'Annuler'}
              </button>
            )}
            {canPromote && (
              <button type="button" className="btn-primary" onClick={() => handlePromote(false)} disabled={busy}>
                {busy ? 'Promotion…' : 'Promouvoir en commande'}
              </button>
            )}
            {canInvoice && (
              <button type="button" className="btn-primary" onClick={() => setShowInvoice(true)} title="Facture directe (le stock sort à la finalisation)">
                Facturer
              </button>
            )}
            {canDeliver && (
              <button type="button" className="btn-primary" onClick={onDeliver}>
                Livrer (bon de livraison)
              </button>
            )}
          </div>
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

// Quantities sitting on draft factures aren't in quantityInvoiced until they
// are finalized, but they're spoken for — the API refuses to draft them twice.
function remainingToInvoiceOn(l: SalesOrderView['lines'][number]): number {
  return Math.max(0, l.quantityOrdered - l.quantityInvoiced - l.quantityDelivered - l.quantityInDraft);
}

function InvoiceOrderModal({ order, onClose, onInvoiced }: { order: SalesOrderView; onClose: () => void; onInvoiced: () => void }) {
  const { accessToken } = useAuth();
  const navigate = useNavigate();
  const invoiceableLines = order.lines.filter((l) => remainingToInvoiceOn(l) > 0);
  const [quantities, setQuantities] = useState<Record<string, number>>(
    Object.fromEntries(invoiceableLines.map((l) => [l.id, remainingToInvoiceOn(l)])),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!accessToken) return;
    setSubmitting(true);
    setError(null);
    try {
      const draft = await salesApi.invoiceOrder(accessToken, order.id, {
        lines: invoiceableLines.filter((l) => quantities[l.id] > 0).map((l) => ({ salesOrderLineId: l.id, quantity: quantities[l.id] })),
      });
      try {
        const inv = await invoicingApi.finalizeInvoice(accessToken, draft.id);
        toast.success(`Facture ${inv.number ?? ''} créée.`);
      } catch (err) {
        toast.error(`Facture gardée en brouillon : ${err instanceof ApiError ? err.message : 'finalisation impossible.'}`);
      }
      onInvoiced();
      navigate(`/invoicing?open=${draft.id}`);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Erreur lors de la facturation.';
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop open">
      <div className="modal">
        <div className="modal-header">
          <div className="modal-header-titles">
            <h3>Facturer {order.number}</h3>
            <p className="modal-sub">Facture numérotée directement · le stock sort à la validation.</p>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>
        <form onSubmit={handleSubmit} className="field-form">
          {invoiceableLines.map((l) => {
            const remaining = remainingToInvoiceOn(l);
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
                  className="control"
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
      toast.success('Prix enregistré.');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Erreur lors de l'enregistrement.";
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    if (!accessToken) return;
    try {
      await salesApi.deletePricing(accessToken, id);
      load();
      toast.success('Prix supprimé.');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Erreur lors de la suppression.';
      setError(message);
      toast.error(message);
    }
  }

  return (
    <div className="modal-backdrop open">
      <div className="modal wide">
        <div className="modal-header">
          <div className="modal-header-titles">
            <h3>Tarifs négociés par client</h3>
            <p className="modal-sub">Appliqués automatiquement aux commandes du client.</p>
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
          <div className="table-wrap">
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
          </div>

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
              <input
                type="number"
                min={0}
                step="any"
                value={unitPrice}
                onChange={(e) => setUnitPrice(e.target.value)}
                placeholder="Prix négocié"
                className="control"
                style={{ width: 140 }}
              />
              <input
                type="number"
                min={0}
                max={100}
                step="any"
                value={discountPercent}
                onChange={(e) => setDiscountPercent(e.target.value)}
                placeholder="Remise %"
                className="control"
                style={{ width: 110 }}
              />
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
