import { FormEvent, useEffect, useState } from 'react';
import { FilterDef, useListControls } from './ListControls';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './auth-context';
import {
  ApiError,
  DocumentAccount,
  Partner,
  PartnerPaymentView,
  SalesOrderView,
  Site,
  StockRow,
  TaxRate,
  TradeDocumentType,
  TradeDocumentView,
  tradeApi,
} from './api';
import { CartonInput } from './CartonInput';
import { SearchableSelect } from './SearchableSelect';
import { notifyDataChanged } from './data-events';
import { toast } from './toast';

export const money = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmt = (n: number) => money.format(n);

export const DOC_LABEL: Record<TradeDocumentType, string> = {
  delivery_note: 'Bon de livraison',
  customer_return: 'Retour client',
  supplier_return: 'Retour fournisseur',
};

export const PAYMENT_METHODS: { value: string; label: string }[] = [
  { value: 'especes', label: 'Espèces' },
  { value: 'cheque', label: 'Chèque' },
  { value: 'virement', label: 'Virement' },
  { value: 'autre', label: 'Autre' },
];

/** Status pill for a bon: annulé / facturé / validé. */
export function DocStatus({ doc }: { doc: { status: string; invoice?: { number: string | null } | null } }) {
  if (doc.status === 'cancelled') return <span className="pill danger">Annulé</span>;
  if (doc.invoice) return <span className="pill success">Facturé</span>;
  return <span className="pill info">Validé</span>;
}

// ───────────────────────── Ancien solde / versement / nouveau solde ─────────────────────────

export function AccountSummary({ account, side }: { account: DocumentAccount; side: 'customer' | 'supplier' }) {
  return (
    <div className="account-box">
      <div className="account-row">
        <span>Ancien solde</span>
        <span>{fmt(account.previousBalance)}</span>
      </div>
      <div className="account-row">
        <span>{account.documentAmount >= 0 ? 'Montant du bon' : 'Montant du retour'}</span>
        <span>{account.documentAmount >= 0 ? '+ ' : '− '}{fmt(Math.abs(account.documentAmount))}</span>
      </div>
      <div className="account-row">
        <span>{account.paidWithDocument >= 0 ? 'Versement' : 'Remboursement'}</span>
        <span>{account.paidWithDocument >= 0 ? '− ' : '+ '}{fmt(Math.abs(account.paidWithDocument))}</span>
      </div>
      <div className="account-row total">
        <span>Nouveau solde</span>
        <span className={account.newBalance > 0 ? 'bad' : ''}>{fmt(account.newBalance)} DZD</span>
      </div>
      <div className="account-hint">{side === 'customer' ? 'Montant dû par le client' : 'Montant dû au fournisseur'}</div>
    </div>
  );
}

// ───────────────────────── Inline versement form ─────────────────────────

export function PaymentInline({
  partnerId,
  direction,
  documentType,
  documentId,
  onSaved,
  label = 'Ajouter un versement',
}: {
  partnerId: string;
  direction: 'in' | 'out';
  documentType?: string;
  documentId?: string;
  onSaved: () => void;
  label?: string;
}) {
  const { accessToken } = useAuth();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('especes');
  const [saving, setSaving] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!accessToken || !(Number(amount) > 0)) return;
    setSaving(true);
    try {
      await tradeApi.createPayment(accessToken, { partnerId, direction, amount: Number(amount), method, documentType, documentId });
      toast.success('Versement enregistré.');
      notifyDataChanged('partners');
      setAmount('');
      setOpen(false);
      onSaved();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Échec de l’enregistrement.');
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="btn-link" onClick={() => setOpen(true)}>
        + {label}
      </button>
    );
  }
  return (
    <form className="pay-form" onSubmit={save}>
      <input className="control" inputMode="decimal" placeholder="Montant" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
      <select className="control" value={method} onChange={(e) => setMethod(e.target.value)} style={{ width: 130 }}>
        {PAYMENT_METHODS.map((m) => (
          <option key={m.value} value={m.value}>
            {m.label}
          </option>
        ))}
      </select>
      <button type="submit" className="btn-secondary" disabled={saving || !(Number(amount) > 0)}>
        Enregistrer
      </button>
      <button type="button" className="btn-link subtle" onClick={() => setOpen(false)}>
        Annuler
      </button>
    </form>
  );
}

export function PaymentList({ payments, onCancelled }: { payments: PartnerPaymentView[]; onCancelled: () => void }) {
  const { accessToken } = useAuth();
  const [confirming, setConfirming] = useState<string | null>(null);
  if (payments.length === 0) return null;
  return (
    <table className="lot-mini-table" style={{ marginTop: 8 }}>
      <tbody>
        {payments.map((p) => (
          <tr key={p.id}>
            <td>{new Date(p.paidAt).toLocaleDateString('fr-FR')}</td>
            <td className="muted">{PAYMENT_METHODS.find((m) => m.value === p.method)?.label ?? p.method ?? '—'}</td>
            <td className="num">{fmt(p.amount)}</td>
            <td style={{ textAlign: 'right' }}>
              <button
                type="button"
                className="btn-link danger"
                onBlur={() => setConfirming(null)}
                onClick={async () => {
                  if (confirming !== p.id) return setConfirming(p.id);
                  if (!accessToken) return;
                  try {
                    await tradeApi.cancelPayment(accessToken, p.id);
                    toast.success('Versement annulé.');
                    notifyDataChanged('partners');
                    onCancelled();
                  } catch (err) {
                    toast.error(err instanceof ApiError ? err.message : 'Échec.');
                  }
                }}
              >
                {confirming === p.id ? 'Confirmer ?' : 'Annuler'}
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ───────────────────────── List ─────────────────────────

export function DocumentTable({
  docs,
  onOpen,
  selectable,
  selected,
  onToggle,
  partnerLabel,
  listId,
}: {
  listId: string;
  docs: TradeDocumentView[];
  onOpen: (doc: TradeDocumentView) => void;
  selectable?: (doc: TradeDocumentView) => boolean;
  selected?: Set<string>;
  onToggle?: (id: string) => void;
  partnerLabel: string;
}) {
  const payState = (d: TradeDocumentView) => (d.paid <= 0.004 ? 'none' : d.paid + 0.01 >= d.totals.totalTtc ? 'paid' : 'partial');
  const docState = (d: TradeDocumentView) => (d.status === 'cancelled' ? 'cancelled' : d.invoice ? 'invoiced' : 'validated');
  const filters: FilterDef<TradeDocumentView>[] = [
    { key: 'partner', label: partnerLabel, type: 'select', value: (d) => d.partner?.name ?? 'Client comptoir' },
    { key: 'date', label: 'Date', type: 'dates', value: (d) => d.issuedAt },
    { key: 'site', label: 'Dépôt', type: 'select', value: (d) => d.site.name },
    {
      key: 'pay',
      label: 'Paiement',
      type: 'select',
      value: payState,
      options: [
        { value: 'paid', label: 'Payé' },
        { value: 'partial', label: 'Payé en partie' },
        { value: 'none', label: 'Rien versé' },
      ],
    },
    {
      key: 'state',
      label: 'Statut',
      type: 'select',
      value: docState,
      options: [
        { value: 'validated', label: listId.startsWith('bl') ? 'Non facturé' : 'Validé' },
        ...(listId.startsWith('bl') ? [{ value: 'invoiced', label: 'Facturé' }] : []),
        { value: 'cancelled', label: 'Annulé' },
      ],
    },
    { key: 'total', label: 'Total TTC', type: 'range', unit: 'DA', value: (d) => d.totals.totalTtc },
  ];
  const list = useListControls(docs, {
    id: listId,
    noun: ['bon', 'bons'],
    searchPlaceholder: `N°, ${partnerLabel.toLowerCase()}, produit…`,
    search: (d) => [d.number, d.partner?.name, d.partner?.code, d.salesOrder?.number, d.invoice?.number, d.notes, ...d.lines.map((l) => l.description)],
    filters,
    sorts: [
      { key: 'number', label: 'N°', value: (d) => d.number, desc: true },
      { key: 'date', label: 'Date', value: (d) => d.issuedAt, desc: true },
      { key: 'partner', label: partnerLabel, value: (d) => d.partner?.name ?? 'Client comptoir' },
      { key: 'site', label: 'Dépôt', value: (d) => d.site.name },
      { key: 'total', label: 'Total TTC', value: (d) => d.totals.totalTtc, desc: true },
      { key: 'paid', label: 'Versé', value: (d) => d.paid, desc: true },
      { key: 'rest', label: 'Reste à payer', value: (d) => (d.status === 'cancelled' ? null : Math.max(0, d.totals.totalTtc - d.paid)), desc: true },
    ],
  });
  return (
    <>
    {list.toolbar()}
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            {selectable && <th style={{ width: 36 }} />}
            {list.th('number', 'N°')}
            {list.th('date', 'Date')}
            {list.th('partner', partnerLabel)}
            {list.th('site', 'Dépôt')}
            {list.th('total', 'Total TTC', 'num')}
            {list.th('paid', 'Versé', 'num')}
            <th>Statut</th>
          </tr>
        </thead>
        <tbody>
          {list.rows.map((d) => (
            <tr key={d.id} className="clickable" onClick={() => onOpen(d)}>
              {selectable && (
                <td onClick={(e) => e.stopPropagation()}>
                  {selectable(d) && <input type="checkbox" checked={selected?.has(d.id) ?? false} onChange={() => onToggle?.(d.id)} aria-label={`Sélectionner ${d.number}`} />}
                </td>
              )}
              <td className="mono">{d.number}</td>
              <td className="muted">{new Date(d.issuedAt).toLocaleDateString('fr-FR')}</td>
              <td>
                <div className="cell-title">{d.partner?.name ?? 'Client comptoir'}</div>
                {d.salesOrder?.number && <div className="cell-sub">Commande {d.salesOrder.number}</div>}
              </td>
              <td className="muted">{d.site.name}</td>
              <td className="num">{fmt(d.totals.totalTtc)}</td>
              <td className="num muted">{d.paid > 0 ? fmt(d.paid) : '—'}</td>
              <td>
                <DocStatus doc={d} />
              </td>
            </tr>
          ))}
          {list.rows.length === 0 && (
            <tr>
              <td colSpan={selectable ? 8 : 7} className="muted" style={{ textAlign: 'center', padding: '24px 0' }}>
                {list.filtered ? (
                  <>
                    Aucun résultat pour ces filtres.{' '}
                    <button type="button" className="btn-link" onClick={list.reset}>
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
    </>
  );
}

// ───────────────────────── Detail ─────────────────────────

export function DocumentDetailModal({
  docId,
  type,
  onClose,
  onChanged,
}: {
  docId: string;
  type: TradeDocumentType;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { accessToken } = useAuth();
  const navigate = useNavigate();
  const [doc, setDoc] = useState<TradeDocumentView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const openInvoice = (id: string) => navigate(`/invoicing?open=${id}`);

  async function load() {
    if (!accessToken) return;
    try {
      setDoc(await tradeApi.get(accessToken, type, docId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur de chargement.');
    }
  }
  useEffect(() => {
    load();
  }, [docId]);

  async function cancelDoc() {
    if (!accessToken || !doc) return;
    if (!confirmingCancel) return setConfirmingCancel(true);
    setBusy(true);
    try {
      await tradeApi.cancel(accessToken, type, doc.id);
      toast.success(`${doc.number} annulé — stock rétabli.`);
      notifyDataChanged('partners');
      onChanged();
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Échec de l’annulation.');
    } finally {
      setBusy(false);
      setConfirmingCancel(false);
    }
  }

  async function print() {
    if (!accessToken || !doc) return;
    try {
      const blob = await tradeApi.fetchPdf(accessToken, type, doc.id);
      window.open(URL.createObjectURL(blob), '_blank');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Impossible de générer le PDF.');
    }
  }

  async function invoice() {
    if (!accessToken || !doc) return;
    setBusy(true);
    try {
      const inv = await tradeApi.invoice(accessToken, [doc.id]);
      toast.success(`Facture ${inv.number ?? ''} créée.`);
      onChanged();
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Échec de la facturation.');
    } finally {
      setBusy(false);
    }
  }

  const side = type === 'supplier_return' ? 'supplier' : 'customer';
  const direction = type === 'customer_return' ? 'out' : 'in';

  return (
    <div className="modal-backdrop open">
      <div className="modal wide">
        <div className="modal-header">
          <div className="modal-header-titles">
            <h3>
              {DOC_LABEL[type]} {doc?.number ?? ''}
            </h3>
            {doc && (
              <div className="modal-meta">
                <DocStatus doc={doc} />
                <span className="chip">{doc.partner?.name ?? 'Client comptoir'}</span>
                <span className="chip">{doc.site.name}</span>
                <span className="chip">{new Date(doc.issuedAt).toLocaleDateString('fr-FR')}</span>
                {doc.salesOrder?.number && <span className="chip">Commande {doc.salesOrder.number}</span>}

              </div>
            )}
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>
        {error && <div className="error-banner">{error}</div>}
        {!doc ? (
          <div className="page-loader">
            <span className="spinner" /> Chargement…
          </div>
        ) : (
          <>
            {doc.invoice && (
              <div className="link-banner">
                <span>
                  Facturé sur <b>{doc.invoice.number ?? 'une facture brouillon'}</b>
                </span>
                <button type="button" className="btn-secondary btn-sm" onClick={() => openInvoice(doc.invoice!.id)}>
                  Ouvrir la facture →
                </button>
              </div>
            )}
            <table className="lot-mini-table">
              <thead>
                <tr>
                  <th>Désignation</th>
                  <th className="num">Qté</th>
                  <th className="num">P.U.</th>
                  <th className="num">Remise</th>
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {doc.lines.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <div>{l.description}</div>
                      {l.sku && <div className="cell-sub mono">{l.sku}</div>}
                    </td>
                    <td className="num">{l.quantity}</td>
                    <td className="num">{fmt(l.unitPrice)}</td>
                    <td className="num muted">{l.discountPercent ? `${l.discountPercent} %` : '—'}</td>
                    <td className="num">{fmt(l.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="doc-bottom">
              <div className="doc-bottom-left">
                {doc.notes && (
                  <div className="doc-notes">
                    <div className="modal-section-label">Observation</div>
                    <p>{doc.notes}</p>
                  </div>
                )}
                {doc.partner && doc.status === 'validated' && (
                  <div>
                    <div className="modal-section-label">{type === 'customer_return' ? 'Remboursements' : 'Versements'}</div>
                    <PaymentList payments={doc.payments ?? []} onCancelled={() => { load(); onChanged(); }} />
                    {(doc.invoicePayments ?? []).length > 0 && (
                      <table className="lot-mini-table" style={{ marginTop: 4 }}>
                        <tbody>
                          {(doc.invoicePayments ?? []).map((p) => (
                            <tr key={p.id}>
                              <td>{new Date(p.paidAt).toLocaleDateString('fr-FR')}</td>
                              <td className="muted">Réglé sur la facture {doc.invoice?.number ?? ''}</td>
                              <td className="num">{fmt(p.amount)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    <PaymentInline
                      partnerId={doc.partner.id}
                      direction={direction}
                      documentType={type}
                      documentId={doc.id}
                      label={type === 'customer_return' ? 'Ajouter un remboursement' : 'Ajouter un versement'}
                      onSaved={() => { load(); onChanged(); }}
                    />
                  </div>
                )}
              </div>
              <div className="doc-bottom-right">
                <div className="totals" style={{ margin: 0 }}>
                  <div className="totals-row">
                    <span>Total HT</span>
                    <span>{fmt(doc.totals.totalHt)}</span>
                  </div>
                  {doc.totals.totalTax > 0 && (
                    <div className="totals-row">
                      <span>TVA</span>
                      <span>{fmt(doc.totals.totalTax)}</span>
                    </div>
                  )}
                  <div className="totals-row grand">
                    <span>Total TTC</span>
                    <span>{fmt(doc.totals.totalTtc)} DZD</span>
                  </div>
                </div>
                {doc.account && <AccountSummary account={doc.account} side={side} />}
              </div>
            </div>
            <div className="modal-footer">
              {doc.status === 'validated' && !doc.invoice && (
                <button type="button" className="btn-link danger" style={{ marginRight: 'auto' }} disabled={busy} onClick={cancelDoc} onBlur={() => setConfirmingCancel(false)}>
                  {confirmingCancel ? 'Confirmer l’annulation (le stock sera rétabli) ?' : 'Annuler le bon'}
                </button>
              )}
              <button type="button" className="btn-secondary" onClick={print}>
                Imprimer
              </button>
              {type === 'delivery_note' && doc.status === 'validated' && !doc.invoice && (
                <button type="button" className="btn-primary" disabled={busy} onClick={invoice}>
                  {busy ? 'Facturation…' : 'Générer la facture'}
                </button>
              )}
              {doc.invoice && (
                <button type="button" className="btn-primary" onClick={() => openInvoice(doc.invoice!.id)}>
                  Voir la facture {doc.invoice.number ?? ''}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ───────────────────────── Form ─────────────────────────

interface FormLine {
  productId: string;
  quantity: number;
  unitPrice: string; // '' = automatic
  discountPercent: string;
  taxRateId: string;
  salesOrderLineId?: string;
  description?: string;
  max?: number;
}

/**
 * Creates a bon de livraison, a retour client or a retour fournisseur. A
 * BL can be issued from a commande (`order`): its lines are the commande's
 * remaining quantities, prices fixed by the commande.
 */
export function DocumentFormModal({
  type,
  partners,
  sites,
  products,
  taxRates = [],
  order,
  onClose,
  onCreated,
}: {
  type: TradeDocumentType;
  partners: Partner[];
  sites: Site[];
  products: StockRow[];
  taxRates?: TaxRate[];
  order?: SalesOrderView;
  onClose: () => void;
  onCreated: (doc: TradeDocumentView) => void;
}) {
  const { accessToken } = useAuth();
  const isSupplier = type === 'supplier_return';
  const candidates = partners.filter((p) => (isSupplier ? p.isSupplier : p.isCustomer));
  const [partnerId, setPartnerId] = useState(order?.customerId ?? '');
  const [siteId, setSiteId] = useState(order?.siteId ?? sites[0]?.id ?? '');
  const [notes, setNotes] = useState('');
  const [payment, setPayment] = useState('');
  const [method, setMethod] = useState('especes');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const blank = (): FormLine => ({ productId: '', quantity: 1, unitPrice: '', discountPercent: '', taxRateId: '' });
  const [lines, setLines] = useState<FormLine[]>(() =>
    order
      ? order.lines
          .map((l) => ({
            productId: l.productId ?? '',
            description: l.description,
            salesOrderLineId: l.id,
            max: Math.max(0, l.quantityOrdered - l.quantityInvoiced - l.quantityDelivered - l.quantityInDraft),
            quantity: Math.max(0, l.quantityOrdered - l.quantityInvoiced - l.quantityDelivered - l.quantityInDraft),
            unitPrice: String(l.unitPrice),
            discountPercent: l.discountPercent != null ? String(l.discountPercent) : '',
            taxRateId: l.taxRateId ?? '',
          }))
          .filter((l) => (l.max ?? 0) > 0)
      : [blank()],
  );

  const partner = partners.find((p) => p.id === partnerId);
  const productById = new Map(products.map((p) => [p.productId, p]));
  const siteStock = new Map(products.filter((p) => p.site.id === siteId).map((p) => [p.productId, p.quantityOnHand]));

  function autoPrice(productId: string): number {
    const p = productById.get(productId);
    if (!p) return 0;
    if (isSupplier) return p.averageCost;
    const tier = partner?.priceTier === 2 && p.sellPrice2 != null ? p.sellPrice2 : p.sellPrice;
    return tier ?? 0;
  }
  function lineTotal(l: FormLine) {
    const price = l.unitPrice !== '' ? Number(l.unitPrice) : autoPrice(l.productId);
    const net = l.quantity * price * (1 - (Number(l.discountPercent) || 0) / 100);
    const rate = taxRates.find((t) => t.id === l.taxRateId)?.rate ?? 0;
    return net * (1 + rate / 100);
  }
  const total = lines.reduce((s, l) => s + (l.productId || l.description ? lineTotal(l) : 0), 0);
  const update = (i: number, patch: Partial<FormLine>) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!accessToken) return;
    setError(null);
    const valid = lines.filter((l) => (l.productId || l.salesOrderLineId) && l.quantity > 0);
    if (valid.length === 0) return setError('Ajoutez au moins un article.');
    if (isSupplier && !partnerId) return setError('Choisissez le fournisseur.');
    setSubmitting(true);
    try {
      const doc = await tradeApi.create(accessToken, {
        type,
        siteId,
        partnerId: partnerId || undefined,
        salesOrderId: order?.id,
        notes: notes.trim() || undefined,
        payment: Number(payment) > 0 && partnerId ? { amount: Number(payment), method } : undefined,
        lines: valid.map((l) => ({
          productId: l.salesOrderLineId ? undefined : l.productId,
          salesOrderLineId: l.salesOrderLineId,
          quantity: l.quantity,
          unitPrice: l.unitPrice !== '' ? Number(l.unitPrice) : undefined,
          discountPercent: l.discountPercent !== '' ? Number(l.discountPercent) : undefined,
          taxRateId: l.taxRateId || undefined,
        })),
      });
      toast.success(`${doc.number} enregistré.`);
      notifyDataChanged('partners');
      onCreated(doc);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Échec de l’enregistrement.');
    } finally {
      setSubmitting(false);
    }
  }

  const paymentLabel = type === 'customer_return' ? 'Remboursement au client' : type === 'supplier_return' ? 'Remboursement reçu' : 'Versement du client';

  return (
    <div className="modal-backdrop open">
      <div className="modal form-xl">
        <div className="modal-header">
          <div className="modal-header-titles">
            <h3>
              {order ? `Livrer la commande ${order.number ?? ''}` : `Nouveau ${DOC_LABEL[type].toLowerCase()}`}
            </h3>
            <p className="modal-sub">
              {type === 'delivery_note'
                ? 'Le stock sort à la validation.'
                : type === 'customer_return'
                  ? 'Le stock revient au dépôt à la validation.'
                  : 'Le stock sort à la validation.'}
            </p>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>
        <form className="field-form" onSubmit={submit}>
          <div className="field-grid">
            <div className="field-row">
              <label>{isSupplier ? 'Fournisseur' : 'Client'}</label>
              {order ? (
                <input value={order.customer.name} disabled />
              ) : (
                <SearchableSelect
                  value={partnerId}
                  onChange={setPartnerId}
                  options={candidates.map((p) => ({ value: p.id, label: p.name, sublabel: p.code ?? undefined }))}
                  placeholder={isSupplier ? 'Rechercher un fournisseur…' : 'Rechercher un client…'}
                  emptyLabel={isSupplier ? undefined : 'Client comptoir'}
                />
              )}
            </div>
            <div className="field-row">
              <label>Dépôt</label>
              <select value={siteId} onChange={(e) => setSiteId(e.target.value)} disabled={!!order} required>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {partner && (
            <p className="sub" style={{ margin: '-4px 0 6px' }}>
              Solde actuel : <b className={(isSupplier ? partner.supplierBalance : partner.customerBalance) > 0 ? 'bad' : ''}>{fmt(isSupplier ? partner.supplierBalance : partner.customerBalance)} DZD</b>
              {!isSupplier && partner.priceTier === 2 && ' · tarif gros (Prix 2)'}
            </p>
          )}

          <div className="lines-head">
            <span className="modal-section-label">Articles</span>
            <span className="lines-count">{lines.length}</span>
          </div>
          <div className="line-items">
            <div className="line-item line-item-head">
              <span className="li-grow">Produit</span>
              <span className="li-num">Cartons</span>
              <span className="li-num">Quantité</span>
              <span className="li-money">{isSupplier ? 'Coût unit.' : 'Prix unit. HT'}</span>
              <span className="li-num">Remise %</span>
              {!isSupplier && <span className="li-select">TVA</span>}
              <span className="li-money" style={{ textAlign: 'right' }}>Total</span>
              <span className="li-remove" />
            </div>
            {lines.map((l, i) => {
              const product = productById.get(l.productId);
              const available = siteStock.get(l.productId);
              return (
                <div key={i}>
                  <div className="line-item">
                    <div className="li-grow">
                      {l.salesOrderLineId ? (
                        <input className="control" value={l.description ?? ''} disabled style={{ width: '100%' }} />
                      ) : (
                        <SearchableSelect
                          value={l.productId}
                          onChange={(v) => update(i, { productId: v, unitPrice: '' })}
                          options={Array.from(new Map(products.map((p) => [p.productId, p])).values()).map((p) => ({ value: p.productId, label: p.name, sublabel: p.sku }))}
                          placeholder="Produit…"
                        />
                      )}
                    </div>
                    <CartonInput unitsPerCarton={product?.unitsPerCarton} quantity={l.quantity} onQuantityChange={(q) => update(i, { quantity: q })} />
                    <input
                      className="control li-num"
                      type="number"
                      min={0.001}
                      step="any"
                      max={l.max}
                      value={l.quantity}
                      onChange={(e) => update(i, { quantity: Number(e.target.value) })}
                      aria-label="Quantité"
                      required
                    />
                    <input
                      className="control li-money"
                      type="number"
                      min={0}
                      step="any"
                      value={l.unitPrice}
                      placeholder={l.productId ? fmt(autoPrice(l.productId)) : 'Prix'}
                      onChange={(e) => update(i, { unitPrice: e.target.value })}
                      disabled={!!l.salesOrderLineId}
                      aria-label="Prix unitaire"
                    />
                    <input
                      className="control li-num"
                      type="number"
                      min={0}
                      max={100}
                      step="any"
                      value={l.discountPercent}
                      placeholder="0"
                      onChange={(e) => update(i, { discountPercent: e.target.value })}
                      disabled={!!l.salesOrderLineId}
                      aria-label="Remise %"
                    />
                    {!isSupplier && (
                      <select className="control li-select" value={l.taxRateId} onChange={(e) => update(i, { taxRateId: e.target.value })} disabled={!!l.salesOrderLineId} aria-label="TVA">
                        <option value="">Sans TVA</option>
                        {taxRates.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    )}
                    <span className="li-money li-total">{l.productId || l.salesOrderLineId ? fmt(lineTotal(l)) : '—'}</span>
                    {lines.length > 1 ? (
                      <button type="button" className="li-remove" onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))} aria-label="Retirer la ligne">
                        ✕
                      </button>
                    ) : (
                      <span className="li-remove" />
                    )}
                  </div>
                  {(l.max != null || (available != null && type !== 'customer_return')) && (
                    <div className="line-item-hint">
                      {l.max != null && <>Reste à livrer : {l.max}</>}
                      {l.max != null && available != null && ' · '}
                      {available != null && type !== 'customer_return' && (
                        <span className={available < l.quantity ? 'bad' : ''}>En stock : {available}</span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {!order && (
            <button type="button" className="btn-link" onClick={() => setLines((ls) => [...ls, blank()])}>
              + Ajouter un article
            </button>
          )}

          <div className="doc-form-bottom">
            <div className="field-row" style={{ flex: 1 }}>
              <label>Observation</label>
              <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optionnel" />
            </div>
            <div className="doc-form-pay">
              <div className="lines-total" style={{ marginTop: 0 }}>
                <span>Total TTC</span>
                <strong>{fmt(total)} DZD</strong>
              </div>
              {partnerId ? (
                <div className="field-row" style={{ marginBottom: 0 }}>
                  <label>{paymentLabel}</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input className="control" style={{ flex: 1 }} inputMode="decimal" placeholder="0,00" value={payment} onChange={(e) => setPayment(e.target.value)} />
                    <select className="control" value={method} onChange={(e) => setMethod(e.target.value)} style={{ width: 120 }}>
                      {PAYMENT_METHODS.map((m) => (
                        <option key={m.value} value={m.value}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  {type === 'delivery_note' && (
                    <button type="button" className="btn-link" style={{ alignSelf: 'flex-start', marginTop: 6 }} onClick={() => setPayment(total.toFixed(2))}>
                      Payé comptant ({fmt(total)})
                    </button>
                  )}
                </div>
              ) : (
                type !== 'supplier_return' && <p className="sub" style={{ margin: 0 }}>Vente comptoir : pas de solde client.</p>
              )}
            </div>
          </div>

          {error && <div className="error-banner">{error}</div>}
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Annuler
            </button>
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? 'Enregistrement…' : `Valider le ${DOC_LABEL[type].toLowerCase()}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
