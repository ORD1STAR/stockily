import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '../lib/AppShell';
import { useAuth } from '../lib/auth-context';
import { ApiError, Batch, NonConformity, Site, StockRow, qualityApi, sitesApi, stockApi } from '../lib/api';
import { toast } from '../lib/toast';
import '../lib/data-views.css';

const DAY_MS = 24 * 60 * 60 * 1000;

function daysRemaining(expiryDate: string | null): number | null {
  if (!expiryDate) return null;
  return Math.ceil((new Date(expiryDate).getTime() - Date.now()) / DAY_MS);
}

// A unified row for the table: either a real batch, or a product-direct
// check (no lot) surfaced via its non-conformity — matches
// docs/Wireframes.html's "sans lot" row (the Ceinture example) and the
// explicit user correction that quality checks aren't limited to
// lot-tracked products.
interface QualityRow {
  key: string;
  lotLabel: string;
  productId: string;
  productName: string;
  productSku: string;
  quantity: number | null;
  expiryDate: string | null;
  result: 'conforme' | 'non_conforme' | null;
  status: 'ok' | 'warning' | 'danger';
  statusLabel: string;
  openNonConformityId: string | null;
}

export function QualityPage() {
  const { accessToken } = useAuth();
  const [products, setProducts] = useState<StockRow[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [nonConformities, setNonConformities] = useState<NonConformity[]>([]);
  const [expiringSoon, setExpiringSoon] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCheckForm, setShowCheckForm] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const [productRows, batchRows, ncRows, alerts] = await Promise.all([
        stockApi.listProducts(accessToken, 'all'),
        qualityApi.listBatches(accessToken),
        qualityApi.listNonConformities(accessToken),
        qualityApi.listExpiryAlerts(accessToken),
      ]);
      setProducts(productRows);
      setBatches(batchRows);
      setNonConformities(ncRows);
      setExpiringSoon(alerts.length);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur de chargement.');
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    load();
  }, [load]);

  // Unique products (StockPage's list is per-site; one row per product here).
  const uniqueProducts = useMemo(() => Array.from(new Map(products.map((p) => [p.productId, p])).values()), [products]);
  const productById = useMemo(() => new Map(uniqueProducts.map((p) => [p.productId, p])), [uniqueProducts]);

  const rows: QualityRow[] = useMemo(() => {
    const batchRows: QualityRow[] = batches.map((b) => {
      const product = productById.get(b.productId);
      const days = daysRemaining(b.expiryDate);
      const isQuarantined = b.status === 'quarantined';
      const isNearExpiry = days != null && days <= 30 && days >= 0 && b.status === 'active';
      const openNc = nonConformities.find((n) => n.batchId === b.id && n.status === 'open');
      return {
        key: b.id,
        lotLabel: b.lotNumber,
        productId: b.productId,
        productName: product?.name ?? b.productId,
        productSku: product?.sku ?? '',
        quantity: b.remainingQuantity,
        expiryDate: b.expiryDate,
        result: b.latestCheck?.result ?? null,
        status: isQuarantined ? 'danger' : isNearExpiry ? 'warning' : 'ok',
        statusLabel: isQuarantined ? 'Quarantaine' : isNearExpiry ? 'Péremption proche' : 'OK',
        openNonConformityId: openNc?.id ?? null,
      };
    });

    // Product-direct (sans lot) opens — a non-conformity with no batchId.
    const directRows: QualityRow[] = nonConformities
      .filter((n) => n.batchId === null)
      .map((n) => {
        const product = productById.get(n.productId);
        return {
          key: n.id,
          lotLabel: '— (sans lot)',
          productId: n.productId,
          productName: product?.name ?? n.productId,
          productSku: product?.sku ?? '',
          quantity: null,
          expiryDate: null,
          result: 'non_conforme',
          status: n.status === 'open' ? 'danger' : 'ok',
          statusLabel: n.status === 'open' ? 'Quarantaine' : 'Résolue',
          openNonConformityId: n.status === 'open' ? n.id : null,
        };
      });

    return [...batchRows, ...directRows];
  }, [batches, nonConformities, productById]);

  const stats = {
    active: batches.filter((b) => b.status === 'active').length,
    nearExpiry: expiringSoon,
    openNonConformities: nonConformities.filter((n) => n.status === 'open').length,
  };

  return (
    <AppShell>
      <div className="panel-head">
        <div>
          <h2>Qualité</h2>
          <div className="sub">Lots, péremption et non-conformités — toutes activités confondues</div>
        </div>
        <button className="btn-primary" onClick={() => setShowCheckForm(true)}>
          + Contrôle qualité
        </button>
      </div>

      <div className="note-box">
        Les produits non suivis par lot (ex. ceinture, textile) n&#39;ont ni numéro de lot ni péremption, mais peuvent tout de même faire
        l&#39;objet d&#39;un contrôle qualité — par exemple un défaut constaté à la livraison. Ces contrôles apparaissent ci-dessous sans
        numéro de lot.
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="stat-strip">
        <div className="stat-card">
          <div className="num">{stats.active}</div>
          <div className="label">Lots actifs</div>
        </div>
        <div className="stat-card warn">
          <div className="num">{stats.nearExpiry}</div>
          <div className="label">Péremption &lt; 30 j</div>
        </div>
        <div className="stat-card bad">
          <div className="num">{stats.openNonConformities}</div>
          <div className="label">Non-conformités ouvertes</div>
        </div>
      </div>

      {loading ? (
        <p className="sub">Chargement…</p>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>N° de lot</th>
                <th>Produit</th>
                <th className="num">Qté</th>
                <th>Péremption</th>
                <th>Jours restants</th>
                <th>Contrôle qualité</th>
                <th>État</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const days = daysRemaining(r.expiryDate);
                return (
                  <tr key={r.key}>
                    <td className="mono">{r.lotLabel}</td>
                    <td>
                      <span className="has-tip" data-tip={`Référence : ${r.productSku}`}>
                        {r.productName}
                      </span>
                    </td>
                    <td className="num">{r.quantity ?? '—'}</td>
                    <td className="mono">{r.expiryDate ? new Date(r.expiryDate).toLocaleDateString('fr-FR') : 'N/A'}</td>
                    <td>{days == null ? '—' : days < 0 ? 'Expiré' : `${days} j`}</td>
                    <td className="muted">{r.result === 'non_conforme' ? 'Non conforme' : r.result === 'conforme' ? 'Conforme' : '—'}</td>
                    <td>
                      <span className={`pill ${r.status === 'ok' ? 'success' : r.status === 'warning' ? 'warning' : 'danger'}`}>
                        {r.statusLabel}
                      </span>
                    </td>
                    <td>
                      {r.openNonConformityId && (
                        <button className="btn-link" onClick={() => setResolvingId(r.openNonConformityId)}>
                          Résoudre
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="muted" style={{ textAlign: 'center', padding: '24px 0' }}>
                    Aucun lot ni contrôle qualité pour le moment.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {showCheckForm && (
        <QualityCheckModal
          products={uniqueProducts}
          onClose={() => setShowCheckForm(false)}
          onSaved={() => {
            setShowCheckForm(false);
            load();
          }}
        />
      )}
      {resolvingId && (
        <ResolveNonConformityModal
          nonConformityId={resolvingId}
          onClose={() => setResolvingId(null)}
          onSaved={() => {
            setResolvingId(null);
            load();
          }}
        />
      )}
    </AppShell>
  );
}

function ResolveNonConformityModal({
  nonConformityId,
  onClose,
  onSaved,
}: {
  nonConformityId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { accessToken } = useAuth();
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!accessToken) return;
    setSubmitting(true);
    setError(null);
    try {
      await qualityApi.resolveNonConformity(accessToken, nonConformityId, resolutionNotes || undefined);
      toast.success('Non-conformité résolue.');
      onSaved();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Échec de la résolution.';
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
            <h3>Résoudre la non-conformité</h3>
            <p className="modal-sub">
              Marque cette non-conformité comme résolue. La quantité concernée reste en quarantaine — la remise en stock ou le rebut se
              fait via un mouvement de stock séparé (le Retours/SAV du Phase 3 gérera ce flux plus finement).
            </p>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>
        <form onSubmit={handleSubmit} className="field-form">
          <div className="field-row">
            <label>Notes de résolution (optionnel)</label>
            <textarea rows={3} value={resolutionNotes} onChange={(e) => setResolutionNotes(e.target.value)} />
          </div>
          {error && <div className="error-banner">{error}</div>}
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Annuler
            </button>
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? 'Enregistrement…' : 'Marquer comme résolue'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function QualityCheckModal({ products, onClose, onSaved }: { products: StockRow[]; onClose: () => void; onSaved: () => void }) {
  const { accessToken } = useAuth();
  const [productId, setProductId] = useState(products[0]?.productId ?? '');
  const [sites, setSites] = useState<Site[]>([]);
  const [existingBatches, setExistingBatches] = useState<Batch[]>([]);
  const [lotMode, setLotMode] = useState<'existing' | 'new'>('existing');
  const [batchId, setBatchId] = useState('');
  const [lotNumber, setLotNumber] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [quantityReceived, setQuantityReceived] = useState(1);
  const [siteId, setSiteId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [result, setResult] = useState<'conforme' | 'non_conforme'>('conforme');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const product = products.find((p) => p.productId === productId);
  const isLotTracked = product?.isLotTracked ?? false;

  useEffect(() => {
    if (!accessToken) return;
    sitesApi.list(accessToken).then((list) => {
      setSites(list);
      setSiteId((prev) => prev || list[0]?.id || '');
    });
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken || !productId || !isLotTracked) {
      setExistingBatches([]);
      return;
    }
    qualityApi.listBatches(accessToken, productId).then((list) => {
      const active = list.filter((b) => b.status === 'active');
      setExistingBatches(active);
      setLotMode(active.length > 0 ? 'existing' : 'new');
      setBatchId(active[0]?.id ?? '');
    });
  }, [accessToken, productId, isLotTracked]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!accessToken) return;
    setSubmitting(true);
    setError(null);
    try {
      let finalBatchId: string | undefined;
      if (isLotTracked) {
        if (lotMode === 'new') {
          const created = await qualityApi.createBatch(accessToken, {
            productId,
            lotNumber,
            ...(expiryDate ? { expiryDate: new Date(expiryDate).toISOString() } : {}),
            quantityReceived,
          });
          finalBatchId = created.id;
        } else {
          finalBatchId = batchId;
        }
        await qualityApi.recordCheck(accessToken, { productId, batchId: finalBatchId, result, notes: notes || undefined });
      } else {
        await qualityApi.recordCheck(accessToken, { productId, siteId, quantity, result, notes: notes || undefined });
      }
      toast.success('Contrôle qualité enregistré.');
      onSaved();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Erreur lors de l’enregistrement du contrôle.';
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
            <h3>Nouveau contrôle qualité</h3>
            <p className="modal-sub">
              Enregistre une inspection — à réception ou en cours de stockage. Un résultat &#34;Non conforme&#34; met automatiquement la
              quantité concernée en quarantaine.
            </p>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>
        <form onSubmit={handleSubmit} className="field-form">
          <div className="field-row">
            <label>Produit</label>
            <select value={productId} onChange={(e) => setProductId(e.target.value)} required>
              {products.map((p) => (
                <option key={p.productId} value={p.productId}>
                  {p.sku} — {p.name} {p.isLotTracked ? '' : '(non suivi par lot)'}
                </option>
              ))}
            </select>
          </div>

          {isLotTracked ? (
            <>
              <div className="field-row">
                <label>Lot</label>
                <div className="toggle-row">
                  <button type="button" className={`toggle-btn ${lotMode === 'existing' ? 'on' : ''}`} onClick={() => setLotMode('existing')}>
                    Lot existant
                  </button>
                  <button type="button" className={`toggle-btn ${lotMode === 'new' ? 'on' : ''}`} onClick={() => setLotMode('new')}>
                    + Nouveau lot (réception)
                  </button>
                </div>
              </div>
              {lotMode === 'existing' ? (
                <div className="field-row">
                  <label>Lot existant</label>
                  <select value={batchId} onChange={(e) => setBatchId(e.target.value)} required>
                    {existingBatches.length === 0 && <option value="">Aucun lot actif — utilisez &#34;Nouveau lot&#34;</option>}
                    {existingBatches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.lotNumber} {b.expiryDate ? `— expire ${new Date(b.expiryDate).toLocaleDateString('fr-FR')}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <>
                  <div className="field-row">
                    <label>N° de lot</label>
                    <input value={lotNumber} onChange={(e) => setLotNumber(e.target.value)} required />
                  </div>
                  <div className="field-row">
                    <label>Date de péremption (optionnel)</label>
                    <input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
                  </div>
                  <div className="field-row">
                    <label>Quantité reçue</label>
                    <input
                      type="number"
                      min={0.001}
                      step="any"
                      value={quantityReceived}
                      onChange={(e) => setQuantityReceived(Number(e.target.value))}
                      required
                    />
                  </div>
                </>
              )}
            </>
          ) : (
            <>
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
                <label>Quantité contrôlée</label>
                <input type="number" min={0.001} step="any" value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} required />
              </div>
            </>
          )}

          <div className="field-row">
            <label>Résultat</label>
            <div className="toggle-row">
              <button type="button" className={`toggle-btn ${result === 'conforme' ? 'on' : ''}`} onClick={() => setResult('conforme')}>
                Conforme
              </button>
              <button type="button" className={`toggle-btn ${result === 'non_conforme' ? 'on' : ''}`} onClick={() => setResult('non_conforme')}>
                Non conforme
              </button>
            </div>
          </div>
          <div className="field-row">
            <label>Notes</label>
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Observations, motif si non conforme…" />
          </div>

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

export default QualityPage;
