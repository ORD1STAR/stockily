import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AppShell } from '../lib/AppShell';
import { PageSkeleton } from '../lib/PageSkeleton';
import { Icon } from '../lib/Icon';
import { ReminderBanner } from '../lib/InventoryReminder';
import { useAuth } from '../lib/auth-context';
import { SearchableMultiSelect } from '../lib/SearchableSelect';
import { toast } from '../lib/toast';
import {
  ApiError,
  InventoryCountSummary,
  InventoryCountView,
  InventoryReminderStatus,
  ProductCategory,
  Site,
  StockRow,
  inventoryApi,
  sitesApi,
  stockApi,
} from '../lib/api';

const money = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const STATUS: Record<InventoryCountSummary['status'], { label: string; pill: string }> = {
  draft: { label: 'En cours', pill: 'warning' },
  validated: { label: 'Validé', pill: 'success' },
  cancelled: { label: 'Annulé', pill: 'danger' },
};

export function InventoryPage() {
  const { accessToken, can } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const openId = searchParams.get('id');
  const [counts, setCounts] = useState<InventoryCountSummary[] | null>(null);
  const [reminder, setReminder] = useState<InventoryReminderStatus | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [products, setProducts] = useState<StockRow[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accessToken) return;
    try {
      const [list, rem, siteList, cats, prods] = await Promise.all([
        inventoryApi.list(accessToken),
        inventoryApi.reminder(accessToken),
        sitesApi.list(accessToken),
        stockApi.listCategories(accessToken),
        stockApi.listProducts(accessToken, 'all'),
      ]);
      setCounts(list);
      setReminder(rem);
      setSites(siteList);
      setCategories(cats);
      setProducts(Array.from(new Map(prods.map((p) => [p.productId, p])).values()));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur de chargement.');
    }
  }, [accessToken]);

  useEffect(() => {
    load();
  }, [load]);

  const open = (id: string | null) => setSearchParams(id ? { id } : {});

  if (openId) {
    return (
      <AppShell>
        <CountSheet
          id={openId}
          products={products}
          onBack={() => {
            open(null);
            load();
          }}
        />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="panel-head">
        <div>
          <h2>Inventaires</h2>
          <div className="sub">Comptez le stock réel d’un dépôt et corrigez les écarts.</div>
        </div>
        {can('stock.movement.create') && (
          <button className="btn-primary" onClick={() => setShowNew(true)} disabled={sites.length === 0}>
            <Icon name="plus" size={16} /> Nouvel inventaire
          </button>
        )}
      </div>
      {error && <div className="error-banner">{error}</div>}
      {reminder && <ReminderBanner reminder={reminder} />}

      {counts === null ? (
        <PageSkeleton />
      ) : counts.length === 0 ? (
        <div className="center-message">
          <span className="center-message-icon">
            <Icon name="clipboard" size={26} />
          </span>
          <div className="center-message-title">Aucun inventaire pour le moment</div>
          <div className="center-message-sub">Lancez votre premier inventaire pour comparer le stock réel au stock théorique.</div>
          {can('stock.movement.create') && (
            <button className="btn-primary" style={{ marginTop: 10 }} onClick={() => setShowNew(true)} disabled={sites.length === 0}>
              Nouvel inventaire
            </button>
          )}
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>N°</th>
                <th>Dépôt</th>
                <th>Date</th>
                <th>Avancement</th>
                <th className="num">Écarts</th>
                <th className="num">Valeur des écarts</th>
                <th>Statut</th>
              </tr>
            </thead>
            <tbody>
              {counts.map((c) => (
                <tr key={c.id} className="clickable" onClick={() => open(c.id)}>
                  <td className="mono">{c.number}</td>
                  <td>{c.site.name}</td>
                  <td className="muted">{new Date(c.validatedAt ?? c.createdAt).toLocaleDateString('fr-FR')}</td>
                  <td>
                    <div className="inv-progress-cell">
                      <div className="pay-progress">
                        <span style={{ width: `${c.lineCount ? (c.countedCount / c.lineCount) * 100 : 0}%` }} />
                      </div>
                      <span className="muted">
                        {c.countedCount} / {c.lineCount}
                      </span>
                    </div>
                  </td>
                  <td className="num">{c.discrepancyCount || '—'}</td>
                  <td className={`num ${c.valueDifference && c.valueDifference < 0 ? 'bad' : ''}`}>{c.valueDifference != null ? money.format(c.valueDifference) : '—'}</td>
                  <td>
                    <span className={`pill ${STATUS[c.status].pill}`}>{STATUS[c.status].label}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showNew && (
        <NewCountModal
          sites={sites}
          categories={categories}
          products={products}
          onClose={() => setShowNew(false)}
          onCreated={(id) => {
            setShowNew(false);
            open(id);
          }}
        />
      )}
    </AppShell>
  );
}

function NewCountModal({
  sites,
  categories,
  products,
  onClose,
  onCreated,
}: {
  sites: Site[];
  categories: ProductCategory[];
  products: StockRow[];
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { accessToken } = useAuth();
  const [siteId, setSiteId] = useState(sites.length === 1 ? sites[0].id : '');
  const [scope, setScope] = useState<'all' | 'category' | 'selection'>('all');
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? '');
  const [productIds, setProductIds] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!accessToken) return;
    if (!siteId) return setError('Choisissez le dépôt.');
    setSubmitting(true);
    setError(null);
    try {
      const count = await inventoryApi.create(accessToken, {
        siteId,
        scope,
        categoryId: scope === 'category' ? categoryId : undefined,
        productIds: scope === 'selection' ? productIds : undefined,
        notes: notes.trim() || undefined,
      });
      toast.success(`Inventaire ${count.number} créé.`);
      onCreated(count.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Échec de la création.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop open">
      <div className="modal">
        <div className="modal-header">
          <div className="modal-header-titles">
            <h3>Nouvel inventaire</h3>
            <p className="modal-sub">Le stock théorique est relevé maintenant ; vous saisissez ensuite le stock compté.</p>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>
        <form className="field-form" onSubmit={submit}>
          <div className="field-row">
            <label>Dépôt</label>
            <select value={siteId} onChange={(e) => setSiteId(e.target.value)} required>
              {!siteId && <option value="">Choisir un dépôt…</option>}
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field-row">
            <label>Produits à compter</label>
            <div className="toggle-row" style={{ margin: 0 }}>
              <button type="button" className={`toggle-btn${scope === 'all' ? ' on' : ''}`} onClick={() => setScope('all')}>
                Tout le stock
              </button>
              <button type="button" className={`toggle-btn${scope === 'category' ? ' on' : ''}`} onClick={() => setScope('category')} disabled={categories.length === 0}>
                Une famille
              </button>
              <button type="button" className={`toggle-btn${scope === 'selection' ? ' on' : ''}`} onClick={() => setScope('selection')}>
                Sélection
              </button>
            </div>
          </div>
          {scope === 'category' && (
            <div className="field-row">
              <label>Famille</label>
              <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {scope === 'selection' && (
            <div className="field-row">
              <label>Produits</label>
              <SearchableMultiSelect
                values={productIds}
                onChange={setProductIds}
                options={products.map((p) => ({ value: p.productId, label: p.name, sublabel: p.sku }))}
                placeholder="Rechercher un produit…"
              />
            </div>
          )}
          <div className="field-row">
            <label>Observation</label>
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optionnel (ex. inventaire de fin d’année)" />
          </div>
          {error && <div className="error-banner">{error}</div>}
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Annuler
            </button>
            <button type="submit" className="btn-primary" disabled={submitting || (scope === 'selection' && productIds.length === 0)}>
              {submitting ? 'Création…' : 'Commencer l’inventaire'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ───────────────────────── Counting sheet ─────────────────────────

function CountSheet({ id, products, onBack }: { id: string; products: StockRow[]; onBack: () => void }) {
  const { accessToken } = useAuth();
  const [count, setCount] = useState<InventoryCountView | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<'all' | 'todo' | 'diff'>('all');
  const [search, setSearch] = useState('');
  const [scan, setScan] = useState('');
  const [saving, setSaving] = useState(false);
  const [showValidate, setShowValidate] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  const load = useCallback(async () => {
    if (!accessToken) return;
    try {
      setCount(await inventoryApi.get(accessToken, id));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Inventaire introuvable.');
      onBack();
    }
  }, [accessToken, id]);
  useEffect(() => {
    load();
  }, [load]);

  const editable = count?.status === 'draft';

  async function save(productId: string, countedQty: number | null) {
    if (!accessToken || !count) return;
    setSaving(true);
    try {
      const updated = await inventoryApi.saveLines(accessToken, count.id, [{ productId, countedQty }]);
      setCount(updated);
      setDrafts((d) => {
        const next = { ...d };
        delete next[productId];
        return next;
      });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Échec de l’enregistrement.');
    } finally {
      setSaving(false);
    }
  }

  function commit(productId: string) {
    const raw = drafts[productId];
    if (raw === undefined) return;
    save(productId, raw.trim() === '' ? null : Number(raw.replace(',', '.')));
  }

  // Scan / type a code: +1 on that product (added to the count if it wasn't in it).
  async function handleScan(e: FormEvent) {
    e.preventDefault();
    const code = scan.trim().toLowerCase();
    if (!code || !count) return;
    const inCount = count.lines.find((l) => (l.barcode ?? '').toLowerCase() === code || l.sku.toLowerCase() === code);
    const product = inCount ?? products.find((p) => (p.barcode ?? '').toLowerCase() === code || p.sku.toLowerCase() === code);
    if (!product) {
      toast.error(`Aucun produit pour « ${scan.trim()} ».`);
      return;
    }
    const current = inCount?.countedQty ?? 0;
    await save(product.productId, current + 1);
    setScan('');
    setHighlight(product.productId);
    setTimeout(() => inputs.current[product.productId]?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50);
  }

  const visible = useMemo(() => {
    if (!count) return [];
    const q = search.trim().toLowerCase();
    return count.lines.filter(
      (l) =>
        (filter === 'all' || (filter === 'todo' ? l.countedQty == null : l.difference != null && l.difference !== 0)) &&
        (!q || l.name.toLowerCase().includes(q) || l.sku.toLowerCase().includes(q) || (l.barcode ?? '').includes(q)),
    );
  }, [count, filter, search]);

  if (!count) {
    return (
      <div className="page-loader">
        <span className="spinner" /> Chargement…
      </div>
    );
  }

  const s = count.summary;
  async function print() {
    if (!accessToken || !count) return;
    try {
      const blob = await inventoryApi.fetchPdf(accessToken, count.id);
      window.open(URL.createObjectURL(blob), '_blank');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Impossible de générer le PDF.');
    }
  }
  async function cancel() {
    if (!accessToken || !count) return;
    if (!confirmingCancel) return setConfirmingCancel(true);
    try {
      await inventoryApi.cancel(accessToken, count.id);
      toast.success('Inventaire annulé.');
      onBack();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Échec.');
    }
  }

  return (
    <>
      <div className="panel-head">
        <div>
          <button type="button" className="btn-link" style={{ marginBottom: 6 }} onClick={onBack}>
            <Icon name="chevronLeft" size={15} /> Inventaires
          </button>
          <h2>
            Inventaire {count.number} <span className={`pill ${STATUS[count.status].pill}`} style={{ verticalAlign: 'middle' }}>{STATUS[count.status].label}</span>
          </h2>
          <div className="sub">
            {count.site.name} · commencé le {new Date(count.createdAt).toLocaleDateString('fr-FR')}
            {count.validatedAt && ` · validé le ${new Date(count.validatedAt).toLocaleDateString('fr-FR')}`}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn-secondary" onClick={print}>
            {count.status === 'validated' ? 'Imprimer le PV' : 'Imprimer la feuille de comptage'}
          </button>
          {editable && (
            <button className="btn-primary" onClick={() => setShowValidate(true)} disabled={s.countedCount === 0}>
              Valider l’inventaire
            </button>
          )}
        </div>
      </div>

      <div className="stat-strip">
        <div className="stat-card">
          <div className="num">
            {s.countedCount} / {s.lineCount}
          </div>
          <div className="label">Articles comptés</div>
        </div>
        <div className={`stat-card${s.discrepancyCount ? ' warn' : ''}`}>
          <div className="num">{s.discrepancyCount}</div>
          <div className="label">Articles en écart</div>
        </div>
        <div className={`stat-card${s.valueDifference < 0 ? ' bad' : s.valueDifference > 0 ? ' good' : ''}`}>
          <div className="num">{money.format(s.valueDifference)}</div>
          <div className="label">Valeur des écarts (DZD)</div>
        </div>
      </div>

      <div className="list-toolbar">
        {editable && (
          <form onSubmit={handleScan} className="inv-scan">
            <Icon name="scan" size={16} />
            <input className="control" value={scan} onChange={(e) => setScan(e.target.value)} placeholder="Scanner ou taper un code (+1)" aria-label="Scanner un code" />
          </form>
        )}
        <input className="control list-search" type="search" placeholder="Rechercher…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="toggle-row" style={{ margin: 0 }}>
          {(
            [
              ['all', 'Tous'],
              ['todo', 'À compter'],
              ['diff', 'Écarts'],
            ] as const
          ).map(([k, label]) => (
            <button key={k} type="button" className={`toggle-btn${filter === k ? ' on' : ''}`} onClick={() => setFilter(k)}>
              {label}
            </button>
          ))}
        </div>
        {saving && <span className="sub">Enregistrement…</span>}
      </div>

      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Réf.</th>
              <th>Désignation</th>
              <th className="num">Théorique</th>
              <th className="num" style={{ width: 140 }}>
                Compté
              </th>
              <th className="num">Écart</th>
              <th className="num">Valeur écart</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((l) => (
              <tr key={l.productId} className={highlight === l.productId ? 'row-flash' : undefined}>
                <td className="mono">{l.sku}</td>
                <td>
                  <div className="cell-title">{l.name}</div>
                  {l.category && <div className="cell-sub">{l.category}</div>}
                </td>
                <td className="num muted">{l.systemQty}</td>
                <td className="num">
                  {editable ? (
                    <input
                      ref={(el) => {
                        inputs.current[l.productId] = el;
                      }}
                      className="control inv-input"
                      inputMode="decimal"
                      placeholder="—"
                      value={drafts[l.productId] ?? (l.countedQty != null ? String(l.countedQty) : '')}
                      onChange={(e) => setDrafts((d) => ({ ...d, [l.productId]: e.target.value }))}
                      onBlur={() => commit(l.productId)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          commit(l.productId);
                          const idx = visible.findIndex((x) => x.productId === l.productId);
                          inputs.current[visible[idx + 1]?.productId]?.focus();
                        }
                      }}
                    />
                  ) : (
                    l.countedQty ?? '—'
                  )}
                </td>
                <td className={`num ${l.difference == null ? 'muted' : l.difference < 0 ? 'bad' : l.difference > 0 ? 'good' : 'muted'}`}>
                  {l.difference == null ? '—' : `${l.difference > 0 ? '+' : ''}${l.difference}`}
                </td>
                <td className={`num ${l.valueDifference && l.valueDifference < 0 ? 'bad' : 'muted'}`}>{l.valueDifference ? money.format(l.valueDifference) : '—'}</td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={6} className="muted" style={{ textAlign: 'center', padding: '24px 0' }}>
                  Aucun article pour ce filtre.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editable && (
        <div style={{ marginTop: 16 }}>
          <button type="button" className="btn-link danger" onClick={cancel} onBlur={() => setConfirmingCancel(false)}>
            {confirmingCancel ? 'Confirmer l’annulation de l’inventaire ?' : 'Annuler cet inventaire'}
          </button>
        </div>
      )}

      {showValidate && (
        <ValidateModal
          count={count}
          onClose={() => setShowValidate(false)}
          onValidated={(v) => {
            setShowValidate(false);
            setCount(v);
          }}
        />
      )}
    </>
  );
}

function ValidateModal({ count, onClose, onValidated }: { count: InventoryCountView; onClose: () => void; onValidated: (c: InventoryCountView) => void }) {
  const { accessToken } = useAuth();
  const [zeroUncounted, setZeroUncounted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const uncounted = count.summary.lineCount - count.summary.countedCount;

  async function submit() {
    if (!accessToken) return;
    setSubmitting(true);
    try {
      const v = await inventoryApi.validate(accessToken, count.id, zeroUncounted);
      toast.success(`Inventaire ${v.number} validé, stock corrigé.`);
      onValidated(v);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Échec de la validation.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop open">
      <div className="modal">
        <div className="modal-header">
          <div className="modal-header-titles">
            <h3>Valider l’inventaire {count.number}</h3>
            <p className="modal-sub">Le stock de « {count.site.name} » prendra les quantités comptées.</p>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>
        <div className="account-box" style={{ marginBottom: 14 }}>
          <div className="account-row">
            <span>Articles comptés</span>
            <span>
              {count.summary.countedCount} / {count.summary.lineCount}
            </span>
          </div>
          <div className="account-row">
            <span>Articles en écart</span>
            <span>{count.summary.discrepancyCount}</span>
          </div>
          <div className="account-row total">
            <span>Valeur des écarts</span>
            <span className={count.summary.valueDifference < 0 ? 'bad' : ''}>{money.format(count.summary.valueDifference)} DZD</span>
          </div>
        </div>
        {uncounted > 0 && (
          <div className="setting-row" style={{ borderBottom: 'none' }}>
            <div className="setting-text">
              <div className="setting-title">Mettre à 0 les {uncounted} article(s) non compté(s)</div>
              <div className="setting-hint">Sinon, leur stock reste inchangé.</div>
            </div>
            <label className="switch" aria-label="Mettre à zéro les non comptés">
              <input type="checkbox" checked={zeroUncounted} onChange={(e) => setZeroUncounted(e.target.checked)} />
              <span />
            </label>
          </div>
        )}
        <div className="modal-footer">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Continuer le comptage
          </button>
          <button type="button" className="btn-primary" onClick={submit} disabled={submitting}>
            {submitting ? 'Validation…' : 'Valider et corriger le stock'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default InventoryPage;
