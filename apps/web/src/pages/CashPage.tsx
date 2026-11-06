import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '../lib/AppShell';
import { Icon } from '../lib/Icon';
import { SearchableSelect } from '../lib/SearchableSelect';
import { useListControls } from '../lib/ListControls';
import { useHasModule } from '../lib/useHasModule';
import { useAuth } from '../lib/auth-context';
import { toast } from '../lib/toast';
import { ApiError, CashEntryView, CashJournal, CashMethod, CashOpenDocument, Partner, Site, StockRow, cashApi, invoicingApi, sitesApi, stockApi } from '../lib/api';

const da2 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const DA = (n: number) => `${da2.format(n)} DA`;
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

type Preset = 'day' | '7d' | 'month' | 'custom';
const PRESETS: [Preset, string][] = [
  ['day', 'Aujourd’hui'],
  ['7d', '7 jours'],
  ['month', 'Ce mois'],
  ['custom', 'Personnalisé'],
];
function rangeFor(preset: Preset, from: string, to: string) {
  const now = new Date();
  if (preset === 'day') return { from: iso(now), to: iso(now) };
  if (preset === '7d') return { from: iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6)), to: iso(now) };
  if (preset === 'month') return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(now) };
  return { from, to };
}
const shortDate = (isoDay: string) => new Date(`${isoDay}T00:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
const dateTime = (d: string) => {
  const x = new Date(d);
  return { day: x.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' }), time: x.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) };
};

const SOURCE_LABEL: Record<CashEntryView['source'], string> = {
  payment: 'Versements sur bons / comptes',
  invoice_payment: 'Règlements de factures',
  counter_sale: 'Ventes comptoir',
  counter_movement: 'Mouvements de comptoir',
  manual: 'Mouvements libres',
};
const METHODS: [CashMethod, string][] = [
  ['especes', 'Espèces'],
  ['cheque', 'Chèque'],
  ['virement', 'Virement'],
  ['carte', 'Carte'],
  ['autre', 'Autre'],
];
const DOC_PREFIX: Record<string, string> = { invoice: 'Facture', supplier_invoice: 'Facture', purchase_receipt: 'BR', delivery_note: 'BL' };

export function CashPage() {
  const { accessToken, can } = useAuth();
  const [preset, setPreset] = useState<Preset>('month');
  const today = iso(new Date());
  const [customFrom, setCustomFrom] = useState(iso(new Date(new Date().setDate(1))));
  const [customTo, setCustomTo] = useState(today);
  const [siteId, setSiteId] = useState('');
  const [sites, setSites] = useState<Site[]>([]);
  const [data, setData] = useState<CashJournal | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // `?dir=in|out` (Statistiques deep link) preselects the direction.
  const [dir, setDir] = useState<'all' | 'in' | 'out'>(() => {
    const d = new URLSearchParams(window.location.search).get('dir');
    return d === 'in' || d === 'out' ? d : 'all';
  });
  const [form, setForm] = useState<'in' | 'out' | null>(null);
  const range = useMemo(() => rangeFor(preset, customFrom, customTo), [preset, customFrom, customTo]);

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      setData(await cashApi.journal(accessToken, { ...range, siteId: siteId || undefined }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur de chargement.');
    } finally {
      setLoading(false);
    }
  }, [accessToken, range, siteId]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (accessToken) sitesApi.list(accessToken).then(setSites).catch(() => setSites([]));
  }, [accessToken]);

  const entries = useMemo(() => (data?.entries ?? []).filter((e) => dir === 'all' || e.direction === dir), [data, dir]);
  const list = useListControls(entries, {
    id: 'cash',
    noun: ['mouvement', 'mouvements'],
    searchPlaceholder: 'Libellé, client, n° de bon, description…',
    search: (e) => [e.label, e.description, e.partner?.name, e.product?.name, e.document?.number, e.methodLabel],
    filters: [
      { key: 'source', label: 'Origine', type: 'select', value: (e) => e.source, options: Object.entries(SOURCE_LABEL).map(([value, label]) => ({ value, label })) },
      { key: 'method', label: 'Mode de paiement', type: 'select', value: (e) => e.method, options: [...METHODS, ['inconnu', 'Non précisé']].map(([value, label]) => ({ value, label })) },
      { key: 'partner', label: 'Client / fournisseur', type: 'select', value: (e) => e.partner?.name ?? null },
      { key: 'amount', label: 'Montant', type: 'range', unit: 'DA', value: (e) => e.amount },
      { key: 'date', label: 'Date', type: 'dates', value: (e) => iso(new Date(e.date)) },
      ...(sites.length > 1 && !siteId ? [{ key: 'site', label: 'Dépôt', type: 'select' as const, value: (e: CashEntryView) => e.site?.name ?? null }] : []),
      { key: 'withDoc', label: 'Liés à un bon ou une facture', type: 'flag', test: (e) => !!e.document },
      { key: 'noPartner', label: 'Sans client ni fournisseur', type: 'flag', test: (e) => !e.partner },
    ],
    sorts: [
      { key: 'date', label: 'Date', value: (e) => e.date, desc: true },
      { key: 'label', label: 'Libellé', value: (e) => e.label },
      { key: 'partner', label: 'Client / fournisseur', value: (e) => e.partner?.name },
      { key: 'method', label: 'Mode', value: (e) => e.methodLabel },
      { key: 'in', label: 'Entrée', value: (e) => (e.direction === 'in' ? e.amount : null), desc: true },
      { key: 'out', label: 'Sortie', value: (e) => (e.direction === 'out' ? e.amount : null), desc: true },
    ],
  });
  const shownIn = list.rows.filter((e) => e.direction === 'in').reduce((s, e) => s + e.amount, 0);
  const shownOut = list.rows.filter((e) => e.direction === 'out').reduce((s, e) => s + e.amount, 0);

  async function cancel(e: CashEntryView) {
    if (!accessToken || (e.source !== 'manual' && e.source !== 'payment')) return;
    const what = e.source === 'payment' && e.document ? ` Le reste à payer de ${e.document.number} sera mis à jour.` : e.source === 'payment' && e.partner ? ` Le solde de ${e.partner.name} sera mis à jour.` : '';
    if (!window.confirm(`Annuler ce mouvement de ${DA(e.amount)} ?${what}`)) return;
    try {
      await cashApi.cancel(accessToken, e.source, e.id);
      toast.success('Mouvement annulé.');
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Échec de l’annulation.');
    }
  }

  const span = range.from === range.to ? `le ${shortDate(range.from)}` : `du ${shortDate(range.from)} au ${shortDate(range.to)}`;

  return (
    <AppShell>
      <div className="panel-head">
        <div>
          <h2>Caisse</h2>
          <div className="sub">Encaissements et décaissements {span}</div>
        </div>
        <div className="cash-actions">
          {can('cash.entry.disburse') && (
            <button type="button" className="btn-secondary" onClick={() => setForm('out')}>
              <span className="cash-sign is-out">−</span> Décaissement
            </button>
          )}
          {can('cash.entry.collect') && (
            <button type="button" className="btn-primary" onClick={() => setForm('in')}>
              <Icon name="plus" size={16} /> Encaissement
            </button>
          )}
        </div>
      </div>

      <div className="st-filters">
        <div className="toggle-row" style={{ margin: 0 }}>
          {PRESETS.map(([p, label]) => (
            <button key={p} type="button" className={`toggle-btn${preset === p ? ' on' : ''}`} onClick={() => setPreset(p)}>
              {label}
            </button>
          ))}
        </div>
        {preset === 'custom' && (
          <div className="date-range">
            <input type="date" className="control" value={customFrom} max={customTo} onChange={(e) => e.target.value && setCustomFrom(e.target.value)} />
            <span className="muted">→</span>
            <input type="date" className="control" value={customTo} min={customFrom} max={today} onChange={(e) => e.target.value && setCustomTo(e.target.value)} />
          </div>
        )}
        {sites.length > 1 && (
          <select className="control st-site" value={siteId} onChange={(e) => setSiteId(e.target.value)}>
            <option value="">Tous les dépôts</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
        {loading && data && <span className="spinner" aria-label="Chargement" />}
      </div>

      {error && <div className="error-banner">{error}</div>}
      {!data && loading && <div className="muted" style={{ padding: '24px 0' }}>Chargement…</div>}

      {data && (
        <>
          <div className="cash-summary">
            <div className="cash-flow">
              <div className="cash-cell">
                <span className="cash-k">Solde au début</span>
                <span className="cash-v">{DA(data.openingBalance)}</span>
              </div>
              <span className="cash-op" aria-hidden>
                +
              </span>
              <div className="cash-cell">
                <span className="cash-k">Encaissements</span>
                <span className="cash-v is-in">{DA(data.totalIn)}</span>
                <span className="cash-n">{data.entries.filter((e) => e.direction === 'in').length} mouvement(s)</span>
              </div>
              <span className="cash-op" aria-hidden>
                −
              </span>
              <div className="cash-cell">
                <span className="cash-k">Décaissements</span>
                <span className="cash-v is-out">{DA(data.totalOut)}</span>
                <span className="cash-n">{data.entries.filter((e) => e.direction === 'out').length} mouvement(s)</span>
              </div>
              <span className="cash-op" aria-hidden>
                =
              </span>
              <div className="cash-cell is-total">
                <span className="cash-k">Solde à la fin</span>
                <span className={`cash-v${data.closingBalance < 0 ? ' is-out' : ''}`}>{DA(data.closingBalance)}</span>
                <span className="cash-n">
                  {data.net >= 0 ? '+' : '−'} {DA(Math.abs(data.net))} sur la période
                </span>
              </div>
            </div>
            {data.byMethod.length > 0 && (
              <div className="cash-methods" aria-label="Solde par mode de paiement">
                {data.byMethod.map((m) => (
                  <div key={m.method} className="cash-method" title={`Sur la période : +${da2.format(m.in)} / −${da2.format(m.out)}`}>
                    <span className="cash-k">{m.method === 'especes' ? 'Espèces en caisse' : m.label}</span>
                    <b className={m.balance < 0 ? 'bad' : ''}>{DA(m.balance)}</b>
                  </div>
                ))}
              </div>
            )}
          </div>

          {list.toolbar(
            <div className="toggle-row">
              {(
                [
                  ['all', 'Tout'],
                  ['in', 'Encaissements'],
                  ['out', 'Décaissements'],
                ] as const
              ).map(([k, label]) => (
                <button key={k} type="button" className={`toggle-btn${dir === k ? ' on' : ''}`} onClick={() => setDir(k)}>
                  {label}
                </button>
              ))}
            </div>,
          )}

          <div className="table-wrap">
            <table className="data cash-table">
              <thead>
                <tr>
                  {list.th('date', 'Date')}
                  {list.th('label', 'Libellé')}
                  {list.th('partner', 'Client / fournisseur')}
                  <th>Bon / facture</th>
                  {list.th('method', 'Mode')}
                  {list.th('in', 'Entrée', 'num')}
                  {list.th('out', 'Sortie', 'num')}
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {list.rows.map((e) => {
                  const dt = dateTime(e.date);
                  return (
                    <tr key={`${e.source}-${e.id}`}>
                      <td data-label="Date" className="nowrap">
                        {dt.day} <span className="muted">{dt.time}</span>
                      </td>
                      <td data-label="Libellé">
                        <div className="cash-label">
                          <span className={`cash-dot is-${e.direction}`} aria-hidden />
                          <div>
                            <div>{e.label}</div>
                            {(e.description || e.product) && (
                              <div className="muted cash-desc">{[e.description, e.product ? `Produit : ${e.product.name}` : null].filter(Boolean).join(' · ')}</div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td data-label="Client / fournisseur">{e.partner?.name ?? <span className="muted">—</span>}</td>
                      <td data-label="Bon / facture">{e.document ? <span className="mono">{e.document.number || DOC_PREFIX[e.document.type]}</span> : <span className="muted">—</span>}</td>
                      <td data-label="Mode">{e.methodLabel}</td>
                      <td data-label="Entrée" className="num cash-in">
                        {e.direction === 'in' ? `+${da2.format(e.amount)}` : ''}
                      </td>
                      <td data-label="Sortie" className="num cash-out">
                        {e.direction === 'out' ? `−${da2.format(e.amount)}` : ''}
                      </td>
                      <td className="row-actions">
                        {e.cancellable && can('cash.entry.cancel') ? (
                          <button type="button" className="btn-link danger" onClick={() => cancel(e)} title="Annuler ce mouvement">
                            Annuler
                          </button>
                        ) : (
                          <span className="muted cash-src" title="Se modifie depuis son bon, sa facture ou son comptoir">
                            {e.source === 'invoice_payment' ? 'Facture' : 'Comptoir'}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {list.rows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="muted" style={{ textAlign: 'center', padding: '28px 0' }}>
                      {list.filtered || dir !== 'all' ? (
                        <>
                          Aucun mouvement ne correspond.{' '}
                          <button
                            type="button"
                            className="btn-link"
                            onClick={() => {
                              list.reset();
                              setDir('all');
                            }}
                          >
                            Effacer les filtres
                          </button>
                        </>
                      ) : (
                        <>Aucun mouvement sur la période. Les versements sur les bons, les règlements de factures et les ventes comptoir apparaissent ici automatiquement.</>
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
              {list.rows.length > 0 && (
                <tfoot>
                  <tr className="cash-foot">
                    <td colSpan={5}>
                      Total {list.filtered || dir !== 'all' ? 'affiché' : 'de la période'} · solde {shownIn - shownOut >= 0 ? '+' : '−'}
                      {da2.format(Math.abs(shownIn - shownOut))} DA
                    </td>
                    <td className="num cash-in">{shownIn > 0 ? `+${da2.format(shownIn)}` : '—'}</td>
                    <td className="num cash-out">{shownOut > 0 ? `−${da2.format(shownOut)}` : '—'}</td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </>
      )}

      {form && (
        <CashEntryModal
          initialDirection={form}
          sites={sites}
          defaultSiteId={siteId}
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null);
            load();
          }}
        />
      )}
    </AppShell>
  );
}

function CashEntryModal({
  initialDirection,
  sites,
  defaultSiteId,
  onClose,
  onSaved,
}: {
  initialDirection: 'in' | 'out';
  sites: Site[];
  defaultSiteId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { accessToken } = useAuth();
  const has = useHasModule();
  // What the entry can be attached to depends on the modules the org has.
  const withStock = has('stock');
  const withPartners = has('invoicing');
  const [direction, setDirection] = useState(initialDirection);
  const withDocs = has(direction === 'in' ? 'sales' : 'purchasing');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<CashMethod>('especes');
  const [date, setDate] = useState(iso(new Date()));
  const [description, setDescription] = useState('');
  const [siteId, setSiteId] = useState(defaultSiteId || (sites.length === 1 ? sites[0].id : ''));
  const [partnerId, setPartnerId] = useState('');
  const [documentId, setDocumentId] = useState('');
  const [productId, setProductId] = useState('');
  const [applyToBalance, setApplyToBalance] = useState(true);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [products, setProducts] = useState<StockRow[]>([]);
  const [docs, setDocs] = useState<CashOpenDocument[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showMore, setShowMore] = useState(false);

  useEffect(() => {
    if (!accessToken || !withPartners) return;
    invoicingApi.listPartners(accessToken).then(setPartners).catch(() => setPartners([]));
  }, [accessToken, withPartners]);
  const productSite = siteId || sites[0]?.id;
  useEffect(() => {
    if (accessToken && withStock && productSite && showMore) stockApi.listProducts(accessToken, productSite).then(setProducts).catch(() => setProducts([]));
  }, [accessToken, withStock, productSite, showMore]);

  const partner = partners.find((p) => p.id === partnerId) ?? null;
  // A versement on the account only makes sense in the partner's own direction.
  const canApply = !!partner && (direction === 'in' ? partner.isCustomer : partner.isSupplier);
  useEffect(() => {
    setDocumentId('');
    setDocs([]);
    if (!accessToken || !partnerId || !canApply) return;
    setDocsLoading(true);
    cashApi
      .openDocuments(accessToken, partnerId, direction)
      .then(setDocs)
      .catch(() => setDocs([]))
      .finally(() => setDocsLoading(false));
  }, [accessToken, partnerId, direction, canApply]);
  const doc = docs.find((d) => d.id === documentId) ?? null;

  const partnerOptions = useMemo(
    () =>
      [...partners]
        .sort((a, b) => Number(direction === 'in' ? b.isCustomer : b.isSupplier) - Number(direction === 'in' ? a.isCustomer : a.isSupplier) || a.name.localeCompare(b.name, 'fr'))
        .map((p) => ({ value: p.id, label: p.name, sublabel: [p.code, p.isCustomer && p.isSupplier ? 'Client et fournisseur' : p.isCustomer ? 'Client' : 'Fournisseur'].filter(Boolean).join(' · ') })),
    [partners, direction],
  );
  const productOptions = useMemo(() => products.map((p) => ({ value: p.productId, label: p.name, sublabel: p.sku })), [products]);

  const isIn = direction === 'in';
  const amountNum = Number(amount.replace(',', '.'));
  const tooMuch = !!doc && amountNum > doc.remaining + 0.004;
  let effect: string;
  if (doc) effect = `Versement sur ${doc.number} : le reste à payer passe de ${DA(doc.remaining)} à ${DA(Math.max(0, doc.remaining - (amountNum || 0)))}.`;
  else if (partner && canApply && applyToBalance) effect = isIn ? `Déduit de ce que ${partner.name} vous doit.` : `Déduit de ce que vous devez à ${partner.name}.`;
  else effect = 'Mouvement de caisse uniquement : aucun solde client ou fournisseur n’est modifié.';

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!accessToken) return;
    if (!(amountNum > 0)) {
      toast.error('Saisissez un montant.');
      return;
    }
    setSaving(true);
    try {
      const now = new Date();
      const occurredAt = date === iso(now) ? now.toISOString() : new Date(`${date}T12:00:00`).toISOString();
      await cashApi.create(accessToken, {
        direction,
        amount: Math.round(amountNum * 100) / 100,
        method,
        occurredAt,
        description: description.trim() || undefined,
        siteId: siteId || undefined,
        partnerId: partnerId || undefined,
        productId: productId || undefined,
        documentId: documentId || undefined,
        documentType: doc?.type,
        applyToBalance: canApply && !doc ? applyToBalance : undefined,
      });
      toast.success(isIn ? 'Encaissement enregistré.' : 'Décaissement enregistré.');
      onSaved();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Échec de l’enregistrement.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop open">
      <div className="modal cash-modal">
        <div className="modal-header">
          <div className="modal-header-titles">
            <h3>{isIn ? 'Nouvel encaissement' : 'Nouveau décaissement'}</h3>
            <p className="modal-sub">{isIn ? 'Argent qui entre dans la caisse.' : 'Argent qui sort de la caisse.'}</p>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>
        <form className="field-form" onSubmit={submit}>
          <div className="toggle-row cash-dir">
            <button type="button" className={`toggle-btn${isIn ? ' on' : ''}`} onClick={() => setDirection('in')}>
              Encaissement
            </button>
            <button type="button" className={`toggle-btn${!isIn ? ' on' : ''}`} onClick={() => setDirection('out')}>
              Décaissement
            </button>
          </div>

          <div className="field-grid">
            <div className="field-row">
              <label htmlFor="cash-amount">Montant (DA)</label>
              <input id="cash-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" autoFocus required />
              {tooMuch && <span className="field-warn">Plus que le reste à payer du bon ({DA(doc.remaining)}).</span>}
            </div>
            <div className="field-row">
              <label htmlFor="cash-date">Date</label>
              <input id="cash-date" type="date" value={date} max={iso(new Date())} onChange={(e) => e.target.value && setDate(e.target.value)} />
            </div>
          </div>

          <div className="field-row">
            <label>Mode de paiement</label>
            <div className="toggle-row cash-methods-pick">
              {METHODS.map(([m, label]) => (
                <button key={m} type="button" className={`toggle-btn${method === m ? ' on' : ''}`} onClick={() => setMethod(m)}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="field-row">
            <label htmlFor="cash-desc">Description</label>
            <input id="cash-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder={isIn ? 'ex. Versement, apport, remboursement…' : 'ex. Loyer, électricité, transport, salaire…'} maxLength={300} />
          </div>

          {withPartners && (
            <div className="field-row">
              <label>{isIn ? 'Client' : 'Fournisseur'} (facultatif)</label>
              <SearchableSelect value={partnerId} onChange={setPartnerId} options={partnerOptions} placeholder="Rechercher un client ou un fournisseur…" emptyLabel="Aucun" />
            </div>
          )}

          {withDocs && partner && canApply && (
            <div className="field-row">
              <label htmlFor="cash-doc">{isIn ? 'Bon de livraison' : 'Bon de réception'} (facultatif)</label>
              <select
                id="cash-doc"
                value={documentId}
                disabled={docsLoading}
                onChange={(e) => {
                  setDocumentId(e.target.value);
                  const d = docs.find((x) => x.id === e.target.value);
                  if (d && !amount) setAmount(String(d.remaining));
                }}
              >
                <option value="">{docsLoading ? 'Chargement…' : docs.length ? 'Aucun bon : versement sur le compte' : 'Aucun bon à payer'}</option>
                {docs.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.number} · {new Date(d.date).toLocaleDateString('fr-FR')} · reste {DA(d.remaining)}
                  </option>
                ))}
              </select>
            </div>
          )}

          {partner && canApply && !doc && (
            <label className="cash-check">
              <input type="checkbox" checked={applyToBalance} onChange={(e) => setApplyToBalance(e.target.checked)} />
              {isIn ? `Déduire du solde de ${partner.name}` : `Déduire de ce que vous devez à ${partner.name}`}
            </label>
          )}

          {/* The product link needs the Stock module; the depot only needs several sites. */}
          {!withStock && sites.length <= 1 ? null : !showMore ? (
            <button type="button" className="btn-link cash-more" onClick={() => setShowMore(true)}>
              + {[withStock ? 'Produit' : null, sites.length > 1 ? 'dépôt' : null].filter(Boolean).join(', ').replace(/^./, (c) => c.toUpperCase())}
            </button>
          ) : (
            <div className="field-grid">
              {withStock && (
                <div className="field-row">
                  <label>Produit (facultatif)</label>
                  <SearchableSelect value={productId} onChange={setProductId} options={productOptions} placeholder="Rechercher un produit…" emptyLabel="Aucun" />
                </div>
              )}
              {sites.length > 1 && (
                <div className="field-row">
                  <label htmlFor="cash-site">Dépôt</label>
                  <select id="cash-site" value={siteId} onChange={(e) => setSiteId(e.target.value)}>
                    <option value="">Non précisé</option>
                    {sites.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}

          <div className={`cash-effect${doc || (partner && canApply && applyToBalance) ? ' is-linked' : ''}`}>
            <Icon name="info" size={15} /> {effect}
          </div>

          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Annuler
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Enregistrement…' : isIn ? `Encaisser${amountNum > 0 ? ` ${DA(amountNum)}` : ''}` : `Décaisser${amountNum > 0 ? ` ${DA(amountNum)}` : ''}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default CashPage;
