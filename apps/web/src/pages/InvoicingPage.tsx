import { FormEvent, useCallback, useEffect, useState } from 'react';
import { AppShell } from '../lib/AppShell';
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
};
const STATUS_PILL: Record<InvoiceView['status'], string> = {
  draft: 'info',
  unpaid: 'danger',
  partially_paid: 'warning',
  paid: 'success',
  void: 'danger',
};

const FILTERS: { label: string; value: string | undefined }[] = [
  { label: 'Toutes', value: undefined },
  { label: 'Impayées', value: 'unpaid' },
  { label: 'Partielles', value: 'partially_paid' },
  { label: 'Payées', value: 'paid' },
];

export function InvoicingPage() {
  const { accessToken } = useAuth();
  const [invoices, setInvoices] = useState<InvoiceView[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [taxRates, setTaxRates] = useState<TaxRate[]>([]);
  const [products, setProducts] = useState<StockRow[]>([]);
  const [filter, setFilter] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<InvoiceView | null>(null);
  const [showCreate, setShowCreate] = useState(false);
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
      setInvoices(invoiceRows);
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

  const stats = {
    totalMonth: invoices
      .filter((i) => i.status !== 'draft' && i.status !== 'void')
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
          <button className="btn-secondary" onClick={() => setShowTaxRateForm(true)}>
            + Taux de TVA
          </button>
          <button className="btn-primary" onClick={() => setShowCreate(true)}>
            + Nouvelle facture
          </button>
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

      <div className="toggle-row" style={{ maxWidth: 420 }}>
        {FILTERS.map((f) => (
          <button key={f.label} className={`toggle-btn${filter === f.value ? ' on' : ''}`} onClick={() => setFilter(f.value)}>
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="sub">Chargement…</p>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>N° Facture</th>
                <th>Partenaire</th>
                <th>NIF</th>
                <th>Date</th>
                <th className="num">Montant TTC</th>
                <th>Statut</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id} className="clickable" onClick={() => openInvoice(inv.id)}>
                  <td className="mono">{inv.number ?? `(brouillon ${inv.id.slice(0, 8)})`}</td>
                  <td>{inv.partner?.name ?? 'Client comptant'}</td>
                  <td className="mono muted">{inv.partner?.nif ?? '—'}</td>
                  <td className="mono">{new Date(inv.finalizedAt ?? inv.issuedAt).toLocaleDateString('fr-FR')}</td>
                  <td className="num">{inv.totals.totalTtc.toFixed(2)}</td>
                  <td>
                    <span className={`pill ${STATUS_PILL[inv.status]}`}>{STATUS_LABEL[inv.status]}</span>
                  </td>
                </tr>
              ))}
              {invoices.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted" style={{ textAlign: 'center', padding: '24px 0' }}>
                    Aucune facture pour ce filtre.
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
  pdfError,
}: {
  invoice: InvoiceView;
  onClose: () => void;
  onFinalize: () => void;
  onRecordPayment: (amount: number) => void;
  onResetPayments: () => void;
  onOpenPdf: () => void;
  onDelete: () => void;
  pdfError: string | null;
}) {
  const [paymentAmount, setPaymentAmount] = useState('');
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
              Facture {invoice.number ?? '(brouillon)'}{' '}
              <span className={`pill ${STATUS_PILL[invoice.status]}`}>{STATUS_LABEL[invoice.status]}</span>
            </h3>
            <p className="modal-sub">{invoice.partner?.name ?? 'Client comptant'}</p>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>

        <div className="modal-section">
          <div className="modal-section-label">Lignes</div>
          <table className="lot-mini-table">
            <thead>
              <tr>
                <th>Désignation</th>
                <th>Qté</th>
                <th>P.U. HT</th>
                <th>TVA</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lines.map((l) => (
                <tr key={l.id}>
                  <td>{l.description}</td>
                  <td className="mono">{l.quantity}</td>
                  <td className="mono">{l.unitPrice.toFixed(2)}</td>
                  <td className="mono">{l.taxRate ? `${l.taxRate.rate}%` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="note-box" style={{ marginTop: 14 }}>
          <div>
            Total HT : <b className="mono">{invoice.totals.totalHt.toFixed(2)} DZD</b> — TVA :{' '}
            <b className="mono">{invoice.totals.totalTax.toFixed(2)} DZD</b> — Total TTC :{' '}
            <b className="mono">{invoice.totals.totalTtc.toFixed(2)} DZD</b>
          </div>
          <div style={{ marginTop: 8, fontStyle: 'italic' }}>{invoice.totals.totalInWordsFr}</div>
          <div dir="rtl" style={{ marginTop: 4, fontStyle: 'italic' }}>
            {invoice.totals.totalInWordsAr}
          </div>
          <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
            <span className="badge-lang">FR</span>
            <span className="badge-lang">AR — عربي</span>
          </div>
        </div>

        {invoice.status !== 'draft' && invoice.status !== 'void' && (
          <p className="sub" style={{ marginTop: 10 }}>
            Payé : <b className="mono">{invoice.totalPaid.toFixed(2)}</b> DZD — Solde restant : <b className="mono">{invoice.balance.toFixed(2)}</b> DZD
          </p>
        )}

        {pdfError && <div className="error-banner">{pdfError}</div>}

        <div className="modal-footer" style={{ flexWrap: 'wrap' }}>
          {invoice.type === 'CUSTOMER' && invoice.status === 'draft' && (
            <button className="btn-primary" onClick={onFinalize}>
              Finaliser
            </button>
          )}
          {invoice.status !== 'draft' && invoice.status !== 'void' && invoice.balance > 0 && (
            <>
              <input
                className="mono"
                style={{ width: 110, padding: '9px 10px', borderRadius: 6, border: '1px solid var(--border)' }}
                placeholder="Montant"
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
              />
              <button
                className="btn-secondary"
                onClick={() => {
                  const amount = Number(paymentAmount);
                  if (amount > 0) {
                    onRecordPayment(amount);
                    setPaymentAmount('');
                  }
                }}
              >
                Enregistrer paiement
              </button>
              <button className="btn-secondary" onClick={() => onRecordPayment(invoice.balance)}>
                Marquer payée intégralement
              </button>
            </>
          )}
          {invoice.status !== 'draft' && invoice.status !== 'void' && invoice.totalPaid > 0 && (
            <button
              className="btn-link"
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
              {confirmingReset ? 'Confirmer — annuler tous les paiements ?' : 'Paiement erroné ? Annuler les paiements'}
            </button>
          )}
          {invoice.status !== 'draft' && (
            <>
              <button className="btn-secondary" onClick={onOpenPdf}>
                Télécharger PDF
              </button>
              <button className="btn-primary" onClick={onOpenPdf}>
                Imprimer
              </button>
            </>
          )}
          <button
            type="button"
            className="btn-link danger"
            onClick={() => (confirmingDelete ? onDelete() : setConfirmingDelete(true))}
            onBlur={() => setConfirmingDelete(false)}
          >
            {confirmingDelete ? 'Confirmer la suppression ?' : 'Supprimer la facture'}
          </button>
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
  onClose,
  onCreated,
}: {
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
        siteId,
        partnerId: partnerId || undefined,
        lines: lines.map((l) => ({
          productId: l.productId || undefined,
          description: l.description,
          quantity: Number(l.quantity),
          unitPrice: Number(l.unitPrice),
          taxRateId: l.taxRateId || undefined,
        })),
      });
      toast.success('Facture créée.');
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
            <h3>Nouvelle facture</h3>
            <p className="modal-sub">Client (facultatif — laissez vide pour une vente comptoir).</p>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>
        <form className="field-form" onSubmit={submit}>
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

          <div className="modal-section-label">Lignes</div>
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
            + Ajouter une ligne
          </button>

          {error && <div className="error-banner">{error}</div>}
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Annuler
            </button>
            <button type="submit" className="btn-primary">
              Créer (brouillon)
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default InvoicingPage;
