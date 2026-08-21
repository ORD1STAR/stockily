import { FormEvent, useCallback, useEffect, useState } from 'react';
import { AppShell } from '../lib/AppShell';
import { useAuth } from '../lib/auth-context';
import { ApiError, Batch, ProductDetail, Site, StockRow, qualityApi, sitesApi, stockApi } from '../lib/api';
import { useStockRealtime } from '../lib/realtime';
import '../lib/data-views.css';

const STATUS_LABEL: Record<StockRow['status'], string> = { ok: 'OK', low: 'Bas', out: 'Rupture' };

export function StockPage() {
  const { accessToken } = useAuth();
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState('all');
  const [rows, setRows] = useState<StockRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<ProductDetail | null>(null);
  const [showMovementForm, setShowMovementForm] = useState(false);

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const [siteList, productRows] = await Promise.all([sitesApi.list(accessToken), stockApi.listProducts(accessToken, siteId)]);
      setSites(siteList);
      setRows(productRows);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur de chargement.');
    } finally {
      setLoading(false);
    }
  }, [accessToken, siteId]);

  useEffect(() => {
    load();
  }, [load]);

  // Real-time: a movement posted elsewhere (another tab, another user)
  // refreshes this view — proves the Milestone 2 websocket seam works from
  // the browser, not just the server-side smoke test.
  useStockRealtime(accessToken, siteId === 'all' ? null : siteId, () => load());

  const stats = {
    total: new Set(rows.map((r) => r.productId)).size,
    low: rows.filter((r) => r.status === 'low').length,
    out: rows.filter((r) => r.status === 'out').length,
    quarantined: rows.filter((r) => r.quantityQuarantined > 0).length,
  };

  async function openDetail(productId: string) {
    if (!accessToken) return;
    const d = await stockApi.getProduct(accessToken, productId);
    setDetail(d);
  }

  return (
    <AppShell>
      <div className="panel-head">
        <div>
          <h2>Gestion de Stock</h2>
          <div className="sub">
            Site :{' '}
            <select className="site-select" value={siteId} onChange={(e) => setSiteId(e.target.value)}>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
              <option value="all">Tous les sites</option>
            </select>
          </div>
        </div>
        <button className="btn-primary" onClick={() => setShowMovementForm(true)}>
          + Nouveau mouvement
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="stat-strip">
        <div className="stat-card">
          <div className="num">{stats.total}</div>
          <div className="label">SKUs affichés</div>
        </div>
        <div className="stat-card warn">
          <div className="num">{stats.low}</div>
          <div className="label">Alertes seuil bas</div>
        </div>
        <div className="stat-card bad">
          <div className="num">{stats.out}</div>
          <div className="label">En rupture</div>
        </div>
        <div className="stat-card bad">
          <div className="num">{stats.quarantined}</div>
          <div className="label">Lignes avec quarantaine</div>
        </div>
      </div>

      {loading ? (
        <p className="sub">Chargement…</p>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Produit</th>
                <th>Catégorie</th>
                {siteId === 'all' && <th>Site</th>}
                <th className="num">Qté dispo.</th>
                <th className="num">Quarantaine</th>
                <th className="num">Seuil min</th>
                <th className="num">Coût moyen</th>
                <th>État</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.productId}-${r.site.id}`} className="clickable" onClick={() => openDetail(r.productId)}>
                  <td className="mono">{r.sku}</td>
                  <td>{r.name}</td>
                  <td className="muted">{r.category ?? '—'}</td>
                  {siteId === 'all' && <td className="muted">{r.site.name}</td>}
                  <td className="num">{r.quantityOnHand}</td>
                  <td className="num" style={r.quantityQuarantined > 0 ? { color: 'var(--danger)' } : undefined}>
                    {r.quantityQuarantined}
                  </td>
                  <td className="num muted">{r.minThreshold ?? '—'}</td>
                  <td className="num">{r.averageCost.toFixed(2)}</td>
                  <td>
                    <span className={`pill ${r.status === 'ok' ? 'success' : r.status === 'low' ? 'warning' : 'danger'}`}>
                      {STATUS_LABEL[r.status]}
                    </span>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="muted" style={{ textAlign: 'center', padding: '24px 0' }}>
                    Aucun produit pour ce site.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {detail && <SkuDetailModal detail={detail} onClose={() => setDetail(null)} />}
      {showMovementForm && (
        <MovementFormModal
          sites={sites}
          rows={rows}
          onClose={() => setShowMovementForm(false)}
          onSaved={() => {
            setShowMovementForm(false);
            load();
          }}
        />
      )}
    </AppShell>
  );
}

function SkuDetailModal({ detail, onClose }: { detail: ProductDetail; onClose: () => void }) {
  const { accessToken } = useAuth();
  const [batches, setBatches] = useState<Batch[] | null>(null);

  useEffect(() => {
    if (!accessToken || !detail.isLotTracked) return;
    qualityApi.listBatches(accessToken, detail.id).then(setBatches);
  }, [accessToken, detail.id, detail.isLotTracked]);

  return (
    <div className="modal-backdrop open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide">
        <button className="modal-close" onClick={onClose}>
          ✕
        </button>
        <h3>{detail.name}</h3>
        <p className="modal-sub">
          SKU {detail.sku} · {detail.isLotTracked ? 'suivi par lot' : 'non suivi par lot'}
        </p>
        <div className="stat-strip">
          <div className="stat-card">
            <div className="num">{detail.averageCost.toFixed(2)}</div>
            <div className="label">Coût moyen (DZD)</div>
          </div>
          <div className="stat-card">
            <div className="num">{detail.minThreshold ?? '—'}</div>
            <div className="label">Seuil min</div>
          </div>
        </div>
        <div className="modal-section">
          <div className="modal-section-label">Stock par site</div>
          <table className="lot-mini-table">
            <thead>
              <tr>
                <th>Site</th>
                <th>Qté</th>
                <th>Quarantaine</th>
              </tr>
            </thead>
            <tbody>
              {detail.levels.map((l) => (
                <tr key={l.site.id}>
                  <td>{l.site.name}</td>
                  <td className="mono">{l.quantityOnHand}</td>
                  <td className="mono">{l.quantityQuarantined}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="modal-section">
          <div className="modal-section-label">Qualité</div>
          {!detail.isLotTracked ? (
            <div className="note-box">
              Ce produit n&#39;est pas suivi par lot (article non périssable) — la péremption ne s&#39;applique pas. Un contrôle qualité
              ponctuel reste possible depuis le module Qualité.
            </div>
          ) : batches === null ? (
            <p className="sub">Chargement…</p>
          ) : batches.length === 0 ? (
            <div className="note-box">Aucun lot actif pour ce produit pour le moment.</div>
          ) : (
            <table className="lot-mini-table">
              <thead>
                <tr>
                  <th>N° de lot</th>
                  <th>Qté</th>
                  <th>Péremption</th>
                  <th>État</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.id}>
                    <td className="mono">{b.lotNumber}</td>
                    <td>{b.quantityReceived}</td>
                    <td className="mono">{b.expiryDate ? new Date(b.expiryDate).toLocaleDateString('fr-FR') : '—'}</td>
                    <td>
                      <span className={`pill ${b.status === 'quarantined' ? 'danger' : b.status === 'depleted' ? 'info' : 'success'}`}>
                        {b.status === 'quarantined' ? 'Quarantaine' : b.status === 'depleted' ? 'Épuisé' : 'OK'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function MovementFormModal({
  sites,
  rows,
  onClose,
  onSaved,
}: {
  sites: Site[];
  rows: StockRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { accessToken } = useAuth();
  const uniqueProducts = Array.from(new Map(rows.map((r) => [r.productId, r])).values());
  const [productId, setProductId] = useState(uniqueProducts[0]?.productId ?? '');
  const [movementSiteId, setMovementSiteId] = useState(sites[0]?.id ?? '');
  const [type, setType] = useState<'IN' | 'OUT' | 'TRANSFER' | 'ADJUSTMENT'>('IN');
  const [quantity, setQuantity] = useState(1);
  const [unitCost, setUnitCost] = useState<number | ''>('');
  const [toSiteId, setToSiteId] = useState(sites[1]?.id ?? sites[0]?.id ?? '');
  const [adjustmentDirection, setAdjustmentDirection] = useState<'increase' | 'decrease'>('increase');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!accessToken) return;
    setSubmitting(true);
    setError(null);
    try {
      await stockApi.recordMovement(accessToken, {
        productId,
        siteId: movementSiteId,
        type,
        quantity,
        ...(type === 'IN' && unitCost !== '' ? { unitCost: Number(unitCost) } : {}),
        ...(type === 'TRANSFER' ? { toSiteId } : {}),
        ...(type === 'ADJUSTMENT' ? { adjustmentDirection } : {}),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur lors de l’enregistrement du mouvement.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <button className="modal-close" onClick={onClose}>
          ✕
        </button>
        <h3>Nouveau mouvement</h3>
        <form onSubmit={handleSubmit} className="field-form">
          <div className="field-row">
            <label>Produit</label>
            <select value={productId} onChange={(e) => setProductId(e.target.value)} required>
              {uniqueProducts.map((p) => (
                <option key={p.productId} value={p.productId}>
                  {p.sku} — {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field-row">
            <label>Site</label>
            <select value={movementSiteId} onChange={(e) => setMovementSiteId(e.target.value)} required>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field-row">
            <label>Type</label>
            <select value={type} onChange={(e) => setType(e.target.value as typeof type)}>
              <option value="IN">Entrée</option>
              <option value="OUT">Sortie</option>
              <option value="TRANSFER">Transfert</option>
              <option value="ADJUSTMENT">Ajustement d&#39;inventaire</option>
            </select>
          </div>
          {type === 'TRANSFER' && (
            <div className="field-row">
              <label>Site de destination</label>
              <select value={toSiteId} onChange={(e) => setToSiteId(e.target.value)} required>
                {sites
                  .filter((s) => s.id !== movementSiteId)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </div>
          )}
          {type === 'ADJUSTMENT' && (
            <div className="field-row">
              <label>Sens</label>
              <div className="toggle-row">
                <button
                  type="button"
                  className={`toggle-btn ${adjustmentDirection === 'increase' ? 'on' : ''}`}
                  onClick={() => setAdjustmentDirection('increase')}
                >
                  Augmenter
                </button>
                <button
                  type="button"
                  className={`toggle-btn ${adjustmentDirection === 'decrease' ? 'on' : ''}`}
                  onClick={() => setAdjustmentDirection('decrease')}
                >
                  Diminuer
                </button>
              </div>
            </div>
          )}
          <div className="field-row">
            <label>Quantité</label>
            <input type="number" min={0.001} step="any" value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} required />
          </div>
          {type === 'IN' && (
            <div className="field-row">
              <label>Coût unitaire (optionnel)</label>
              <input type="number" min={0} step="any" value={unitCost} onChange={(e) => setUnitCost(e.target.value === '' ? '' : Number(e.target.value))} />
            </div>
          )}
          {error && <div className="error-banner">{error}</div>}
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Annuler
            </button>
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default StockPage;
