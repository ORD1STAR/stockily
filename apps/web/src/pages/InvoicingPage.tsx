import { FormEvent, useCallback, useEffect, useState } from 'react';
import { AppShell } from '../lib/AppShell';
import { useAuth } from '../lib/auth-context';
import { ApiError, InvoiceView, Partner, Site, TaxRate, invoicingApi, sitesApi } from '../lib/api';
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
  const [filter, setFilter] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<InvoiceView | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const [invoiceRows, partnerRows, siteRows, taxRows] = await Promise.all([
        invoicingApi.listInvoices(accessToken, filter),
        invoicingApi.listPartners(accessToken),
        sitesApi.list(accessToken),
        invoicingApi.listTaxRates(accessToken),
      ]);
      setInvoices(invoiceRows);
      setPartners(partnerRows);
      setSites(siteRows);
      setTaxRates(taxRows);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur de chargement.');
    } finally {
      setLoading(false);
    }
  }, [accessToken, filter]);

  useEffect(() => {
    load();
  }, [load]);

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
        <button className="btn-primary" onClick={() => setShowCreate(true)}>
          + Nouvelle facture
        </button>
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
              await refreshSelected();
            } catch (err) {
              setPdfError(err instanceof ApiError ? err.message : 'Échec de la finalisation.');
            }
          }}
          onRecordPayment={async (amount) => {
            if (!accessToken) return;
            try {
              await invoicingApi.recordPayment(accessToken, selected.id, { amount });
              await refreshSelected();
            } catch (err) {
              setPdfError(err instanceof ApiError ? err.message : "Échec de l'enregistrement du paiement.");
            }
          }}
          onOpenPdf={openPdf}
          pdfError={pdfError}
        />
      )}

      {showCreate && (
        <CreateInvoiceModal
          partners={partners}
          sites={sites}
          taxRates={taxRates}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            load();
          }}
        />
      )}
    </AppShell>
  );
}

function InvoiceModal({
  invoice,
  onClose,
  onFinalize,
  onRecordPayment,
  onOpenPdf,
  pdfError,
}: {
  invoice: InvoiceView;
  onClose: () => void;
  onFinalize: () => void;
  onRecordPayment: (amount: number) => void;
  onOpenPdf: () => void;
  pdfError: string | null;
}) {
  const [paymentAmount, setPaymentAmount] = useState('');

  return (
    <div className="modal-backdrop open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide">
        <button className="modal-close" onClick={onClose}>
          ✕
        </button>
        <h3>
          Facture {invoice.number ?? '(brouillon)'} <span className={`pill ${STATUS_PILL[invoice.status]}`}>{STATUS_LABEL[invoice.status]}</span>
        </h3>
        <p className="modal-sub">{invoice.partner?.name ?? 'Client comptant'}</p>

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
            </>
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
        </div>
      </div>
    </div>
  );
}

function CreateInvoiceModal({
  partners,
  sites,
  taxRates,
  onClose,
  onCreated,
}: {
  partners: Partner[];
  sites: Site[];
  taxRates: TaxRate[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const { accessToken } = useAuth();
  const [siteId, setSiteId] = useState(sites[0]?.id ?? '');
  const [partnerId, setPartnerId] = useState('');
  const [description, setDescription] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [unitPrice, setUnitPrice] = useState('');
  const [taxRateId, setTaxRateId] = useState(taxRates.find((t) => t.isDefault)?.id ?? '');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!accessToken) return;
    setError(null);
    try {
      await invoicingApi.createInvoice(accessToken, {
        type: 'CUSTOMER',
        siteId,
        partnerId: partnerId || undefined,
        lines: [{ description, quantity: Number(quantity), unitPrice: Number(unitPrice), taxRateId: taxRateId || undefined }],
      });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Échec de la création.');
    }
  }

  return (
    <div className="modal-backdrop open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <button className="modal-close" onClick={onClose}>
          ✕
        </button>
        <h3>Nouvelle facture</h3>
        <p className="modal-sub">Client (facultatif — laissez vide pour une vente comptoir).</p>
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
            <select value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
              <option value="">Client comptant</option>
              {partners
                .filter((p) => p.isCustomer)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {p.nif}
                  </option>
                ))}
            </select>
          </div>
          <div className="field-row">
            <label>Désignation</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)} required />
          </div>
          <div className="field-row">
            <label>Quantité</label>
            <input type="number" min="0.001" step="0.001" value={quantity} onChange={(e) => setQuantity(e.target.value)} required />
          </div>
          <div className="field-row">
            <label>Prix unitaire HT</label>
            <input type="number" min="0" step="0.01" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} required />
          </div>
          <div className="field-row">
            <label>TVA</label>
            <select value={taxRateId} onChange={(e) => setTaxRateId(e.target.value)}>
              <option value="">Aucune</option>
              {taxRates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.rate}%)
                </option>
              ))}
            </select>
          </div>
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
