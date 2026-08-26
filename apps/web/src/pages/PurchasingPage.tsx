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
};

function statusPillClass(status: PurchaseOrderView['status']): string {
  if (status === 'received') return 'success';
  if (status === 'partially_received') return 'warning';
  if (status === 'cancelled') return 'danger';
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
  const [selectedOrder, setSelectedOrder] = useState<PurchaseOrderView | null>(null);
  const [showReceiveFor, setShowReceiveFor] = useState<PurchaseOrderView | null>(null);

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const [orderList, siteList, partnerList, productRows] = await Promise.all([
        purchasingApi.listOrders(accessToken),
        sitesApi.list(accessToken),
        invoicingApi.listPartners(accessToken),
        stockApi.listProducts(accessToken, 'all'),
      ]);
      setOrders(orderList);
      setSites(siteList);
      setPartners(partnerList);
      setProducts(productRows);
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
                <tr key={o.id} onClick={() => setSelectedOrder(o)} style={{ cursor: 'pointer' }}>
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
  const canReceive = order.status === 'confirmed' || order.status === 'partially_received';
  const canCancel = canReceive && order.lines.every((l) => l.quantityReceived === 0);

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
          {canReceive && (
            <button type="button" className="btn-primary" onClick={onReceive}>
              Réceptionner
            </button>
          )}
        </div>
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

export default PurchasingPage;
