import { FormEvent, useCallback, useEffect, useState } from 'react';
import { AppShell } from '../lib/AppShell';
import { useAuth } from '../lib/auth-context';
import { SearchableSelect } from '../lib/SearchableSelect';
import {
  ApiError,
  Partner,
  PurchaseOrderView,
  Site,
  StockRow,
  invoicingApi,
  purchasingApi,
  sitesApi,
  stockApi,
} from '../lib/api';
import '../lib/data-views.css';

const STATUS_LABEL: Record<PurchaseOrderView['status'], string> = {
  draft: 'Brouillon',
  confirmed: 'Confirmé',
  partially_received: 'Partiellement reçu',
  received: 'Reçu',
  cancelled: 'Annulé',
  rfq: 'En comparaison (RFQ)',
  rfq_rejected: 'Rejeté (RFQ)',
};

function statusPillClass(status: PurchaseOrderView['status']): string {
  if (status === 'received') return 'success';
  if (status === 'partially_received') return 'warning';
  if (status === 'cancelled' || status === 'rfq_rejected') return 'danger';
  if (status === 'rfq') return 'info';
  return 'info';
}

export function PurchasingPage() {
  const { accessToken } = useAuth();
  const [orders, setOrders] = useState<PurchaseOrderView[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [products, setProducts] = useState<StockRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showOrderForm, setShowOrderForm] = useState(false);
  const [showFreeReceipt, setShowFreeReceipt] = useState(false);
  const [showRfqForm, setShowRfqForm] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<PurchaseOrderView | null>(null);
  const [showReceiveFor, setShowReceiveFor] = useState<PurchaseOrderView | null>(null);
  const [rfqGroupId, setRfqGroupId] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<{
    openOrdersCount: number;
    openOrdersValue: number;
    overdueCount: number;
    expectedSoonCount: number;
  } | null>(null);

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const [orderList, siteList, partnerList, productRows, dash] = await Promise.all([
        purchasingApi.listOrders(accessToken),
        sitesApi.list(accessToken),
        invoicingApi.listPartners(accessToken),
        stockApi.listProducts(accessToken, 'all'),
        purchasingApi.getDashboard(accessToken),
      ]);
      setOrders(orderList);
      setSites(siteList);
      setPartners(partnerList);
      setProducts(productRows);
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

  const suppliers = partners.filter((p) => p.isSupplier);
  const uniqueProducts = Array.from(new Map(products.map((p) => [p.productId, p])).values());

  return (
    <AppShell>
      <div className="panel-head">
        <div>
          <h2>Achats</h2>
          <div className="sub">{orders.length} bon(s) de commande</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn-secondary" onClick={() => setShowRfqForm(true)} disabled={sites.length === 0 || suppliers.length < 2}>
            + Comparer fournisseurs (RFQ)
          </button>
          <button className="btn-secondary" onClick={() => setShowFreeReceipt(true)} disabled={sites.length === 0}>
            + Réception libre
          </button>
          <button className="btn-primary" onClick={() => setShowOrderForm(true)} disabled={sites.length === 0 || suppliers.length === 0}>
            + Bon de commande
          </button>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {!loading && sites.length === 0 && <p className="sub">Créez d&apos;abord un site (module Multi-Sites) pour passer une commande.</p>}
      {!loading && sites.length > 0 && suppliers.length === 0 && (
        <p className="sub">Aucun fournisseur enregistré — ajoutez-en un depuis Fournisseurs &amp; clients.</p>
      )}

      {dashboard && (
        <div className="stat-strip">
          <div className="stat-card">
            <div className="num">{dashboard.openOrdersCount}</div>
            <div className="label">BC ouverts</div>
          </div>
          <div className="stat-card">
            <div className="num">{dashboard.openOrdersValue.toFixed(2)} DZD</div>
            <div className="label">Valeur en cours</div>
          </div>
          <div className="stat-card warn">
            <div className="num">{dashboard.expectedSoonCount}</div>
            <div className="label">Attendues sous 7j</div>
          </div>
          <div className="stat-card bad">
            <div className="num">{dashboard.overdueCount}</div>
            <div className="label">En retard</div>
          </div>
        </div>
      )}

      {loading ? (
        <p className="sub">Chargement…</p>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>N°</th>
              <th>Fournisseur</th>
              <th>Site</th>
              <th>Statut</th>
              <th>Progression</th>
              <th>Créé le</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => {
              const ordered = o.lines.reduce((s, l) => s + l.quantityOrdered, 0);
              const received = o.lines.reduce((s, l) => s + l.quantityReceived, 0);
              return (
                <tr
                  key={o.id}
                  onClick={() => (o.status === 'rfq' || o.status === 'rfq_rejected' ? setRfqGroupId(o.comparisonGroupId) : setSelectedOrder(o))}
                  style={{ cursor: 'pointer' }}
                >
                  <td className="mono">{o.number ?? '—'}</td>
                  <td>{o.supplier.name}</td>
                  <td>{o.site.name}</td>
                  <td>
                    <span className={`pill ${statusPillClass(o.status)}`}>{STATUS_LABEL[o.status]}</span>
                  </td>
                  <td>
                    {received} / {ordered}
                  </td>
                  <td>{new Date(o.createdAt).toLocaleDateString('fr-FR')}</td>
                </tr>
              );
            })}
            {orders.length === 0 && (
              <tr>
                <td colSpan={6} className="sub">
                  Aucun bon de commande pour le moment.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {showOrderForm && (
        <OrderFormModal
          sites={sites}
          suppliers={suppliers}
          products={uniqueProducts}
          onClose={() => setShowOrderForm(false)}
          onSaved={() => {
            setShowOrderForm(false);
            load();
          }}
        />
      )}
      {selectedOrder && (
        <OrderDetailModal
          order={selectedOrder}
          onClose={() => setSelectedOrder(null)}
          onReceive={() => {
            setShowReceiveFor(selectedOrder);
            setSelectedOrder(null);
          }}
          onCancelled={() => {
            setSelectedOrder(null);
            load();
          }}
        />
      )}
      {showReceiveFor && (
        <ReceiveModal
          order={showReceiveFor}
          products={uniqueProducts}
          onClose={() => setShowReceiveFor(null)}
          onSaved={() => {
            setShowReceiveFor(null);
            load();
          }}
        />
      )}
      {showFreeReceipt && (
        <ReceiveModal
          order={null}
          sites={sites}
          products={uniqueProducts}
          onClose={() => setShowFreeReceipt(false)}
          onSaved={() => {
            setShowFreeReceipt(false);
            load();
          }}
        />
      )}
      {showRfqForm && (
        <RfqFormModal
          sites={sites}
          suppliers={suppliers}
          products={uniqueProducts}
          onClose={() => setShowRfqForm(false)}
          onCreated={(groupId) => {
            setShowRfqForm(false);
            setRfqGroupId(groupId);
            load();
          }}
        />
      )}
      {rfqGroupId && (
        <RfqComparisonModal
          groupId={rfqGroupId}
          onClose={() => setRfqGroupId(null)}
          onAwarded={() => {
            setRfqGroupId(null);
            load();
          }}
        />
      )}
    </AppShell>
  );
}

function OrderFormModal({
  sites,
  suppliers,
  products,
  onClose,
  onSaved,
}: {
  sites: Site[];
  suppliers: Partner[];
  products: StockRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { accessToken } = useAuth();
  const [siteId, setSiteId] = useState(sites[0]?.id ?? '');
  const [supplierId, setSupplierId] = useState('');
  const [lines, setLines] = useState<{ productId: string; quantityOrdered: number; unitCost: number }[]>([
    { productId: products[0]?.productId ?? '', quantityOrdered: 1, unitCost: 0 },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateLine(i: number, patch: Partial<(typeof lines)[number]>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!accessToken || !supplierId) return;
    setSubmitting(true);
    setError(null);
    try {
      await purchasingApi.createOrder(accessToken, {
        siteId,
        supplierId,
        lines: lines.filter((l) => l.productId && l.quantityOrdered > 0),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur lors de la création du bon de commande.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <div className="modal-header-titles">
            <h3>Nouveau bon de commande</h3>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>
        <form onSubmit={handleSubmit} className="field-form">
          <div className="field-row">
            <label>Fournisseur</label>
            <SearchableSelect
              value={supplierId}
              onChange={setSupplierId}
              options={suppliers.map((s) => ({ value: s.id, label: s.name, sublabel: s.nif }))}
              placeholder="Rechercher un fournisseur…"
            />
          </div>
          <div className="field-row">
            <label>Site de destination</label>
            <select value={siteId} onChange={(e) => setSiteId(e.target.value)} required>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div className="sub" style={{ marginTop: 4 }}>
            Lignes
          </div>
          {lines.map((l, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 200px' }}>
                  <SearchableSelect
                    value={l.productId}
                    onChange={(v) => updateLine(i, { productId: v })}
                    options={products.map((p) => ({ value: p.productId, label: p.name, sublabel: p.sku }))}
                    placeholder="Produit…"
                  />
                </div>
                <input
                  type="number"
                  min={0.001}
                  step="any"
                  value={l.quantityOrdered}
                  onChange={(e) => updateLine(i, { quantityOrdered: Number(e.target.value) })}
                  placeholder="Qté"
                  style={{ width: 90 }}
                  required
                />
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={l.unitCost}
                  onChange={(e) => updateLine(i, { unitCost: Number(e.target.value) })}
                  placeholder="Coût unitaire"
                  style={{ width: 120 }}
                  required
                />
                {lines.length > 1 && (
                  <button type="button" className="btn-link" onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}>
                    Retirer
                  </button>
                )}
              </div>
              {l.productId && (
                <LastPriceHint productId={l.productId} supplierId={supplierId} onApply={(price) => updateLine(i, { unitCost: price })} />
              )}
            </div>
          ))}
          <button
            type="button"
            className="btn-link"
            onClick={() => setLines((ls) => [...ls, { productId: products[0]?.productId ?? '', quantityOrdered: 1, unitCost: 0 }])}
          >
            + Ajouter une ligne
          </button>

          {error && <div className="error-banner">{error}</div>}
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Annuler
            </button>
            <button type="submit" className="btn-primary" disabled={submitting || !supplierId}>
              {submitting ? 'Création…' : 'Créer le bon de commande'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function OrderDetailModal({
  order,
  onClose,
  onReceive,
  onCancelled,
}: {
  order: PurchaseOrderView;
  onClose: () => void;
  onReceive: () => void;
  onCancelled: () => void;
}) {
  const { accessToken } = useAuth();
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showInvoice, setShowInvoice] = useState(false);
  const canReceive = order.status === 'confirmed' || order.status === 'partially_received';
  const canCancel = canReceive && order.lines.every((l) => l.quantityReceived === 0);
  const canInvoice = order.lines.some((l) => l.quantityReceived > 0);

  async function handleCancel() {
    if (!accessToken) return;
    setCancelling(true);
    setError(null);
    try {
      await purchasingApi.cancelOrder(accessToken, order.id);
      onCancelled();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Erreur lors de l'annulation.");
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div className="modal-backdrop open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <div className="modal-header-titles">
            <h3>{order.number ?? 'Bon de commande'}</h3>
            <p className="modal-sub">
              {order.supplier.name} · {order.site.name} · <span className={`pill ${statusPillClass(order.status)}`}>{STATUS_LABEL[order.status]}</span>
            </p>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>
        <table className="data">
          <thead>
            <tr>
              <th>Produit</th>
              <th>Commandé</th>
              <th>Reçu</th>
              <th>Coût unitaire</th>
            </tr>
          </thead>
          <tbody>
            {order.lines.map((l) => (
              <tr key={l.id}>
                <td>{l.product ? `${l.product.sku} — ${l.product.name}` : l.productId}</td>
                <td>{l.quantityOrdered}</td>
                <td>{l.quantityReceived}</td>
                <td>{l.unitCost.toFixed(2)} DZD</td>
              </tr>
            ))}
          </tbody>
        </table>
        {error && <div className="error-banner">{error}</div>}
        <div className="modal-footer">
          {canCancel && (
            <button type="button" className="btn-secondary" onClick={handleCancel} disabled={cancelling}>
              {cancelling ? 'Annulation…' : 'Annuler le bon'}
            </button>
          )}
          <button type="button" className="btn-secondary" onClick={onClose}>
            Fermer
          </button>
          {canInvoice && (
            <button type="button" className="btn-primary" onClick={() => setShowInvoice(true)}>
              Facture fournisseur
            </button>
          )}
          {canReceive && (
            <button type="button" className="btn-primary" onClick={onReceive}>
              Réceptionner
            </button>
          )}
        </div>
      </div>
      {showInvoice && <SupplierInvoiceModal order={order} onClose={() => setShowInvoice(false)} onInvoiced={() => setShowInvoice(false)} />}
    </div>
  );
}

function SupplierInvoiceModal({ order, onClose, onInvoiced }: { order: PurchaseOrderView; onClose: () => void; onInvoiced: () => void }) {
  const { accessToken } = useAuth();
  const receivedLines = order.lines.filter((l) => l.quantityReceived > 0);
  const [number, setNumber] = useState('');
  const [quantities, setQuantities] = useState<Record<string, number>>(Object.fromEntries(receivedLines.map((l) => [l.id, l.quantityReceived])));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!accessToken || !number) return;
    setSubmitting(true);
    setError(null);
    try {
      await purchasingApi.createSupplierInvoice(accessToken, order.id, {
        number,
        lines: receivedLines
          .filter((l) => quantities[l.id] > 0)
          .map((l) => ({
            productId: l.productId,
            description: l.product ? `${l.product.sku} — ${l.product.name}` : l.productId,
            quantity: quantities[l.id],
            unitPrice: l.unitCost,
          })),
      });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur lors de la création de la facture.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <div className="modal-header-titles">
            <h3>Facture fournisseur — {order.number}</h3>
            <p className="modal-sub">Enregistre la facture du fournisseur pour les quantités reçues — à finaliser depuis le module Factures.</p>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>
        {done ? (
          <div className="modal-footer" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn-primary" onClick={onInvoiced}>
              Terminé
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="field-form">
            <div className="field-row">
              <label>N° de facture du fournisseur</label>
              <input value={number} onChange={(e) => setNumber(e.target.value)} required />
            </div>
            {receivedLines.map((l) => (
              <div key={l.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 220px' }}>{l.product ? `${l.product.sku} — ${l.product.name}` : l.productId}</div>
                <input
                  type="number"
                  min={0}
                  max={l.quantityReceived}
                  step="any"
                  value={quantities[l.id]}
                  onChange={(e) => setQuantities((q) => ({ ...q, [l.id]: Number(e.target.value) }))}
                  style={{ width: 100 }}
                />
                <span className="sub">/ {l.quantityReceived} reçu · {l.unitCost.toFixed(2)} DZD/u</span>
              </div>
            ))}
            {error && <div className="error-banner">{error}</div>}
            <div className="modal-footer">
              <button type="button" className="btn-secondary" onClick={onClose}>
                Annuler
              </button>
              <button type="submit" className="btn-primary" disabled={submitting || !number}>
                {submitting ? 'Création…' : 'Créer la facture'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

interface ReceiveLineState {
  purchaseOrderLineId?: string;
  productId: string;
  productLabel: string;
  isLotTracked: boolean;
  quantity: number;
  unitCost: number;
  newLotNumber: string;
  qualityResult: '' | 'conforme' | 'non_conforme';
}

function ReceiveModal({
  order,
  sites,
  products,
  onClose,
  onSaved,
}: {
  order: PurchaseOrderView | null;
  sites?: Site[];
  products: StockRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { accessToken } = useAuth();
  const [siteId, setSiteId] = useState(order?.siteId ?? sites?.[0]?.id ?? '');
  const [landedCostAmount, setLandedCostAmount] = useState('');
  const [landedCostNotes, setLandedCostNotes] = useState('');
  const [lines, setLines] = useState<ReceiveLineState[]>(() => {
    if (order) {
      return order.lines
        .filter((l) => l.quantityReceived < l.quantityOrdered)
        .map((l) => {
          const p = products.find((pr) => pr.productId === l.productId);
          return {
            purchaseOrderLineId: l.id,
            productId: l.productId,
            productLabel: l.product ? `${l.product.sku} — ${l.product.name}` : l.productId,
            isLotTracked: p?.isLotTracked ?? false,
            quantity: l.quantityOrdered - l.quantityReceived,
            unitCost: l.unitCost,
            newLotNumber: '',
            qualityResult: '',
          };
        });
    }
    const first = products[0];
    return first
      ? [{ productId: first.productId, productLabel: `${first.sku} — ${first.name}`, isLotTracked: first.isLotTracked, quantity: 1, unitCost: 0, newLotNumber: '', qualityResult: '' }]
      : [];
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateLine(i: number, patch: Partial<ReceiveLineState>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!accessToken || !siteId) return;
    setSubmitting(true);
    setError(null);
    try {
      await purchasingApi.receiveGoods(accessToken, {
        purchaseOrderId: order?.id,
        siteId,
        landedCostAmount: landedCostAmount ? Number(landedCostAmount) : undefined,
        landedCostNotes: landedCostNotes || undefined,
        lines: lines
          .filter((l) => l.productId && l.quantity > 0)
          .map((l) => ({
            purchaseOrderLineId: l.purchaseOrderLineId,
            productId: l.productId,
            quantity: l.quantity,
            unitCost: l.unitCost,
            newLot: l.isLotTracked && l.newLotNumber ? { lotNumber: l.newLotNumber } : undefined,
            qualityResult: l.qualityResult || undefined,
          })),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur lors de la réception.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <div className="modal-header-titles">
            <h3>{order ? `Réceptionner — ${order.number ?? ''}` : 'Réception libre'}</h3>
            {!order && <p className="modal-sub">Sans bon de commande — pour un fournisseur informel ou une livraison imprévue.</p>}
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>
        <form onSubmit={handleSubmit} className="field-form">
          {!order && sites && (
            <div className="field-row">
              <label>Site de réception</label>
              <select value={siteId} onChange={(e) => setSiteId(e.target.value)} required>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="field-grid">
            <div className="field-row">
              <label>Frais annexes (transport/douane/assurance) — montant global (optionnel)</label>
              <input
                type="number"
                min={0}
                step="any"
                value={landedCostAmount}
                onChange={(e) => setLandedCostAmount(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div className="field-row">
              <label>Note sur les frais annexes</label>
              <input value={landedCostNotes} onChange={(e) => setLandedCostNotes(e.target.value)} placeholder="ex: transport + douane facture #123" />
            </div>
          </div>
          {landedCostAmount && (
            <p className="sub">Sera réparti au prorata de la valeur de chaque ligne (coût unitaire × quantité) dans le coût de revient.</p>
          )}

          {lines.map((l, i) => (
            <div key={i} className="lot-mini-table" style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
              {order ? (
                <strong>{l.productLabel}</strong>
              ) : (
                <SearchableSelect
                  value={l.productId}
                  onChange={(v) => {
                    const p = products.find((pr) => pr.productId === v);
                    updateLine(i, { productId: v, productLabel: p ? `${p.sku} — ${p.name}` : v, isLotTracked: p?.isLotTracked ?? false });
                  }}
                  options={products.map((p) => ({ value: p.productId, label: p.name, sublabel: p.sku }))}
                  placeholder="Produit…"
                />
              )}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <input
                  type="number"
                  min={0.001}
                  step="any"
                  value={l.quantity}
                  onChange={(e) => updateLine(i, { quantity: Number(e.target.value) })}
                  placeholder="Qté reçue"
                  style={{ width: 100 }}
                  required
                />
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={l.unitCost}
                  onChange={(e) => updateLine(i, { unitCost: Number(e.target.value) })}
                  placeholder="Coût unitaire"
                  style={{ width: 120 }}
                  required
                />
                {l.isLotTracked && (
                  <input
                    value={l.newLotNumber}
                    onChange={(e) => updateLine(i, { newLotNumber: e.target.value })}
                    placeholder="N° de lot (optionnel)"
                    style={{ width: 160 }}
                  />
                )}
                <select value={l.qualityResult} onChange={(e) => updateLine(i, { qualityResult: e.target.value as ReceiveLineState['qualityResult'] })}>
                  <option value="">Contrôle qualité (optionnel)</option>
                  <option value="conforme">Conforme</option>
                  <option value="non_conforme">Non conforme</option>
                </select>
                {!order && lines.length > 1 && (
                  <button type="button" className="btn-link" onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}>
                    Retirer
                  </button>
                )}
              </div>
            </div>
          ))}
          {!order && (
            <button
              type="button"
              className="btn-link"
              onClick={() =>
                setLines((ls) => [
                  ...ls,
                  { productId: products[0]?.productId ?? '', productLabel: '', isLotTracked: products[0]?.isLotTracked ?? false, quantity: 1, unitCost: 0, newLotNumber: '', qualityResult: '' },
                ])
              }
            >
              + Ajouter une ligne
            </button>
          )}

          {error && <div className="error-banner">{error}</div>}
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Annuler
            </button>
            <button type="submit" className="btn-primary" disabled={submitting || lines.length === 0}>
              {submitting ? 'Réception…' : 'Confirmer la réception'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function LastPriceHint({ productId, supplierId, onApply }: { productId: string; supplierId: string; onApply: (price: number) => void }) {
  const { accessToken } = useAuth();
  const [lastPrice, setLastPrice] = useState<{ unitCost: number; receivedAt: string; supplier: { id: string; name: string } | null } | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    if (!accessToken || !productId) return;
    setLastPrice(undefined);
    purchasingApi
      .getLastPricePaid(accessToken, productId, supplierId || undefined)
      .then((res) => {
        if (!cancelled) setLastPrice(res);
      })
      .catch(() => {
        if (!cancelled) setLastPrice(null);
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken, productId, supplierId]);

  if (!lastPrice) return null;
  return (
    <p className="sub" style={{ margin: 0 }}>
      Dernier prix payé{lastPrice.supplier ? ` (${lastPrice.supplier.name})` : ''} : {lastPrice.unitCost.toFixed(2)} DZD le{' '}
      {new Date(lastPrice.receivedAt).toLocaleDateString('fr-FR')} —{' '}
      <button type="button" className="btn-link" onClick={() => onApply(lastPrice.unitCost)}>
        Utiliser ce prix
      </button>
    </p>
  );
}

function RfqFormModal({
  sites,
  suppliers,
  products,
  onClose,
  onCreated,
}: {
  sites: Site[];
  suppliers: Partner[];
  products: StockRow[];
  onClose: () => void;
  onCreated: (groupId: string) => void;
}) {
  const { accessToken } = useAuth();
  const [siteId, setSiteId] = useState(sites[0]?.id ?? '');
  const [supplierIds, setSupplierIds] = useState<string[]>([]);
  const [productLines, setProductLines] = useState<{ productId: string; quantity: number }[]>([{ productId: products[0]?.productId ?? '', quantity: 1 }]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleSupplier(id: string) {
    setSupplierIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  }
  function updateLine(i: number, patch: Partial<(typeof productLines)[number]>) {
    setProductLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!accessToken || supplierIds.length < 2) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await purchasingApi.createRfq(accessToken, {
        siteId,
        supplierIds,
        productLines: productLines.filter((l) => l.productId && l.quantity > 0),
      });
      onCreated(res.comparisonGroupId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur lors de la création du RFQ.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <div className="modal-header-titles">
            <h3>Comparer des fournisseurs (RFQ)</h3>
            <p className="modal-sub">Crée un bon de commande brouillon par fournisseur sélectionné, pour comparer leurs prix avant de choisir.</p>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>
        <form onSubmit={handleSubmit} className="field-form">
          <div className="field-row">
            <label>Site de destination</label>
            <select value={siteId} onChange={(e) => setSiteId(e.target.value)} required>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field-row">
            <label>Fournisseurs à comparer (2 minimum)</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {suppliers.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`toggle-btn ${supplierIds.includes(s.id) ? 'on' : ''}`}
                  onClick={() => toggleSupplier(s.id)}
                >
                  {s.name}
                </button>
              ))}
            </div>
          </div>

          <div className="sub" style={{ marginTop: 4 }}>
            Produits à comparer
          </div>
          {productLines.map((l, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 200px' }}>
                <SearchableSelect
                  value={l.productId}
                  onChange={(v) => updateLine(i, { productId: v })}
                  options={products.map((p) => ({ value: p.productId, label: p.name, sublabel: p.sku }))}
                  placeholder="Produit…"
                />
              </div>
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
              {productLines.length > 1 && (
                <button type="button" className="btn-link" onClick={() => setProductLines((ls) => ls.filter((_, idx) => idx !== i))}>
                  Retirer
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            className="btn-link"
            onClick={() => setProductLines((ls) => [...ls, { productId: products[0]?.productId ?? '', quantity: 1 }])}
          >
            + Ajouter une ligne
          </button>

          {error && <div className="error-banner">{error}</div>}
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Annuler
            </button>
            <button type="submit" className="btn-primary" disabled={submitting || supplierIds.length < 2}>
              {submitting ? 'Création…' : 'Créer les demandes de prix'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function RfqComparisonModal({ groupId, onClose, onAwarded }: { groupId: string; onClose: () => void; onAwarded: () => void }) {
  const { accessToken } = useAuth();
  const [candidates, setCandidates] = useState<PurchaseOrderView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [awarding, setAwarding] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  // candidateId -> lineId -> edited price string, kept separate from the
  // loaded candidates so an in-progress edit isn't clobbered by a stray
  // reload, and so "Enregistrer les prix" only sends the lines a buyer
  // actually touched for that supplier.
  const [edits, setEdits] = useState<Record<string, Record<string, string>>>({});

  const load = useCallback(async () => {
    if (!accessToken) return;
    try {
      setCandidates(await purchasingApi.getRfqGroup(accessToken, groupId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur de chargement.');
    }
  }, [accessToken, groupId]);

  useEffect(() => {
    load();
  }, [load]);

  function setEdit(candidateId: string, lineId: string, value: string) {
    setEdits((prev) => ({ ...prev, [candidateId]: { ...prev[candidateId], [lineId]: value } }));
  }

  async function handleSavePrices(candidateId: string) {
    if (!accessToken) return;
    const candidateEdits = edits[candidateId];
    if (!candidateEdits) return;
    const lines = Object.entries(candidateEdits)
      .filter(([, v]) => v !== '')
      .map(([lineId, v]) => ({ lineId, unitCost: Number(v) }));
    if (lines.length === 0) return;
    setSaving(candidateId);
    setError(null);
    try {
      await purchasingApi.updateRfqPrices(accessToken, candidateId, { lines });
      setEdits((prev) => {
        const next = { ...prev };
        delete next[candidateId];
        return next;
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Erreur lors de l'enregistrement des prix.");
    } finally {
      setSaving(null);
    }
  }

  async function handleAward(purchaseOrderId: string) {
    if (!accessToken) return;
    setAwarding(purchaseOrderId);
    setError(null);
    try {
      await purchasingApi.awardRfq(accessToken, groupId, purchaseOrderId);
      onAwarded();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Erreur lors de l'attribution.");
    } finally {
      setAwarding(null);
    }
  }

  const decided = candidates?.some((c) => c.status !== 'rfq') ?? false;
  const productIds = Array.from(new Set((candidates ?? []).flatMap((c) => c.lines.map((l) => l.productId))));

  return (
    <div className="modal-backdrop open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide">
        <div className="modal-header">
          <div className="modal-header-titles">
            <h3>Comparaison fournisseurs</h3>
            <p className="modal-sub">Choisissez le fournisseur gagnant — il obtient un numéro de bon de commande, les autres sont archivés.</p>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>
        {error && <div className="error-banner">{error}</div>}
        {candidates === null ? (
          <p className="sub">Chargement…</p>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Produit</th>
                  {candidates.map((c) => (
                    <th key={c.id}>
                      {c.supplier.name}
                      {c.status === 'confirmed' && (
                        <span className="pill success" style={{ marginLeft: 6 }}>
                          Retenu
                        </span>
                      )}
                      {c.status === 'rfq_rejected' && (
                        <span className="pill danger" style={{ marginLeft: 6 }}>
                          Rejeté
                        </span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {productIds.map((pid) => {
                  const label = candidates.flatMap((c) => c.lines).find((l) => l.productId === pid);
                  return (
                    <tr key={pid}>
                      <td>{label?.product ? `${label.product.sku} — ${label.product.name}` : pid}</td>
                      {candidates.map((c) => {
                        const line = c.lines.find((l) => l.productId === pid);
                        if (!line) return <td key={c.id}>—</td>;
                        if (c.status !== 'rfq') {
                          return <td key={c.id}>{line.unitCost.toFixed(2)} DZD</td>;
                        }
                        const editedValue = edits[c.id]?.[line.id] ?? '';
                        return (
                          <td key={c.id}>
                            <input
                              type="number"
                              min={0}
                              step="any"
                              value={editedValue !== '' ? editedValue : line.unitCost || ''}
                              placeholder="Prix"
                              onChange={(e) => setEdit(c.id, line.id, e.target.value)}
                              style={{ width: 90 }}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
                {!decided && (
                  <tr>
                    <td className="sub">Enregistrer</td>
                    {candidates.map((c) => (
                      <td key={c.id}>
                        <button
                          type="button"
                          className="btn-link"
                          disabled={saving !== null || !edits[c.id]}
                          onClick={() => handleSavePrices(c.id)}
                        >
                          {saving === c.id ? 'Enregistrement…' : 'Enregistrer les prix'}
                        </button>
                      </td>
                    ))}
                  </tr>
                )}
                <tr>
                  <td>
                    <strong>Total</strong>
                  </td>
                  {candidates.map((c) => (
                    <td key={c.id}>
                      <strong>{c.lines.reduce((s, l) => s + l.unitCost * l.quantityOrdered, 0).toFixed(2)} DZD</strong>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        )}
        <div className="modal-footer" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Fermer
          </button>
          {!decided && candidates && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {candidates.map((c) => (
                <button key={c.id} type="button" className="btn-primary" disabled={awarding !== null} onClick={() => handleAward(c.id)}>
                  {awarding === c.id ? 'Attribution…' : `Retenir ${c.supplier.name}`}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default PurchasingPage;
