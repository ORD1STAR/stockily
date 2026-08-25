import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader, IScannerControls } from '@zxing/browser';
import { AppShell } from '../lib/AppShell';
import { useAuth } from '../lib/auth-context';
import { ApiError, Batch, Partner, ProductCategory, ProductDetail, Site, StockRow, invoicingApi, qualityApi, sitesApi, stockApi } from '../lib/api';
import { CAMERA_CONSTRAINTS, createBarcodeReader } from '../lib/barcodeScanner';
import { useStockRealtime } from '../lib/realtime';
import { SearchableSelect } from '../lib/SearchableSelect';
import '../lib/data-views.css';

const STATUS_LABEL: Record<StockRow['status'], string> = { ok: 'OK', low: 'Bas', out: 'Rupture' };

// Persisted across navigation — leaving Stock for another module and coming
// back used to silently reset the site filter to "Tous les sites" (useState
// re-initializes on every mount, there's nothing else backing it), which is
// disruptive on a real multi-site org where you're usually working one
// warehouse at a time. Found by actually switching pages and back.
const SITE_FILTER_STORAGE_KEY = 'stockily.stock.siteFilter';

export function StockPage() {
  const { accessToken } = useAuth();
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState(() => localStorage.getItem(SITE_FILTER_STORAGE_KEY) ?? 'all');
  const [rows, setRows] = useState<StockRow[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<ProductDetail | null>(null);
  const [showMovementForm, setShowMovementForm] = useState(false);
  const [showProductForm, setShowProductForm] = useState(false);
  const [categories, setCategories] = useState<ProductCategory[]>([]);

  function changeSite(next: string) {
    setSiteId(next);
    localStorage.setItem(SITE_FILTER_STORAGE_KEY, next);
  }

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const [siteList, productRows, categoryList] = await Promise.all([
        sitesApi.list(accessToken),
        stockApi.listProducts(accessToken, siteId),
        stockApi.listCategories(accessToken),
      ]);
      setSites(siteList);
      setRows(productRows);
      setCategories(categoryList);
      // Partners come from the Invoicing module — if it isn't entitled for
      // this org, this simply fails silently and the movement form's
      // fournisseur/client picker stays empty (falls back to "non
      // spécifié"), rather than blocking the whole Stock page from loading.
      try {
        setPartners(await invoicingApi.listPartners(accessToken));
      } catch {
        setPartners([]);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur de chargement.');
    } finally {
      setLoading(false);
    }
  }, [accessToken, siteId]);

  useEffect(() => {
    load();
  }, [load]);

  // A site id persisted from a previous session that no longer exists
  // (deleted site, different org) falls back to "Tous les sites" instead of
  // silently filtering on a dangling id.
  useEffect(() => {
    if (sites.length > 0 && siteId !== 'all' && !sites.some((s) => s.id === siteId)) changeSite('all');
  }, [sites, siteId]);

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
            <select className="site-select" value={siteId} onChange={(e) => changeSite(e.target.value)}>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
              <option value="all">Tous les sites</option>
            </select>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn-secondary" onClick={() => setShowProductForm(true)}>
            + Nouveau produit
          </button>
          <button className="btn-primary" onClick={() => setShowMovementForm(true)} disabled={rows.length === 0}>
            + Nouveau mouvement
          </button>
        </div>
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
      {showProductForm && (
        <ProductFormModal
          categories={categories}
          onClose={() => setShowProductForm(false)}
          onSaved={() => {
            setShowProductForm(false);
            load();
          }}
        />
      )}
      {showMovementForm && (
        <MovementFormModal
          sites={sites}
          rows={rows}
          partners={partners}
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

function SkuDetailModal({ detail: initialDetail, onClose }: { detail: ProductDetail; onClose: () => void }) {
  const { accessToken } = useAuth();
  const [detail, setDetail] = useState(initialDetail);
  const [batches, setBatches] = useState<Batch[] | null>(null);
  // Editable here rather than only at creation — most products in this
  // simulation were created before a sale price meant anything (Scan's
  // "Vente rapide" needs one to auto-fill a line), so there was no way to
  // go back and set one on an existing SKU.
  const [sellPriceInput, setSellPriceInput] = useState(detail.sellPrice != null ? String(detail.sellPrice) : '');
  const [savingPrice, setSavingPrice] = useState(false);
  const [priceSaved, setPriceSaved] = useState(false);
  const [priceError, setPriceError] = useState<string | null>(null);
  // Same after-the-fact editability rationale as sellPrice above — most
  // products in a real catalog get their manufacturer barcode added once
  // someone's actually holding the box, not at initial product creation.
  const [barcodeInput, setBarcodeInput] = useState(detail.barcode ?? '');
  const [savingBarcode, setSavingBarcode] = useState(false);
  const [barcodeSaved, setBarcodeSaved] = useState(false);
  const [barcodeError, setBarcodeError] = useState<string | null>(null);
  const [savingLotTracked, setSavingLotTracked] = useState(false);
  const [lotTrackedError, setLotTrackedError] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken || !detail.isLotTracked) return;
    qualityApi.listBatches(accessToken, detail.id).then(setBatches);
  }, [accessToken, detail.id, detail.isLotTracked]);

  // Was structurally uneditable ("cascading implications once batches
  // exist" per the old UpdateProductDto comment) — but nothing actually
  // reads this flag to gate domain logic, only what the UI chooses to show
  // (see StockService.updateProduct's own comment). The real case this
  // exists for: a product created with the "Suivi par lot" toggle left
  // off by mistake, with no way to turn it back on afterward. Saves
  // immediately on tap (no separate "Enregistrer" step) — it's a binary
  // flag, not free text worth a confirm step.
  async function saveLotTracked(next: boolean) {
    if (!accessToken || next === detail.isLotTracked) return;
    setSavingLotTracked(true);
    setLotTrackedError(null);
    try {
      const updated = await stockApi.updateProduct(accessToken, detail.id, { isLotTracked: next });
      setDetail((d) => ({ ...d, isLotTracked: updated.isLotTracked }));
    } catch (err) {
      setLotTrackedError(err instanceof ApiError ? err.message : 'Échec de la mise à jour.');
    } finally {
      setSavingLotTracked(false);
    }
  }

  async function saveSellPrice() {
    if (!accessToken) return;
    setSavingPrice(true);
    setPriceSaved(false);
    setPriceError(null);
    try {
      const updated = await stockApi.updateProduct(accessToken, detail.id, {
        sellPrice: sellPriceInput === '' ? undefined : Number(sellPriceInput),
      });
      setDetail((d) => ({ ...d, sellPrice: updated.sellPrice }));
      setPriceSaved(true);
    } catch (err) {
      setPriceError(err instanceof ApiError ? err.message : 'Échec de l’enregistrement.');
    } finally {
      setSavingPrice(false);
    }
  }

  async function saveBarcode() {
    if (!accessToken) return;
    setSavingBarcode(true);
    setBarcodeSaved(false);
    setBarcodeError(null);
    try {
      // Always send the (possibly empty) trimmed value, never `undefined` —
      // this is a dedicated "save this field" button, and `undefined` would
      // vanish from the JSON body entirely (JSON.stringify drops it),
      // which the API reads as "leave barcode unchanged" rather than
      // "clear it" when the field was emptied on purpose.
      const updated = await stockApi.updateProduct(accessToken, detail.id, { barcode: barcodeInput.trim() });
      setDetail((d) => ({ ...d, barcode: updated.barcode }));
      setBarcodeSaved(true);
    } catch (err) {
      setBarcodeError(err instanceof ApiError ? err.message : 'Échec de l’enregistrement.');
    } finally {
      setSavingBarcode(false);
    }
  }

  return (
    <div className="modal-backdrop open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide">
        <div className="modal-header">
          <div className="modal-header-titles">
            <h3>{detail.name}</h3>
            <p className="modal-sub">
              SKU {detail.sku} · {detail.isLotTracked ? 'suivi par lot' : 'non suivi par lot'}
            </p>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>
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
          <div className="modal-section-label">Suivi par lot</div>
          <div className="toggle-row">
            <button
              type="button"
              className={`toggle-btn${detail.isLotTracked ? ' on' : ''}`}
              onClick={() => saveLotTracked(true)}
              disabled={savingLotTracked}
            >
              Oui
            </button>
            <button
              type="button"
              className={`toggle-btn${!detail.isLotTracked ? ' on' : ''}`}
              onClick={() => saveLotTracked(false)}
              disabled={savingLotTracked}
            >
              Non
            </button>
          </div>
          {lotTrackedError && <div className="error-banner">{lotTrackedError}</div>}
          <p className="sub">Active la péremption et le contrôle qualité par lot — Scan » Entrée proposera alors un numéro de lot.</p>
        </div>
        <div className="modal-section">
          <div className="modal-section-label">Prix de vente</div>
          <div className="inline-edit-row">
            <input
              type="number"
              min={0}
              step="any"
              value={sellPriceInput}
              onChange={(e) => setSellPriceInput(e.target.value)}
              placeholder="Non défini"
            />
            <button type="button" className="btn-secondary" onClick={saveSellPrice} disabled={savingPrice}>
              {savingPrice ? 'Enregistrement…' : 'Enregistrer'}
            </button>
            {priceSaved && <span className="sub">Enregistré.</span>}
          </div>
          {priceError && <div className="error-banner">{priceError}</div>}
          <p className="sub">Utilisé pour pré-remplir le prix d&#39;une ligne dans Scan &raquo; Vente rapide.</p>
        </div>
        <div className="modal-section">
          <div className="modal-section-label">Code-barres</div>
          <div className="inline-edit-row">
            <input className="mono" value={barcodeInput} onChange={(e) => setBarcodeInput(e.target.value)} placeholder="Non défini" />
            <BarcodeScanButton onScanned={setBarcodeInput} />
            <button type="button" className="btn-secondary" onClick={saveBarcode} disabled={savingBarcode}>
              {savingBarcode ? 'Enregistrement…' : 'Enregistrer'}
            </button>
            {barcodeSaved && <span className="sub">Enregistré.</span>}
          </div>
          {barcodeError && <div className="error-banner">{barcodeError}</div>}
          <p className="sub">
            Le code EAN/UPC imprimé sur le produit lui-même — une fois enregistré, Scan le reconnaît directement, sans passer par une
            étiquette générée.
          </p>
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
                    <td>{b.remainingQuantity}</td>
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

function ProductFormModal({
  categories,
  onClose,
  onSaved,
}: {
  categories: ProductCategory[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { accessToken } = useAuth();
  const [sku, setSku] = useState('');
  const [name, setName] = useState('');
  const [barcode, setBarcode] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [newCategoryName, setNewCategoryName] = useState('');
  const [isLotTracked, setIsLotTracked] = useState(false);
  const [minThreshold, setMinThreshold] = useState<number | ''>('');
  const [maxThreshold, setMaxThreshold] = useState<number | ''>('');
  const [sellPrice, setSellPrice] = useState<number | ''>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!accessToken) return;
    setSubmitting(true);
    setError(null);
    try {
      let finalCategoryId = categoryId || undefined;
      if (newCategoryName.trim()) {
        const created = await stockApi.createCategory(accessToken, { name: newCategoryName.trim() });
        finalCategoryId = created.id;
      }
      await stockApi.createProduct(accessToken, {
        sku,
        name,
        categoryId: finalCategoryId,
        isLotTracked,
        ...(minThreshold !== '' ? { minThreshold: Number(minThreshold) } : {}),
        ...(maxThreshold !== '' ? { maxThreshold: Number(maxThreshold) } : {}),
        ...(sellPrice !== '' ? { sellPrice: Number(sellPrice) } : {}),
        ...(barcode.trim() !== '' ? { barcode: barcode.trim() } : {}),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur lors de la création du produit.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <div className="modal-header-titles">
            <h3>Nouveau produit</h3>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>
        <form onSubmit={handleSubmit} className="field-form">
          <div className="field-row">
            <label>SKU</label>
            <input className="mono" value={sku} onChange={(e) => setSku(e.target.value)} required />
          </div>
          <div className="field-row">
            <label>Nom</label>
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="field-row">
            <label>Code-barres (EAN/UPC, optionnel)</label>
            <div className="inline-edit-row" style={{ marginBottom: 0 }}>
              <input className="mono" value={barcode} onChange={(e) => setBarcode(e.target.value)} placeholder="Scanner ou saisir le code" />
              <BarcodeScanButton onScanned={setBarcode} />
            </div>
          </div>
          <div className="field-row">
            <label>Catégorie existante</label>
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} disabled={!!newCategoryName.trim()}>
              <option value="">— aucune —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field-row">
            <label>Ou nouvelle catégorie</label>
            <input value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} placeholder="Laisser vide si non applicable" />
          </div>
          <div className="field-row">
            <label>Suivi par lot (péremption, contrôle qualité)</label>
            <div className="toggle-row">
              <button type="button" className={`toggle-btn ${isLotTracked ? 'on' : ''}`} onClick={() => setIsLotTracked(true)}>
                Oui
              </button>
              <button type="button" className={`toggle-btn ${!isLotTracked ? 'on' : ''}`} onClick={() => setIsLotTracked(false)}>
                Non
              </button>
            </div>
          </div>
          <div className="field-grid">
            <div className="field-row">
              <label>Seuil min (optionnel)</label>
              <input type="number" min={0} step="any" value={minThreshold} onChange={(e) => setMinThreshold(e.target.value === '' ? '' : Number(e.target.value))} />
            </div>
            <div className="field-row">
              <label>Seuil max (optionnel)</label>
              <input type="number" min={0} step="any" value={maxThreshold} onChange={(e) => setMaxThreshold(e.target.value === '' ? '' : Number(e.target.value))} />
            </div>
          </div>
          <div className="field-row">
            <label>Prix de vente (optionnel)</label>
            <input type="number" min={0} step="any" value={sellPrice} onChange={(e) => setSellPrice(e.target.value === '' ? '' : Number(e.target.value))} />
          </div>
          {error && <div className="error-banner">{error}</div>}
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Annuler
            </button>
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? 'Création…' : 'Créer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function MovementFormModal({
  sites,
  rows,
  partners,
  onClose,
  onSaved,
}: {
  sites: Site[];
  rows: StockRow[];
  partners: Partner[];
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
  const [partnerId, setPartnerId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fournisseur on an entrée, client on a sortie — a transfert/ajustement
  // moves stock between the org's own sites or corrects a count, neither has
  // a counterparty. "Non spécifié" (partnerId left blank) stays the default
  // either way — most receipts/sales in practice (a walk-in buyer, a lot
  // received before the supplier record exists) genuinely have none.
  const suppliers = partners.filter((p) => p.isSupplier);
  const customers = partners.filter((p) => p.isCustomer);
  useEffect(() => {
    setPartnerId('');
  }, [type]);

  // OUT/TRANSFER/a decreasing ADJUSTMENT can never take a site below what it
  // actually has — quantityOnHand already excludes quarantined stock, so
  // it's directly the sellable/available amount the server's own
  // NegativeStockError check compares against. Clamping here just surfaces
  // that limit before submit instead of after a round trip.
  const requiresCap = type === 'OUT' || type === 'TRANSFER' || (type === 'ADJUSTMENT' && adjustmentDirection === 'decrease');
  const availableAtSite = rows.find((r) => r.productId === productId && r.site.id === movementSiteId)?.quantityOnHand ?? 0;

  useEffect(() => {
    if (requiresCap && quantity > availableAtSite) setQuantity(availableAtSite > 0 ? availableAtSite : 0);
  }, [requiresCap, availableAtSite, quantity]);

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
        ...((type === 'IN' || type === 'OUT') && partnerId ? { partnerId } : {}),
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
        <div className="modal-header">
          <div className="modal-header-titles">
            <h3>Nouveau mouvement</h3>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>
        <form onSubmit={handleSubmit} className="field-form">
          <div className="field-row">
            <label>Produit</label>
            <SearchableSelect
              value={productId}
              onChange={setProductId}
              placeholder="Rechercher un produit…"
              options={uniqueProducts.map((p) => ({ value: p.productId, label: p.name, sublabel: p.sku }))}
            />
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
          {type === 'IN' && (
            <div className="field-row">
              <label>Fournisseur (optionnel)</label>
              <SearchableSelect
                value={partnerId}
                onChange={setPartnerId}
                placeholder="Rechercher un fournisseur…"
                emptyLabel="— non spécifié —"
                options={suppliers.map((p) => ({ value: p.id, label: p.name, sublabel: p.nif }))}
              />
            </div>
          )}
          {type === 'OUT' && (
            <div className="field-row">
              <label>Client (optionnel)</label>
              <SearchableSelect
                value={partnerId}
                onChange={setPartnerId}
                placeholder="Rechercher un client…"
                emptyLabel="— non spécifié —"
                options={customers.map((p) => ({ value: p.id, label: p.name, sublabel: p.nif }))}
              />
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
            <label>Quantité{requiresCap ? ` (disponible : ${availableAtSite})` : ''}</label>
            <input
              type="number"
              min={0.001}
              max={requiresCap ? availableAtSite : undefined}
              step="any"
              value={quantity}
              onChange={(e) => {
                const next = Number(e.target.value);
                setQuantity(requiresCap ? Math.min(next, availableAtSite) : next);
              }}
              required
            />
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

// A one-shot camera capture for the barcode field on both the product
// creation and edit forms — reuses the same ZXing setup as Scan's own
// "Scanner" mode (single decode → stop, not Vente rapide's continuous
// scanning) so a manager registering a product's real-world barcode can
// point the camera at the box instead of typing a 13-digit number by hand.
// Renders its own nested modal — deliberately a fresh `.modal-backdrop`
// rather than reusing whatever modal this button lives inside, since it
// needs to sit visually above that modal too.
function BarcodeScanButton({ onScanned }: { onScanned: (code: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  // `open` (the modal is on screen) and `scanning` (the camera stream is
  // actually running) are deliberately separate — a getUserMedia failure
  // used to collapse both into one flag, which closed the whole modal the
  // instant it failed, taking the error message down with it before anyone
  // could read it. Now a failure just clears `scanning`; `open` stays true
  // so the error banner has somewhere to render until the user closes it.
  const [open, setOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const codeReaderRef = useRef<BrowserMultiFormatReader | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);

  const stopCamera = useCallback(() => {
    controlsRef.current?.stop();
    controlsRef.current = null;
    setScanning(false);
  }, []);

  const close = useCallback(() => {
    stopCamera();
    setOpen(false);
  }, [stopCamera]);

  useEffect(() => stopCamera, [stopCamera]);

  const startCameraStream = useCallback(async () => {
    setError(null);
    setScanning(true);
    try {
      if (!codeReaderRef.current) {
        codeReaderRef.current = createBarcodeReader();
      }
      const controls = await codeReaderRef.current.decodeFromConstraints(
        CAMERA_CONSTRAINTS,
        videoRef.current ?? undefined,
        (result) => {
          if (!result) return;
          close();
          onScanned(result.getText());
        },
      );
      controlsRef.current = controls;
    } catch {
      setScanning(false);
      setError("Impossible d'accéder à la caméra — saisissez le code manuellement.");
    }
  }, [close]);

  // Opening the modal (setOpen) and starting the camera used to happen in
  // the same click handler, synchronously — but the <video> element below
  // only exists once `open` is true AND React has actually re-rendered,
  // which hasn't happened yet inside that same function call. videoRef.current
  // was reliably still null on every first activation, so the stream (when
  // it didn't outright fail) was never attached to anything visible — "the
  // camera doesn't work." Splitting it like this lets this effect run
  // *after* the DOM has the <video> mounted (effects always run
  // post-commit), so videoRef.current is populated by the time the camera
  // actually starts.
  useEffect(() => {
    if (open) void startCameraStream();
  }, [open, startCameraStream]);

  return (
    <>
      <button type="button" className="btn-secondary" onClick={() => setOpen(true)}>
        📷 Scanner
      </button>
      {open && (
        <div className="modal-backdrop open barcode-scan-backdrop" onClick={(e) => e.target === e.currentTarget && close()}>
          <div className="modal">
            <div className="modal-header">
              <div className="modal-header-titles">
                <h3>Scanner le code-barres</h3>
              </div>
              <button type="button" className="modal-close-btn" onClick={close} aria-label="Fermer">
                ✕
              </button>
            </div>
            <div className="viewfinder">
              <video ref={videoRef} muted playsInline style={{ width: '100%', display: scanning ? 'block' : 'none' }} />
              {!scanning && !error && <div className="vf-placeholder">Ouverture de la caméra…</div>}
            </div>
            {error && (
              <>
                <div className="error-banner">{error}</div>
                <button type="button" className="btn-secondary" onClick={startCameraStream}>
                  Réessayer
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export default StockPage;
