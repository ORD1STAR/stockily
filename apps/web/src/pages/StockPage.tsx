import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader, IScannerControls } from '@zxing/browser';
import { AppShell } from '../lib/AppShell';
import { PageSkeleton } from '../lib/PageSkeleton';
import { Icon } from '../lib/Icon';
import { useAuth } from '../lib/auth-context';
import { ApiError, Batch, InventoryReminderStatus, Partner, ProductCategory, ProductDetail, ProductUsage, Site, StockRow, inventoryApi, invoicingApi, qualityApi, sitesApi, stockApi } from '../lib/api';
import { ReminderBanner } from '../lib/InventoryReminder';
import { useDataChangeListener } from '../lib/data-events';
import { toast } from '../lib/toast';
import { CAMERA_CONSTRAINTS, createBarcodeReader } from '../lib/barcodeScanner';
import { useStockRealtime } from '../lib/realtime';
import { SearchableSelect } from '../lib/SearchableSelect';
import { useListControls } from '../lib/ListControls';
import { useHasModule } from '../lib/useHasModule';
import '../lib/data-views.css';

const STATUS_LABEL: Record<StockRow['status'], string> = { ok: 'OK', low: 'Bas', out: 'Rupture' };

// Persisted across navigation — leaving Stock for another module and coming
// back used to silently reset the site filter to "Tous les sites" (useState
// re-initializes on every mount, there's nothing else backing it), which is
// disruptive on a real multi-site org where you're usually working one
// warehouse at a time. Found by actually switching pages and back.

const moneyFmt = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyFmt = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 });
function fmtMoney(v: number | null | undefined) {
  return v == null ? '—' : moneyFmt.format(v);
}
function fmtQty(v: number) {
  return qtyFmt.format(v);
}
function marginClass(v: number | null) {
  return v == null ? 'muted' : v < 0 ? 'bad' : 'good';
}

export function StockPage() {
  const { accessToken, can } = useAuth();
  const [sites, setSites] = useState<Site[]>([]);
  // No product list until a dépôt is chosen ('' = none). With a single
  // dépôt it's selected automatically; with several, the page always opens
  // on "Choisir un dépôt".
  const [siteId, setSiteId] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const [reminder, setReminder] = useState<InventoryReminderStatus | null>(null);
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
  }

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const [siteList, productRows, categoryList] = await Promise.all([
        sitesApi.list(accessToken),
        siteId ? stockApi.listProducts(accessToken, siteId, true) : Promise.resolve([] as StockRow[]),
        stockApi.listCategories(accessToken),
      ]);
      setSites(siteList);
      setRows(productRows);
      setCategories(categoryList);
      inventoryApi.reminder(accessToken).then(setReminder).catch(() => setReminder(null));
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

  useDataChangeListener('partners', load);
  useDataChangeListener('sites', load);

  // A stored dépôt that no longer exists is dropped; a single dépôt is
  // selected automatically.
  useEffect(() => {
    if (sites.length === 0) return;
    if (siteId && !sites.some((s) => s.id === siteId)) changeSite('');
    else if (!siteId && sites.length === 1) changeSite(sites[0].id);
  }, [sites, siteId]);

  // Real-time: a movement posted elsewhere (another tab, another user)
  // refreshes this view — proves the Milestone 2 websocket seam works from
  // the browser, not just the server-side smoke test.
  useStockRealtime(accessToken, siteId || null, () => load());

  // Variants are listed under their modèle: filters and sort apply to the
  // top-level rows; a search hit on a variant shows its modèle unfolded.
  const childrenOf = new Map<string, StockRow[]>();
  for (const r of rows) if (r.parentId) childrenOf.set(r.parentId, [...(childrenOf.get(r.parentId) ?? []), r]);
  const topRows = rows.filter((r) => !r.parentId);
  const list = useListControls(topRows, {
    id: 'stock',
    noun: ['produit', 'produits'],
    searchPlaceholder: 'Produit, référence, code-barres…',
    search: (r) => [r.name, r.sku, r.barcode, ...(childrenOf.get(r.productId) ?? []).flatMap((c) => [c.sku, c.barcode, c.color, c.size])],
    filters: [
      {
        key: 'status',
        label: 'État',
        type: 'select',
        value: (r) => r.status,
        options: [
          { value: 'ok', label: 'En stock' },
          { value: 'low', label: 'Seuil bas' },
          { value: 'out', label: 'Rupture' },
        ],
      },
      { key: 'category', label: 'Catégorie', type: 'select', value: (r) => r.category },
      { key: 'qty', label: 'Quantité', type: 'range', value: (r) => r.quantityOnHand },
      { key: 'price', label: 'Prix 1', type: 'range', unit: 'DA', value: (r) => r.sellPrice },
      { key: 'reserved', label: 'Avec quantité réservée', type: 'flag', test: (r) => r.quantityReserved > 0 },
      { key: 'noprice', label: 'Sans prix de vente', type: 'flag', test: (r) => r.sellPrice == null },
      { key: 'negmargin', label: 'Marge négative', type: 'flag', test: (r) => (r.margin1 ?? 0) < 0 || (r.margin2 ?? 0) < 0 },
      { key: 'variants', label: 'Avec tailles / couleurs', type: 'flag', test: (r) => r.isVariantParent },
      { key: 'lots', label: 'Suivi par lot', type: 'flag', test: (r) => r.isLotTracked },
    ],
    sorts: [
      { key: 'sku', label: 'Référence', value: (r) => r.sku },
      { key: 'name', label: 'Produit', value: (r) => r.name },
      { key: 'qty', label: 'Quantité', value: (r) => r.quantityOnHand, desc: true },
      { key: 'reserved', label: 'Qté réservée', value: (r) => r.quantityReserved, desc: true },
      { key: 'price1', label: 'Prix 1', value: (r) => r.sellPrice, desc: true },
      { key: 'price2', label: 'Prix 2', value: (r) => r.sellPrice2, desc: true },
      { key: 'cost', label: 'Prix d’achat', value: (r) => (r.isVariantParent ? null : r.averageCost), desc: true },
      { key: 'margin1', label: 'Marge 1', value: (r) => (r.isVariantParent ? null : r.margin1), desc: true },
      { key: 'margin2', label: 'Marge 2', value: (r) => (r.isVariantParent ? null : r.margin2), desc: true },
      { key: 'carton', label: 'Nb / carton', value: (r) => r.unitsPerCarton ?? 0, desc: true },
      { key: 'status', label: 'État', value: (r) => ({ out: 0, low: 1, ok: 2 })[r.status] },
    ],
  });
  const q = list.query;
  const matches = (r: StockRow) => [r.name, r.sku, r.barcode, r.color, r.size].some((v) => (v ?? '').toLowerCase().includes(q));
  const visibleRows = list.rows;
  const isOpen = (id: string) => expanded.has(id) || (!!q && (childrenOf.get(id) ?? []).some(matches));
  const sellable = rows.filter((r) => !r.isVariantParent);

  const stats = {
    total: new Set(sellable.map((r) => r.productId)).size,
    low: sellable.filter((r) => r.status === 'low').length,
    out: sellable.filter((r) => r.status === 'out').length,
    quarantined: sellable.filter((r) => r.quantityQuarantined > 0).length,
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
            Dépôt :{' '}
            <select className="site-select" value={siteId} onChange={(e) => changeSite(e.target.value)}>
              {!siteId && <option value="">Choisir un dépôt…</option>}
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {can('stock.product.write') && (
            <button className="btn-secondary" onClick={() => setShowProductForm(true)}>
              <Icon name="plus" size={16} /> Nouveau produit
            </button>
          )}
          {can('stock.movement.create') && (
            <button className="btn-primary" onClick={() => setShowMovementForm(true)} disabled={rows.length === 0}>
              <Icon name="plus" size={16} /> Mouvement de stock
            </button>
          )}
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {reminder && <ReminderBanner reminder={reminder} withLink />}

      {siteId && (
      <div className="stat-strip">
        <div className="stat-card">
          <div className="num">{stats.total}</div>
          <div className="label">Références affichées</div>
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
      )}

      {!siteId ? (
        <div className="center-message">
          <span className="center-message-icon">
            <Icon name="warehouse" size={26} />
          </span>
          <div className="center-message-title">{sites.length === 0 ? 'Aucun dépôt pour le moment' : 'Choisir un dépôt pour voir les produits'}</div>
          <div className="center-message-sub">
            {sites.length === 0 ? 'Créez un dépôt dans Multi-sites pour commencer.' : 'Sélectionnez un dépôt dans la liste en haut de la page.'}
          </div>
        </div>
      ) : loading ? (
        <PageSkeleton />
      ) : (
        <>
          {list.toolbar()}
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  {list.th('sku', 'Référence')}
                  {list.th('name', 'Produit')}
                  {list.th('qty', 'Qté', 'num')}
                  {list.th('reserved', 'Qté réservée', 'num')}
                  {list.th('price1', 'Prix 1', 'num')}
                  {list.th('price2', 'Prix 2', 'num')}
                  {list.th('cost', 'Prix d’achat', 'num')}
                  {list.th('margin1', 'Marge 1', 'num')}
                  {list.th('margin2', 'Marge 2', 'num')}
                  {list.th('carton', 'Nb / carton', 'num')}
                  {list.th('status', 'État')}
                </tr>
              </thead>
              <tbody>
                {visibleRows.flatMap((parentRow) => [parentRow, ...(parentRow.isVariantParent && isOpen(parentRow.productId) ? childrenOf.get(parentRow.productId) ?? [] : [])]).map((r) => (
                  <tr key={`${r.productId}-${r.site.id}`} className={`clickable${r.parentId ? ' variant-row' : ''}`} onClick={() => openDetail(r.productId)}>
                    <td className="mono">{r.sku}</td>
                    <td>
                      {r.isVariantParent ? (
                        <span className="variant-parent">
                          <button
                            type="button"
                            className="variant-toggle"
                            aria-label={isOpen(r.productId) ? 'Replier' : 'Déplier'}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggle(r.productId);
                            }}
                          >
                            <Icon name={isOpen(r.productId) ? 'chevronDown' : 'chevronRight'} size={15} />
                          </button>
                          {r.name}
                          <span className="chip">{(childrenOf.get(r.productId) ?? []).length} variantes</span>
                        </span>
                      ) : r.parentId ? (
                        <span className="variant-child">{[r.color, r.size].filter(Boolean).join(' / ')}</span>
                      ) : (
                        r.name
                      )}
                    </td>
                    <td className="num">{fmtQty(r.quantityOnHand)}</td>
                    <td className={`num${r.quantityReserved > 0 ? '' : ' muted'}`}>{fmtQty(r.quantityReserved)}</td>
                    <td className="num">{fmtMoney(r.sellPrice)}</td>
                    <td className="num">{fmtMoney(r.sellPrice2)}</td>
                    {/* A modèle has no cost of its own: cost and margins are per variant. */}
                    <td className="num muted">{r.isVariantParent ? '—' : fmtMoney(r.averageCost)}</td>
                    <td className={`num ${r.isVariantParent ? 'muted' : marginClass(r.margin1)}`}>{r.isVariantParent ? '—' : fmtMoney(r.margin1)}</td>
                    <td className={`num ${r.isVariantParent ? 'muted' : marginClass(r.margin2)}`}>{r.isVariantParent ? '—' : fmtMoney(r.margin2)}</td>
                    <td className="num muted">{r.unitsPerCarton ?? 0}</td>
                    <td>
                      <span className={`pill ${r.status === 'ok' ? 'success' : r.status === 'low' ? 'warning' : 'danger'}`}>
                        {STATUS_LABEL[r.status]}
                      </span>
                    </td>
                  </tr>
                ))}
                {visibleRows.length === 0 && (
                  <tr>
                    <td colSpan={11} className="muted" style={{ textAlign: 'center', padding: '24px 0' }}>
                      {list.filtered ? (
                        <>
                          Aucun produit ne correspond.{' '}
                          <button type="button" className="btn-link" onClick={list.reset}>
                            Effacer les filtres
                          </button>
                        </>
                      ) : (
                        'Aucun produit pour ce dépôt.'
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {detail && (
        <SkuDetailModal
          key={detail.id}
          detail={detail}
          onOpenProduct={openDetail}
          categories={categories}
          onClose={() => setDetail(null)}
          onChanged={() => {
            load();
          }}
          onDeleted={() => {
            setDetail(null);
            load();
          }}
        />
      )}
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

function SkuDetailModal({
  detail: initialDetail,
  categories,
  onClose,
  onChanged,
  onDeleted,
  onOpenProduct,
}: {
  detail: ProductDetail;
  categories: ProductCategory[];
  onClose: () => void;
  onChanged: () => void;
  onDeleted: () => void;
  onOpenProduct: (productId: string) => void;
}) {
  const { accessToken, can } = useAuth();
  const [detail, setDetail] = useState(initialDetail);
  // Lots (expiry, quality checks) are a Quality-module feature.
  const withQuality = useHasModule()('quality');
  const [batches, setBatches] = useState<Batch[] | null>(null);
  const [showEdit, setShowEdit] = useState(false);
  const [usage, setUsage] = useState<ProductUsage | null>(null);
  const [checkingUsage, setCheckingUsage] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Editable here rather than only at creation — most products in this
  // simulation were created before a sale price meant anything (Scan's
  // "Vente rapide" needs one to auto-fill a line), so there was no way to
  // go back and set one on an existing SKU.
  const isModel = initialDetail.variantSizes.length > 0 || initialDetail.variantColors.length > 0;
  const [tab, setTab] = useState<'stock' | 'variants' | 'settings'>(isModel ? 'variants' : 'stock');
  // The three editable attributes share one form and one save — they used
  // to be three mini-forms with three "Enregistrer" buttons.
  const [sellPriceInput, setSellPriceInput] = useState(detail.sellPrice != null ? String(detail.sellPrice) : '');
  const [barcodeInput, setBarcodeInput] = useState(detail.barcode ?? '');
  const [cartonInput, setCartonInput] = useState(detail.unitsPerCarton != null ? String(detail.unitsPerCarton) : '');
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [savingLotTracked, setSavingLotTracked] = useState(false);
  const [lotTrackedError, setLotTrackedError] = useState<string | null>(null);

  const [sellPrice2Input, setSellPrice2Input] = useState(detail.sellPrice2 != null ? String(detail.sellPrice2) : '');
  // Lots already exist → the API refuses to turn lot tracking off, so the switch is locked.
  const lotLocked = detail.isLotTracked && batches !== null && batches.length > 0;
  const priceDirty = sellPriceInput !== (detail.sellPrice != null ? String(detail.sellPrice) : '');
  const price2Dirty = sellPrice2Input !== (detail.sellPrice2 != null ? String(detail.sellPrice2) : '');
  const cartonDirty = cartonInput !== (detail.unitsPerCarton != null ? String(detail.unitsPerCarton) : '');
  const barcodeDirty = barcodeInput.trim() !== (detail.barcode ?? '');
  const settingsDirty = priceDirty || price2Dirty || cartonDirty || barcodeDirty;

  useEffect(() => {
    if (!accessToken || !detail.isLotTracked || !withQuality) return;
    qualityApi.listBatches(accessToken, detail.id).then(setBatches).catch(() => setBatches([]));
  }, [accessToken, detail.id, detail.isLotTracked, withQuality]);

  // A binary flag — saves immediately on toggle, no separate confirm step.
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

  async function saveSettings() {
    if (!accessToken || !settingsDirty) return;
    setSavingSettings(true);
    setSettingsError(null);
    try {
      const patch: Parameters<typeof stockApi.updateProduct>[2] = {};
      // sellPrice can't be cleared (empty = leave unchanged); "no carton" is
      // a real state (empty = null); barcode always sends the trimmed value
      // so emptying the field really clears it.
      if (priceDirty && sellPriceInput !== '') patch.sellPrice = Number(sellPriceInput);
      if (price2Dirty && sellPrice2Input !== '') patch.sellPrice2 = Number(sellPrice2Input);
      if (cartonDirty) patch.unitsPerCarton = cartonInput === '' ? null : Number(cartonInput);
      if (barcodeDirty) patch.barcode = barcodeInput.trim();
      const updated = await stockApi.updateProduct(accessToken, detail.id, patch);
      setDetail((d) => ({ ...d, sellPrice: updated.sellPrice, sellPrice2: updated.sellPrice2, unitsPerCarton: updated.unitsPerCarton, barcode: updated.barcode }));
      setSellPriceInput(updated.sellPrice != null ? String(updated.sellPrice) : '');
      setSellPrice2Input(updated.sellPrice2 != null ? String(updated.sellPrice2) : '');
      setCartonInput(updated.unitsPerCarton != null ? String(updated.unitsPerCarton) : '');
      setBarcodeInput(updated.barcode ?? '');
      toast.success('Produit mis à jour.');
    } catch (err) {
      setSettingsError(err instanceof ApiError ? err.message : 'Échec de l’enregistrement.');
    } finally {
      setSavingSettings(false);
    }
  }

  // First click checks what's attached to this product (stock/sales/
  // achats/factures/qualité) so the second, confirming click can warn about
  // it — never blocking, since a soft delete is non-destructive, just
  // informative before committing.
  async function handleDeleteClick() {
    if (!accessToken) return;
    if (!confirmingDelete) {
      setCheckingUsage(true);
      setDeleteError(null);
      try {
        setUsage(await stockApi.getProductUsage(accessToken, detail.id));
        setConfirmingDelete(true);
      } catch (err) {
        setDeleteError(err instanceof ApiError ? err.message : 'Erreur lors de la vérification.');
      } finally {
        setCheckingUsage(false);
      }
      return;
    }
    setDeleting(true);
    setDeleteError(null);
    try {
      await stockApi.deleteProduct(accessToken, detail.id);
      toast.success('Produit supprimé.');
      onDeleted();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Erreur lors de la suppression.';
      setDeleteError(message);
      toast.error(message);
    } finally {
      setDeleting(false);
    }
  }

  const usageSummary = usage
    ? [
        usage.stockOnHand > 0 ? `du stock (${usage.stockOnHand} unités)` : null,
        usage.salesOrderLines > 0 ? 'des lignes de vente' : null,
        usage.purchaseOrderLines > 0 ? 'des lignes d\'achat' : null,
        usage.invoiceLines > 0 ? 'des lignes de facture' : null,
        usage.batches > 0 ? 'des lots' : null,
        usage.qualityChecks > 0 || usage.nonConformities > 0 ? 'des contrôles qualité' : null,
        usage.partnerPrices > 0 ? 'des tarifs spécifiques' : null,
      ].filter((x): x is string => x !== null)
    : [];

  const totalOnHand =
    detail.variants.length > 0 ? detail.variants.reduce((sum, v) => sum + v.quantityOnHand, 0) : detail.levels.reduce((sum, l) => sum + l.quantityOnHand, 0);
  const totalQuarantined = detail.levels.reduce((sum, l) => sum + l.quantityQuarantined, 0);

  return (
    <div className="modal-backdrop open">
      <div className="modal wide">
        <div className="modal-header">
          <div className="modal-header-titles">
            <h3>{detail.name}</h3>
            <div className="modal-meta">
              <span className="chip mono">{detail.sku}</span>
              {detail.parent && (
                <button type="button" className="chip chip-link" onClick={() => onOpenProduct(detail.parent!.id)}>
                  Variante de {detail.parent.name} →
                </button>
              )}
              {detail.category && <span className="chip">{detail.category}</span>}
              {detail.isLotTracked && <span className="chip">Suivi par lot</span>}
            </div>
          </div>
          <div className="modal-header-actions">
            {can('stock.product.write') && (
              <button type="button" className="btn-secondary btn-sm" onClick={() => setShowEdit(true)}>
                Modifier
              </button>
            )}
            <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Fermer">
              ✕
            </button>
          </div>
        </div>

        <div className="fact-grid">
          <div className="fact">
            <span className="fact-label">En stock</span>
            <span className="fact-value">{totalOnHand}</span>
            {totalQuarantined > 0 && <span className="fact-note bad">{totalQuarantined} en quarantaine</span>}
          </div>
          <div className="fact">
            <span className="fact-label">Prix d'achat</span>
            <span className="fact-value">{fmtMoney(detail.averageCost)}</span>
            <span className="fact-note">coût moyen</span>
          </div>
          <div className="fact">
            <span className="fact-label">Prix 1 · détail</span>
            <span className="fact-value">{fmtMoney(detail.sellPrice)}</span>
            {detail.sellPrice != null && <span className={`fact-note ${detail.sellPrice - detail.averageCost < 0 ? 'bad' : 'good'}`}>marge {fmtMoney(detail.sellPrice - detail.averageCost)}</span>}
          </div>
          <div className="fact">
            <span className="fact-label">Prix 2 · gros</span>
            <span className="fact-value">{fmtMoney(detail.sellPrice2)}</span>
            {detail.sellPrice2 != null && <span className={`fact-note ${detail.sellPrice2 - detail.averageCost < 0 ? 'bad' : 'good'}`}>marge {fmtMoney(detail.sellPrice2 - detail.averageCost)}</span>}
          </div>
        </div>

        <div className="modal-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'stock'} className={tab === 'stock' ? 'on' : ''} onClick={() => setTab('stock')}>
            {detail.isLotTracked ? 'Stock & lots' : 'Stock'}
          </button>
          {!detail.parent && (
            <button type="button" role="tab" aria-selected={tab === 'variants'} className={tab === 'variants' ? 'on' : ''} onClick={() => setTab('variants')}>
              Tailles & couleurs{detail.variants.length > 0 ? ` (${detail.variants.length})` : ''}
            </button>
          )}
          <button type="button" role="tab" aria-selected={tab === 'settings'} className={tab === 'settings' ? 'on' : ''} onClick={() => setTab('settings')}>
            Réglages
          </button>
        </div>

        {tab === 'stock' && (
          <>
            <div className="modal-section">
              <div className="modal-section-label">Par site</div>
              <table className="lot-mini-table">
                <thead>
                  <tr>
                    <th>Site</th>
                    <th className="num">Disponible</th>
                    <th className="num">Quarantaine</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.levels.map((l) => (
                    <tr key={l.site.id}>
                      <td>{l.site.name}</td>
                      <td className="num">{l.quantityOnHand}</td>
                      <td className={`num${l.quantityQuarantined > 0 ? ' bad' : ' muted'}`}>{l.quantityQuarantined}</td>
                    </tr>
                  ))}
                  {detail.levels.length === 0 && (
                    <tr>
                      <td colSpan={3} className="muted">
                        Aucun stock enregistré.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {detail.isLotTracked && withQuality && (
              <div className="modal-section">
                <div className="modal-section-label">Lots</div>
                {batches === null ? (
                  <div className="page-loader"><span className="spinner" /> Chargement…</div>
                ) : batches.length === 0 ? (
                  <p className="sub">Aucun lot actif pour ce produit.</p>
                ) : (
                  <table className="lot-mini-table">
                    <thead>
                      <tr>
                        <th>N° de lot</th>
                        <th className="num">Qté</th>
                        <th>Péremption</th>
                        <th>État</th>
                      </tr>
                    </thead>
                    <tbody>
                      {batches.map((b) => (
                        <tr key={b.id}>
                          <td className="mono">{b.lotNumber}</td>
                          <td className="num">{b.remainingQuantity}</td>
                          <td>{b.expiryDate ? new Date(b.expiryDate).toLocaleDateString('fr-FR') : '—'}</td>
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
            )}
          </>
        )}

        {tab === 'variants' && (
          <VariantsPanel
            detail={detail}
            onSaved={(d) => {
              setDetail(d);
              onChanged();
            }}
            onOpenProduct={onOpenProduct}
          />
        )}

        {tab === 'settings' && (
          <div className="settings-list">
            {withQuality && (
              <>
            <div className="setting-row">
              <div className="setting-text">
                <div className="setting-title">Suivi par lot</div>
                <div className="setting-hint">
                  {lotLocked ? 'Des lots existent déjà : impossible de désactiver.' : 'Péremption et contrôle qualité par lot.'}
                </div>
              </div>
              <label className="switch" aria-label="Suivi par lot" title={lotLocked ? 'Des lots existent déjà pour ce produit : le suivi par lot ne peut plus être désactivé.' : undefined}>
                <input type="checkbox" checked={detail.isLotTracked} disabled={savingLotTracked || lotLocked} onChange={(e) => saveLotTracked(e.target.checked)} />
                <span />
              </label>
            </div>
            {lotTrackedError && <div className="error-banner">{lotTrackedError}</div>}
              </>
            )}

            <div className="setting-row">
              <div className="setting-text">
                <label className="setting-title" htmlFor="sku-price">
                  Prix de vente
                </label>
                <div className="setting-hint">Prix 1 = détail, Prix 2 = gros (selon le tarif du client).</div>
              </div>
              <div className="setting-control wide">
                <input id="sku-price" className="control" type="number" min={0} step="any" inputMode="decimal" value={sellPriceInput} onChange={(e) => setSellPriceInput(e.target.value)} placeholder="Prix 1" aria-label="Prix 1 (détail)" />
                <input className="control" type="number" min={0} step="any" inputMode="decimal" value={sellPrice2Input} onChange={(e) => setSellPrice2Input(e.target.value)} placeholder="Prix 2" aria-label="Prix 2 (gros)" />
                <span className="setting-unit">DZD</span>
              </div>
            </div>

            <div className="setting-row">
              <div className="setting-text">
                <label className="setting-title" htmlFor="sku-carton">
                  Unités par carton
                </label>
                <div className="setting-hint">Saisie en cartons dans Achats et Ventes.</div>
              </div>
              <div className="setting-control">
                <input id="sku-carton" className="control" type="number" min={1} step={1} inputMode="numeric" value={cartonInput} onChange={(e) => setCartonInput(e.target.value)} placeholder="—" />
              </div>
            </div>

            <div className="setting-row">
              <div className="setting-text">
                <label className="setting-title" htmlFor="sku-barcode">
                  Code-barres
                </label>
                <div className="setting-hint">EAN/UPC imprimé sur l’emballage.</div>
              </div>
              <div className="setting-control wide">
                <input id="sku-barcode" className="control mono" value={barcodeInput} onChange={(e) => setBarcodeInput(e.target.value)} placeholder="Non défini" />
                <BarcodeScanButton onScanned={setBarcodeInput} />
              </div>
            </div>
            {settingsError && <div className="error-banner">{settingsError}</div>}

            <div className="modal-footer">
              {can('stock.product.delete') ? (
              <button
                type="button"
                className="btn-link danger"
                style={{ marginRight: 'auto' }}
                disabled={checkingUsage || deleting}
                onClick={handleDeleteClick}
                onBlur={() => setConfirmingDelete(false)}
              >
                {checkingUsage ? 'Vérification…' : deleting ? 'Suppression…' : confirmingDelete ? 'Confirmer la suppression ?' : 'Supprimer le produit'}
              </button>
              ) : (
                <span style={{ marginRight: 'auto' }} />
              )}
              {can('stock.product.write') && (
                <button type="button" className="btn-primary" onClick={saveSettings} disabled={!settingsDirty || savingSettings}>
                  {savingSettings ? 'Enregistrement…' : 'Enregistrer'}
                </button>
              )}
              {confirmingDelete && (
                <p className="sub" style={{ width: '100%', margin: 0 }}>
                  {usageSummary.length > 0
                    ? `Ce produit a ${usageSummary.join(', ')}, il sera masqué de la liste, l'historique reste visible sur les documents existants.`
                    : "Ce produit n'est utilisé nulle part pour le moment."}
                </p>
              )}
              {deleteError && (
                <div className="error-banner" style={{ width: '100%' }}>
                  {deleteError}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      {showEdit && (
        <ProductEditModal
          detail={detail}
          categories={categories}
          onClose={() => setShowEdit(false)}
          onSaved={(fields) => {
            setDetail((d) => ({ ...d, ...fields }));
            setShowEdit(false);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

const SIZE_PRESETS: Record<string, string[]> = {
  Vêtements: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
  Pointures: ['36', '37', '38', '39', '40', '41', '42', '43', '44', '45'],
};
const COLOR_PRESETS = ['Noir', 'Blanc', 'Gris', 'Bleu', 'Rouge', 'Vert', 'Beige', 'Marron'];

function ChipsInput({ values, onChange, placeholder, presets }: { values: string[]; onChange: (v: string[]) => void; placeholder: string; presets?: Record<string, string[]> | string[] }) {
  const [draft, setDraft] = useState('');
  function add(raw: string) {
    const parts = raw.split(/[,;]/).map((x) => x.trim()).filter(Boolean);
    if (parts.length) onChange(Array.from(new Set([...values, ...parts])));
    setDraft('');
  }
  const presetGroups = Array.isArray(presets) ? { '': presets } : presets ?? {};
  return (
    <div>
      <div className="multiselect-chips">
        {values.map((v) => (
          <span key={v} className="multiselect-chip">
            {v}
            <button type="button" onClick={() => onChange(values.filter((x) => x !== v))} aria-label={`Retirer ${v}`}>
              ✕
            </button>
          </span>
        ))}
      </div>
      <input
        className="control"
        style={{ width: '100%' }}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            add(draft);
          }
        }}
        onBlur={() => draft.trim() && add(draft)}
      />
      {Object.entries(presetGroups).map(([label, list]) => (
        <div key={label} className="preset-row">
          {label && <span className="sub">{label} :</span>}
          {list.map((x) => (
            <button key={x} type="button" className={`preset${values.includes(x) ? ' on' : ''}`} onClick={() => onChange(values.includes(x) ? values.filter((v) => v !== x) : [...values, x])}>
              {x}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

function VariantsPanel({ detail, onSaved, onOpenProduct }: { detail: ProductDetail; onSaved: (d: ProductDetail) => void; onOpenProduct: (id: string) => void }) {
  const { accessToken } = useAuth();
  const [sizesOn, setSizesOn] = useState(detail.variantSizes.length > 0);
  const [colorsOn, setColorsOn] = useState(detail.variantColors.length > 0);
  const [sizes, setSizes] = useState<string[]>(detail.variantSizes);
  const [colors, setColors] = useState<string[]>(detail.variantColors);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const finalSizes = sizesOn ? sizes : [];
  const finalColors = colorsOn ? colors : [];
  const dirty = finalSizes.join('|') !== detail.variantSizes.join('|') || finalColors.join('|') !== detail.variantColors.join('|');
  const comboCount = (finalSizes.length || 1) * (finalColors.length || 1) * (finalSizes.length || finalColors.length ? 1 : 0);

  async function save() {
    if (!accessToken) return;
    setSaving(true);
    setError(null);
    try {
      const d = await stockApi.setVariants(accessToken, detail.id, { sizes: finalSizes, colors: finalColors });
      toast.success(d.variants.length ? `${d.variants.length} variante(s) à jour.` : 'Tailles/couleurs désactivées.');
      onSaved(d);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Échec de l’enregistrement.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="settings-list">
      <div className="setting-row">
        <div className="setting-text">
          <div className="setting-title">Tailles</div>
          <div className="setting-hint">Une variante par taille (et par couleur si activé).</div>
        </div>
        <label className="switch" aria-label="Activer les tailles">
          <input type="checkbox" checked={sizesOn} onChange={(e) => setSizesOn(e.target.checked)} />
          <span />
        </label>
      </div>
      {sizesOn && (
        <div style={{ padding: '10px 0 14px' }}>
          <ChipsInput values={sizes} onChange={setSizes} placeholder="Ajouter une taille (Entrée)…" presets={SIZE_PRESETS} />
        </div>
      )}
      <div className="setting-row">
        <div className="setting-text">
          <div className="setting-title">Couleurs</div>
          <div className="setting-hint">Chaque couleur a son propre stock et son code-barres.</div>
        </div>
        <label className="switch" aria-label="Activer les couleurs">
          <input type="checkbox" checked={colorsOn} onChange={(e) => setColorsOn(e.target.checked)} />
          <span />
        </label>
      </div>
      {colorsOn && (
        <div style={{ padding: '10px 0 14px' }}>
          <ChipsInput values={colors} onChange={setColors} placeholder="Ajouter une couleur (Entrée)…" presets={COLOR_PRESETS} />
        </div>
      )}
      {error && <div className="error-banner">{error}</div>}
      {dirty && (
        <div className="modal-footer" style={{ marginTop: 6 }}>
          <span className="sub" style={{ marginRight: 'auto' }}>
            {comboCount > 0 ? `${comboCount} variante(s) au total` : 'Le produit redeviendra un produit simple.'}
          </span>
          <button type="button" className="btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Enregistrement…' : 'Enregistrer les variantes'}
          </button>
        </div>
      )}

      {detail.variants.length > 0 && (
        <div className="modal-section">
          <div className="modal-section-label">Variantes</div>
          <table className="lot-mini-table">
            <thead>
              <tr>
                <th>Variante</th>
                <th>Réf.</th>
                <th>Code-barres</th>
                <th className="num">Stock</th>
                <th className="num">Prix 1</th>
              </tr>
            </thead>
            <tbody>
              {detail.variants.map((v) => (
                <tr key={v.id} className="clickable-row" onClick={() => onOpenProduct(v.id)}>
                  <td>{[v.color, v.size].filter(Boolean).join(' / ')}</td>
                  <td className="mono muted">{v.sku}</td>
                  <td className="mono muted">{v.barcode ?? '—'}</td>
                  <td className="num">{fmtQty(v.quantityOnHand)}</td>
                  <td className="num">{fmtMoney(v.sellPrice)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="sub">Cliquez sur une variante pour définir son code-barres, ses prix ou voir son stock par dépôt.</p>
        </div>
      )}
    </div>
  );
}

function ProductEditModal({
  detail,
  categories,
  onClose,
  onSaved,
}: {
  detail: ProductDetail;
  categories: ProductCategory[];
  onClose: () => void;
  onSaved: (fields: Pick<ProductDetail, 'name' | 'categoryId' | 'category' | 'minThreshold' | 'maxThreshold'>) => void;
}) {
  const { accessToken } = useAuth();
  const [name, setName] = useState(detail.name);
  const [categoryId, setCategoryId] = useState(detail.categoryId ?? '');
  const [minThreshold, setMinThreshold] = useState<number | ''>(detail.minThreshold ?? '');
  const [maxThreshold, setMaxThreshold] = useState<number | ''>(detail.maxThreshold ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!accessToken) return;
    setSubmitting(true);
    setError(null);
    try {
      // The raw PATCH response is the unconverted Prisma row — its Decimal
      // fields (minThreshold/maxThreshold/averageCost/...) serialize as
      // strings, not numbers (see PurchasingService's own comment on the
      // same Decimal.toJSON behavior). Merging that response straight into
      // `detail` would silently turn e.g. averageCost into a string and
      // crash the next `.toFixed()` call on it. Building the merged fields
      // from this form's own already-typed local state avoids the
      // round-trip entirely instead of trying to re-coerce the response.
      await stockApi.updateProduct(accessToken, detail.id, {
        name,
        categoryId,
        ...(minThreshold !== '' ? { minThreshold: Number(minThreshold) } : {}),
        ...(maxThreshold !== '' ? { maxThreshold: Number(maxThreshold) } : {}),
      });
      toast.success('Produit modifié.');
      onSaved({
        name,
        categoryId: categoryId || null,
        category: categoryId ? categories.find((c) => c.id === categoryId)?.name ?? null : null,
        minThreshold: minThreshold === '' ? detail.minThreshold : Number(minThreshold),
        maxThreshold: maxThreshold === '' ? detail.maxThreshold : Number(maxThreshold),
      });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Erreur lors de la modification du produit.';
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
            <h3>Modifier le produit</h3>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>
        <form onSubmit={handleSubmit} className="field-form">
          <div className="field-row">
            <label>Nom</label>
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="field-row">
            <label>Famille</label>
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Aucune</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
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
  const withQuality = useHasModule()('quality');
  const [isLotTracked, setIsLotTracked] = useState(false);
  const [minThreshold, setMinThreshold] = useState<number | ''>('');
  const [maxThreshold, setMaxThreshold] = useState<number | ''>('');
  const [sellPrice, setSellPrice] = useState<number | ''>('');
  const [sellPrice2, setSellPrice2] = useState<number | ''>('');
  const [unitsPerCarton, setUnitsPerCarton] = useState<number | ''>('');
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
        ...(sellPrice2 !== '' ? { sellPrice2: Number(sellPrice2) } : {}),
        ...(unitsPerCarton !== '' ? { unitsPerCarton: Number(unitsPerCarton) } : {}),
        ...(barcode.trim() !== '' ? { barcode: barcode.trim() } : {}),
      });
      toast.success('Produit créé.');
      onSaved();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Erreur lors de la création du produit.';
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
            <h3>Nouveau produit</h3>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>
        <form onSubmit={handleSubmit} className="field-form">
          <div className="field-row">
            <label>Référence</label>
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
            <label>Famille existante</label>
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} disabled={!!newCategoryName.trim()}>
              <option value="">Aucune</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field-row">
            <label>Ou nouvelle famille</label>
            <input value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} placeholder="Laisser vide si non applicable" />
          </div>
          {withQuality && (
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
          )}
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
          <div className="field-grid">
            <div className="field-row">
              <label>Prix 1 · détail</label>
              <input type="number" min={0} step="any" placeholder="Optionnel" value={sellPrice} onChange={(e) => setSellPrice(e.target.value === '' ? '' : Number(e.target.value))} />
            </div>
            <div className="field-row">
              <label>Prix 2 · gros</label>
              <input type="number" min={0} step="any" placeholder="Optionnel" value={sellPrice2} onChange={(e) => setSellPrice2(e.target.value === '' ? '' : Number(e.target.value))} />
            </div>
          </div>
          <div className="field-grid">
            <div className="field-row">
              <label>Unités par carton (optionnel)</label>
              <input
                type="number"
                min={1}
                step={1}
                value={unitsPerCarton}
                onChange={(e) => setUnitsPerCarton(e.target.value === '' ? '' : Number(e.target.value))}
                placeholder="ex: 24"
              />
            </div>
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
  // Suppliers and customers belong to the Invoicing module.
  const withPartners = useHasModule()('invoicing');
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
      toast.success('Mouvement enregistré.');
      onSaved();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Erreur lors de l’enregistrement du mouvement.';
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
          {withPartners && type === 'IN' && (
            <div className="field-row">
              <label>Fournisseur (optionnel)</label>
              <SearchableSelect
                value={partnerId}
                onChange={setPartnerId}
                placeholder="Rechercher un fournisseur…"
                emptyLabel="Non spécifié"
                options={suppliers.map((p) => ({ value: p.id, label: p.name, sublabel: p.nif }))}
              />
            </div>
          )}
          {withPartners && type === 'OUT' && (
            <div className="field-row">
              <label>Client (optionnel)</label>
              <SearchableSelect
                value={partnerId}
                onChange={setPartnerId}
                placeholder="Rechercher un client…"
                emptyLabel="Non spécifié"
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
      setError("Impossible d'accéder à la caméra, saisissez le code manuellement.");
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
        <Icon name="scan" size={16} /> Scanner
      </button>
      {open && (
        <div className="modal-backdrop open barcode-scan-backdrop">
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
