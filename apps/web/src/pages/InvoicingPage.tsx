import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useListControls } from '../lib/ListControls';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ActionMenu } from '../lib/ActionMenu';
import { AppShell } from '../lib/AppShell';
import { Icon } from '../lib/Icon';
import { useAuth } from '../lib/auth-context';
import { ApiError, InvoiceView, Partner, Site, StockRow, TaxRate, invoicingApi, sitesApi, stockApi } from '../lib/api';
import { useDataChangeListener } from '../lib/data-events';
import { CartonInput } from '../lib/CartonInput';
import { SearchableSelect } from '../lib/SearchableSelect';
import { toast } from '../lib/toast';
import '../lib/data-views.css';

const STATUS_LABEL: Record<InvoiceView['status'], string> = {
  draft: 'Brouillon',
  unpaid: 'Impayée',
  partially_paid: 'Partielle',
  paid: 'Payée',
  void: 'Annulée',
  proforma: 'Proforma',
};
const STATUS_PILL: Record<InvoiceView['status'], string> = {
  draft: 'info',
  unpaid: 'danger',
  partially_paid: 'warning',
  paid: 'success',
  void: 'danger',
  proforma: 'info',
};

const FILTERS: { label: string; value: string | undefined }[] = [
  { label: 'Toutes', value: undefined },
  { label: 'Impayées', value: 'unpaid' },
  { label: 'Partielles', value: 'partially_paid' },
  { label: 'Payées', value: 'paid' },
  { label: 'Proformas', value: 'proforma' },
];

export function InvoicingPage() {
  const { accessToken, can } = useAuth();
  const [invoices, setInvoices] = useState<InvoiceView[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [taxRates, setTaxRates] = useState<TaxRate[]>([]);
  const [products, setProducts] = useState<StockRow[]>([]);
  const [filter, setFilter] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<InvoiceView | null>(null);
  const [showCreate, setShowCreate] = useState<false | 'invoice' | 'proforma'>(false);
  const [showTaxRateForm, setShowTaxRateForm] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const [invoiceRows, partnerRows, siteRows, taxRows, productRows] = await Promise.all([
        invoicingApi.listInvoices(accessToken, filter),
        invoicingApi.listPartners(accessToken),
        sitesApi.list(accessToken),
        invoicingApi.listTaxRates(accessToken),
        stockApi.listProducts(accessToken, 'all'),
      ]);
      setInvoices(filter === 'proforma' ? invoiceRows : invoiceRows.filter((i) => i.kind !== 'proforma'));
      setPartners(partnerRows);
      setSites(siteRows);
      setTaxRates(taxRows);
      setProducts(productRows);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur de chargement.');
    } finally {
      setLoading(false);
    }
  }, [accessToken, filter]);

  useEffect(() => {
    load();
  }, [load]);

  useDataChangeListener('partners', load);
  useDataChangeListener('sites', load);

  async function openInvoice(id: string) {
    if (!accessToken) return;
    setPdfError(null);
    const detail = await invoicingApi.getInvoice(accessToken, id);
    setSelected(detail);
  }

  // Deep link: /invoicing?open=<id> (from a bon de livraison or a commande).
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const id = searchParams.get('open');
    if (!id || !accessToken) return;
    invoicingApi
      .getInvoice(accessToken, id)
      .then(setSelected)
      .catch(() => toast.error('Facture introuvable.'));
    setSearchParams({}, { replace: true });
  }, [searchParams, accessToken]);

  async function refreshSelected() {
    if (!accessToken || !selected) return;
    setSelected(await invoicingApi.getInvoice(accessToken, selected.id));
    load();
  }

  async function openPdf() {
    if (!accessToken || !selected) return;
    setPdfError(null);
    try {
      const blob = await invoicingApi.fetchPdf(accessToken, selected.id);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
    } catch (err) {
      setPdfError(err instanceof ApiError ? err.message : 'Impossible de générer le PDF.');
    }
  }

  const PAY_MODE: Record<string, string> = { especes: 'Espèces', cheque: 'Chèque', virement: 'Virement', terme: 'À terme' };
  const list = useListControls(invoices, {
    id: 'invoices',
    noun: ['facture', 'factures'],
    searchPlaceholder: 'N°, client, NIF, produit…',
    search: (i) => [i.number, i.partner?.name, i.partner?.nif, ...(i.deliveryNotes ?? []).map((d) => d.number), ...i.lines.map((l) => l.description)],
    filters: [
      {
        key: 'type',
        label: 'Type',
        type: 'select',
        value: (i) => i.type,
        options: [
          { value: 'CUSTOMER', label: 'Factures clients' },
          { value: 'SUPPLIER', label: 'Factures fournisseurs' },
        ],
      },
      { key: 'partner', label: 'Client / fournisseur', type: 'select', value: (i) => i.partner?.name ?? 'Client comptant' },
      { key: 'date', label: 'Date', type: 'dates', value: (i) => i.finalizedAt ?? i.issuedAt },
      { key: 'mode', label: 'Mode de paiement', type: 'select', value: (i) => (i.paymentMode ? PAY_MODE[i.paymentMode] : null) },
      { key: 'total', label: 'Montant TTC', type: 'range', unit: 'DA', value: (i) => i.totals.totalTtc },
      { key: 'rest', label: 'Avec reste à payer', type: 'flag', test: (i) => i.balance > 0.004 && i.status !== 'void' && i.kind !== 'proforma' },
      { key: 'fromBl', label: 'Issues de bons de livraison', type: 'flag', test: (i) => i.fromDocuments },
      { key: 'drafts', label: 'Brouillons', type: 'flag', test: (i) => i.status === 'draft' },
    ],
    sorts: [
      { key: 'number', label: 'N°', value: (i) => i.number, desc: true },
      { key: 'partner', label: 'Partenaire', value: (i) => i.partner?.name ?? 'Client comptant' },
      { key: 'date', label: 'Date', value: (i) => i.finalizedAt ?? i.issuedAt, desc: true },
      { key: 'total', label: 'Montant TTC', value: (i) => i.totals.totalTtc, desc: true },
      { key: 'rest', label: 'Reste à payer', value: (i) => (i.kind === 'proforma' || i.status === 'void' ? null : i.balance), desc: true },
      { key: 'status', label: 'Statut', value: (i) => STATUS_LABEL[i.status] },
    ],
  });

  const stats = {
    totalMonth: invoices
      .filter((i) => i.status !== 'draft' && i.status !== 'void' && i.kind !== 'proforma')
      .reduce((s, i) => s + i.totals.totalTtc, 0),
    unpaid: invoices.filter((i) => i.status === 'unpaid' || i.status === 'partially_paid').reduce((s, i) => s + i.balance, 0),
    overdueCount: invoices.filter((i) => i.status === 'unpaid').length,
  };

  return (
    <AppShell>
      <div className="panel-head">
        <div>
          <h2>Gestion des Factures</h2>
          <div className="sub">Numérotation séquentielle unique — organisation entière</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {(can('invoicing.invoice.create') || can('invoicing.taxrate.write')) && (
            <ActionMenu
              items={[
                ...(can('invoicing.invoice.create') ? [{ label: 'Nouvelle proforma', hint: 'Sans effet sur le stock ni le solde', icon: 'receipt' as const, onClick: () => setShowCreate('proforma') }] : []),
                ...(can('invoicing.taxrate.write') ? [{ label: 'Ajouter un taux de TVA', icon: 'calculator' as const, onClick: () => setShowTaxRateForm(true) }] : []),
              ]}
            />
          )}
          {can('invoicing.invoice.create') && (
            <button className="btn-primary" onClick={() => setShowCreate('invoice')}>
              <Icon name="plus" size={16} /> Nouvelle facture
            </button>
          )}
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="stat-strip">
        <div className="stat-card good">
          <div className="num">{stats.totalMonth.toFixed(2)}</div>
          <div className="label">Facturé (DZD)</div>
        </div>
        <div className="stat-card bad">
          <div className="num">{stats.unpaid.toFixed(2)}</div>
          <div className="label">Solde impayé (DZD)</div>
        </div>
        <div className="stat-card warn">
          <div className="num">{stats.overdueCount}</div>
          <div className="label">Factures impayées</div>
        </div>
      </div>

      {list.toolbar(
        <div className="toggle-row">
          {FILTERS.map((f) => (
            <button key={f.label} className={`toggle-btn${filter === f.value ? ' on' : ''}`} onClick={() => setFilter(f.value)}>
              {f.label}
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
                {list.th('number', 'N° Facture')}
                {list.th('partner', 'Partenaire')}
                <th>NIF</th>
                {list.th('date', 'Date')}
                {list.th('total', 'Montant TTC', 'num')}
                {list.th('rest', 'Reste', 'num')}
                {list.th('status', 'Statut')}
              </tr>
            </thead>
            <tbody>
              {list.rows.map((inv) => (
                <tr key={inv.id} className="clickable" onClick={() => openInvoice(inv.id)}>
                  <td className="mono">{inv.number ?? `(brouillon ${inv.id.slice(0, 8)})`}</td>
                  <td>{inv.partner?.name ?? 'Client comptant'}</td>
                  <td className="mono muted">{inv.partner?.nif ?? '—'}</td>
                  <td className="mono">{new Date(inv.finalizedAt ?? inv.issuedAt).toLocaleDateString('fr-FR')}</td>
                  <td className="num">{inv.totals.totalTtc.toFixed(2)}</td>
                  <td className={`num ${inv.kind !== 'proforma' && inv.status !== 'void' && inv.balance > 0.004 ? 'bad' : 'muted'}`}>
                    {inv.kind === 'proforma' || inv.status === 'void' || inv.balance <= 0.004 ? '—' : inv.balance.toFixed(2)}
                  </td>
                  <td>
                    <span className={`pill ${STATUS_PILL[inv.status]}`}>{STATUS_LABEL[inv.status]}</span>
                  </td>
                </tr>
              ))}
              {list.rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted" style={{ textAlign: 'center', padding: '24px 0' }}>
                    {list.filtered ? (
                      <>
                        Aucun résultat pour ces filtres.{' '}
                        <button type="button" className="btn-link" onClick={list.reset}>
                          Effacer les filtres
                        </button>
                      </>
                    ) : (
                      'Aucune facture pour ce filtre.'
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <InvoiceModal
          invoice={selected}
          onClose={() => setSelected(null)}
          onFinalize={async () => {
            if (!accessToken) return;
            try {
              await invoicingApi.finalizeInvoice(accessToken, selected.id);
              toast.success('Facture finalisée.');
              await refreshSelected();
            } catch (err) {
              const message = err instanceof ApiError ? err.message : 'Échec de la finalisation.';
              setPdfError(message);
              toast.error(message);
            }
          }}
          onRecordPayment={async (amount) => {
            if (!accessToken) return;
            try {
              await invoicingApi.recordPayment(accessToken, selected.id, { amount });
              toast.success('Paiement enregistré.');
              await refreshSelected();
            } catch (err) {
              const message = err instanceof ApiError ? err.message : "Échec de l'enregistrement du paiement.";
              setPdfError(message);
              toast.error(message);
            }
          }}
          onResetPayments={async () => {
            if (!accessToken) return;
            try {
              await invoicingApi.resetPayments(accessToken, selected.id);
              toast.success('Paiements réinitialisés.');
              await refreshSelected();
            } catch (err) {
              const message = err instanceof ApiError ? err.message : "Échec de l'annulation des paiements.";
              setPdfError(message);
              toast.error(message);
            }
          }}
          onOpenPdf={openPdf}
          onConvert={async () => {
            if (!accessToken) return;
            try {
              const draft = await invoicingApi.convertProforma(accessToken, selected.id);
              toast.success('Facture brouillon créée depuis la proforma.');
              setFilter(undefined);
              setSelected(draft);
              load();
            } catch (err) {
              const message = err instanceof ApiError ? err.message : 'Échec de la conversion.';
              setPdfError(message);
              toast.error(message);
            }
          }}
          onDelete={async () => {
            if (!accessToken) return;
            try {
              await invoicingApi.deleteInvoice(accessToken, selected.id);
              toast.success('Facture supprimée.');
              setSelected(null);
              load();
            } catch (err) {
              const message = err instanceof ApiError ? err.message : 'Échec de la suppression.';
              setPdfError(message);
              toast.error(message);
            }
          }}
          pdfError={pdfError}
        />
      )}

      {showCreate && (
        <CreateInvoiceModal
          initialKind={showCreate}
          partners={partners}
          sites={sites}
          taxRates={taxRates}
          products={products}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            load();
          }}
        />
      )}
      {showTaxRateForm && (
        <TaxRateFormModal
          onClose={() => setShowTaxRateForm(false)}
          onSaved={() => {
            setShowTaxRateForm(false);
            load();
          }}
        />
      )}
    </AppShell>
  );
}

// A brand-new organization has no tax rates at all — the "Nouvelle facture"
// modal's TVA dropdown only ever showed "Aucune", with no way through the
// UI to add one, even though POST /invoicing/tax-rates already existed and
// worked (found by trying to invoice a real wholesale client and hitting a
// dead end at 19% VAT, mandatory on an Algerian invoice under Décret
// 05-468). Mirrors PartnerFormModal's own pattern.
function TaxRateFormModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { accessToken } = useAuth();
  const [name, setName] = useState('');
  const [rate, setRate] = useState('19');
  const [isDefault, setIsDefault] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!accessToken) return;
    setSubmitting(true);
    setError(null);
    try {
      await invoicingApi.createTaxRate(accessToken, { name, rate: Number(rate), isDefault });
      toast.success('Taux de TVA créé.');
      onSaved();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Échec de la création du taux de TVA.';
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
            <h3>Nouveau taux de TVA</h3>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>
        <form onSubmit={handleSubmit} className="field-form">
          <div className="field-row">
            <label>Nom</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex. TVA normale" required />
          </div>
          <div className="field-row">
            <label>Taux (%)</label>
            <input type="number" min="0" max="100" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} required />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
            Taux par défaut
          </label>
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

function InvoiceModal({
  invoice,
  onClose,
  onFinalize,
  onRecordPayment,
  onResetPayments,
  onOpenPdf,
  onDelete,
  onConvert,
  pdfError,
}: {
  invoice: InvoiceView;
  onClose: () => void;
  onConvert: () => void;
  onFinalize: () => void;
  onRecordPayment: (amount: number) => void;
  onResetPayments: () => void;
  onOpenPdf: () => void;
  onDelete: () => void;
  pdfError: string | null;
}) {
  const { can } = useAuth();
  const [paymentAmount, setPaymentAmount] = useState('');
  const navigate = useNavigate();
  // A second click is required before actually resetting — this deletes
  // every payment row against the invoice, so a stray click on "reset"
  // itself shouldn't be able to wipe out a real payment as easily as the
  // mistake it's meant to fix.
  const [confirmingReset, setConfirmingReset] = useState(false);
  // Same double-click-to-arm pattern, for the same reason, on the facture
  // itself rather than just its payments.
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  return (
    <div className="modal-backdrop open">
      <div className="modal wide">
        <div className="modal-header">
          <div className="modal-header-titles">
            <h3>
              {invoice.kind === 'proforma' ? 'Facture proforma' : 'Facture'} {invoice.number ?? '(brouillon)'}{' '}
              <span className={`pill ${STATUS_PILL[invoice.status]}`}>{STATUS_LABEL[invoice.status]}</span>
            </h3>
            <p className="modal-sub">{invoice.partner?.name ?? 'Client comptant'}</p>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>

        {invoice.deliveryNotes && invoice.deliveryNotes.length > 0 && (
          <div className="link-banner">
            <span>
              Issue {invoice.deliveryNotes.length > 1 ? 'des bons' : 'du bon'} de livraison{' '}
              {invoice.deliveryNotes.map((d, i) => (
                <span key={d.id}>
                  {i > 0 && ', '}
                  <button type="button" className="btn-link" style={{ margin: 0, padding: '0 2px' }} onClick={() => navigate(`/sales?doc=${d.id}`)}>
                    {d.number}
                  </button>
                </span>
              ))}
            </span>
            <span className="sub">Stock déjà sorti avec le BL · versements du BL inclus</span>
          </div>
        )}
        <div className="modal-section" style={{ marginTop: 0 }}>
          <table className="lot-mini-table">
            <thead>
              <tr>
                <th>Désignation</th>
                <th className="num">Qté</th>
                <th className="num">P.U. HT</th>
                <th className="num">TVA</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lines.map((l) => (
                <tr key={l.id}>
                  <td>{l.description}</td>
                  <td className="num">{l.quantity}</td>
                  <td className="num">{l.unitPrice.toFixed(2)}</td>
                  <td className="num muted">{l.taxRate ? `${l.taxRate.rate}%` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="totals">
          <div className="totals-row">
            <span>Total HT</span>
            <span>{invoice.totals.totalHt.toFixed(2)} DZD</span>
          </div>
          <div className="totals-row">
            <span>TVA</span>
            <span>{invoice.totals.totalTax.toFixed(2)} DZD</span>
          </div>
          {invoice.totals.stampDuty > 0 ? (
            <>
              <div className="totals-row">
                <span>Total TTC</span>
                <span>{invoice.totals.totalTtc.toFixed(2)} DZD</span>
              </div>
              <div className="totals-row">
                <span>Droit de timbre</span>
                <span>{invoice.totals.stampDuty.toFixed(2)} DZD</span>
              </div>
              <div className="totals-row grand">
                <span>Net à payer</span>
                <span>{invoice.totals.netToPay.toFixed(2)} DZD</span>
              </div>
            </>
          ) : (
            <div className="totals-row grand">
              <span>Total TTC</span>
              <span>{invoice.totals.totalTtc.toFixed(2)} DZD</span>
            </div>
          )}
          <div className="totals-words">
            <div>{invoice.totals.totalInWordsFr}</div>
            <div dir="rtl">{invoice.totals.totalInWordsAr}</div>
          </div>
        </div>

        {invoice.status !== 'draft' && invoice.status !== 'void' && invoice.kind !== 'proforma' && can('invoicing.payment.create') && (
          <div className="modal-section">
            <div className="modal-section-label">Paiements</div>
            <div className="pay-progress" aria-hidden="true">
              <span style={{ width: `${invoice.totals.totalTtc > 0 ? Math.min(100, (invoice.totalPaid / invoice.totals.totalTtc) * 100) : 0}%` }} />
            </div>
            <div className="pay-summary">
              <span>
                Payé <b>{invoice.totalPaid.toFixed(2)} DZD</b>
              </span>
              <span>
                Reste <b className={invoice.balance > 0 ? 'bad' : ''}>{invoice.balance.toFixed(2)} DZD</b>
              </span>
            </div>
            {invoice.balance > 0 && (
              <form
                className="pay-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const amount = Number(paymentAmount);
                  if (amount > 0) {
                    onRecordPayment(amount);
                    setPaymentAmount('');
                  }
                }}
              >
                <input className="control" inputMode="decimal" placeholder="Montant reçu" value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} />
                <button type="submit" className="btn-secondary" disabled={!(Number(paymentAmount) > 0)}>
                  Encaisser
                </button>
                <button type="button" className="btn-link" onClick={() => onRecordPayment(invoice.balance)}>
                  Tout encaisser ({invoice.balance.toFixed(2)})
                </button>
              </form>
            )}
            {invoice.totalPaid > 0 && can('invoicing.payment.create') && (
              <button
                type="button"
                className="btn-link subtle"
                style={{ marginTop: 10 }}
                onClick={() => {
                  if (confirmingReset) {
                    onResetPayments();
                    setConfirmingReset(false);
                  } else {
                    setConfirmingReset(true);
                  }
                }}
                onBlur={() => setConfirmingReset(false)}
              >
                {confirmingReset ? 'Confirmer : annuler tous les paiements ?' : 'Annuler les paiements enregistrés'}
              </button>
            )}
          </div>
        )}

        {pdfError && <div className="error-banner">{pdfError}</div>}

        <div className="modal-footer">
          {can('invoicing.invoice.delete') ? (
            <button
              type="button"
              className="btn-link danger"
              style={{ marginRight: 'auto' }}
              onClick={() => (confirmingDelete ? onDelete() : setConfirmingDelete(true))}
              onBlur={() => setConfirmingDelete(false)}
            >
              {confirmingDelete ? 'Confirmer la suppression ?' : 'Supprimer'}
            </button>
          ) : (
            <span style={{ marginRight: 'auto' }} />
          )}
          {invoice.status !== 'draft' && (
            <button className="btn-primary" onClick={onOpenPdf}>
              Imprimer / PDF
            </button>
          )}
          {invoice.type === 'CUSTOMER' && invoice.status === 'draft' && can('invoicing.invoice.finalize') && (
            <button className="btn-primary" onClick={onFinalize}>
              Finaliser la facture
            </button>
          )}
          {invoice.kind === 'proforma' && can('invoicing.invoice.create') && (
            <button className="btn-primary" onClick={onConvert}>
              Convertir en facture
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

interface DraftLine {
  productId: string; // '' = free-text/service line, no stock impact
  description: string;
  quantity: string;
  unitPrice: string;
  taxRateId: string;
}

function CreateInvoiceModal({
  partners,
  sites,
  taxRates,
  products,
  initialKind,
  onClose,
  onCreated,
}: {
  initialKind: 'invoice' | 'proforma';
  partners: Partner[];
  sites: Site[];
  taxRates: TaxRate[];
  products: StockRow[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const { accessToken } = useAuth();
  const [siteId, setSiteId] = useState(sites[0]?.id ?? '');
  const [partnerId, setPartnerId] = useState('');
  const [kind, setKind] = useState<'invoice' | 'proforma'>(initialKind);
  const [paymentMode, setPaymentMode] = useState<'especes' | 'cheque' | 'virement' | 'terme'>('especes');
  const defaultTaxRateId = taxRates.find((t) => t.isDefault)?.id ?? '';
  const blankLine = (): DraftLine => ({ productId: '', description: '', quantity: '1', unitPrice: '', taxRateId: defaultTaxRateId });
  const [lines, setLines] = useState<DraftLine[]>([blankLine()]);
  const [error, setError] = useState<string | null>(null);

  // One row per distinct product (StockRow is one row per product+site) —
  // a real wholesale order has several different products on the SAME
  // invoice (yaourt + huile + thon + eau...), which the single-line form
  // this replaced could never express: creating one invoice per product for
  // a real bulk order isn't a workaround, it's a dead end (a separate
  // gapless-numbered document per item, for one delivery). Found by trying
  // to actually invoice a wholesale client's order.
  const uniqueProducts = Array.from(new Map(products.map((p) => [p.productId, p])).values());

  function updateLine(index: number, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  function selectProduct(index: number, productId: string) {
    const product = uniqueProducts.find((p) => p.productId === productId);
    updateLine(index, { productId, description: product ? `${product.sku} — ${product.name}` : '' });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!accessToken) return;
    setError(null);
    try {
      await invoicingApi.createInvoice(accessToken, {
        type: 'CUSTOMER',
        kind,
        siteId,
        partnerId: partnerId || undefined,
        paymentMode,
        lines: lines.map((l) => ({
          productId: l.productId || undefined,
          description: l.description,
          quantity: Number(l.quantity),
          unitPrice: Number(l.unitPrice),
          taxRateId: l.taxRateId || undefined,
        })),
      });
      toast.success(kind === 'proforma' ? 'Proforma créée.' : 'Facture brouillon créée.');
      onCreated();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Échec de la création.';
      setError(message);
      toast.error(message);
    }
  }

  return (
    <div className="modal-backdrop open">
      <div className="modal xwide">
        <div className="modal-header">
          <div className="modal-header-titles">
            <h3>{kind === 'proforma' ? 'Nouvelle proforma' : 'Nouvelle facture'}</h3>
            <p className="modal-sub">
              {kind === 'proforma' ? 'Numérotée tout de suite, sans mouvement de stock ni effet sur le solde.' : 'Créée en brouillon, numérotée à la finalisation.'}
            </p>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>
        <form className="field-form" onSubmit={submit}>
          <div className="toggle-row" style={{ maxWidth: 320 }}>
            <button type="button" className={`toggle-btn${kind === 'invoice' ? ' on' : ''}`} onClick={() => setKind('invoice')}>
              Facture
            </button>
            <button type="button" className={`toggle-btn${kind === 'proforma' ? ' on' : ''}`} onClick={() => setKind('proforma')}>
              Proforma
            </button>
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
            <label>Client</label>
            <SearchableSelect
              value={partnerId}
              onChange={setPartnerId}
              placeholder="Rechercher un client…"
              emptyLabel="Client comptant"
              options={partners.filter((p) => p.isCustomer).map((p) => ({ value: p.id, label: p.name, sublabel: p.nif }))}
            />
          </div>
          </div>
          <div className="field-row">
            <label>Mode de paiement</label>
            <div className="toggle-row" style={{ margin: 0, maxWidth: 460 }}>
              {(
                [
                  ['especes', 'Espèces'],
                  ['cheque', 'Chèque'],
                  ['virement', 'Virement'],
                  ['terme', 'À terme'],
                ] as const
              ).map(([v, label]) => (
                <button key={v} type="button" className={`toggle-btn${paymentMode === v ? ' on' : ''}`} onClick={() => setPaymentMode(v)}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="lines-head">
            <span className="modal-section-label">Articles</span>
            <span className="lines-count">{lines.length}</span>
          </div>
          <div className="line-items">
            <div className="line-item line-item-head">
              <span className="li-grow">Produit (vide = service)</span>
              <span className="li-grow">Désignation</span>
              <span className="li-num">Cartons</span>
              <span className="li-num">Quantité</span>
              <span className="li-money">Prix unitaire HT</span>
              <span className="li-select">TVA</span>
              <span className="li-remove" />
            </div>
            {lines.map((line, i) => {
              const product = uniqueProducts.find((p) => p.productId === line.productId);
              return (
                <div key={i} className="line-item">
                  <div className="li-grow">
                    <SearchableSelect
                      value={line.productId}
                      onChange={(v) => selectProduct(i, v)}
                      placeholder="Rechercher un produit…"
                      emptyLabel="— aucun (service) —"
                      options={uniqueProducts.map((p) => ({ value: p.productId, label: p.name, sublabel: p.sku }))}
                    />
                  </div>
                  <input
                    value={line.description}
                    onChange={(e) => updateLine(i, { description: e.target.value })}
                    placeholder="Désignation"
                    aria-label="Désignation"
                    className="control li-grow"
                    required
                  />
                  {line.productId ? (
                    <CartonInput unitsPerCarton={product?.unitsPerCarton} quantity={Number(line.quantity) || 0} onQuantityChange={(q) => updateLine(i, { quantity: String(q) })} />
                  ) : (
                    <span className="li-num" />
                  )}
                  <input
                    type="number"
                    min="0.001"
                    step="0.001"
                    value={line.quantity}
                    onChange={(e) => updateLine(i, { quantity: e.target.value })}
                    placeholder="Qté"
                    aria-label="Quantité"
                    className="control li-num"
                    required
                  />
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={line.unitPrice}
                    onChange={(e) => updateLine(i, { unitPrice: e.target.value })}
                    placeholder="Prix HT"
                    aria-label="Prix unitaire HT"
                    className="control li-money"
                    required
                  />
                  <select value={line.taxRateId} onChange={(e) => updateLine(i, { taxRateId: e.target.value })} className="control li-select" aria-label="TVA">
                    <option value="">Aucune TVA</option>
                    {taxRates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.rate}%)
                      </option>
                    ))}
                  </select>
                  {lines.length > 1 ? (
                    <button type="button" className="li-remove" onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))} aria-label="Retirer la ligne" title="Retirer">
                      ✕
                    </button>
                  ) : (
                    <span className="li-remove" />
                  )}
                </div>
              );
            })}
          </div>
          <button type="button" className="btn-link" onClick={() => setLines((prev) => [...prev, blankLine()])} style={{ marginBottom: 10 }}>
            + Ajouter un article
          </button>

          {error && <div className="error-banner">{error}</div>}
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Annuler
            </button>
            <button type="submit" className="btn-primary">
              {kind === 'proforma' ? 'Créer la proforma' : 'Créer (brouillon)'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default InvoicingPage;
