import { FormEvent, useEffect, useState } from 'react';
import { useAuth } from './auth-context';
import { ApiError, Partner, StatementEntry, invoicingApi, tradeApi } from './api';
import { PaymentInline } from './TradeDocuments';
import { useListControls } from './ListControls';
import { notifyDataChanged } from './data-events';
import { toast } from './toast';
import './data-views.css';

const money = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Fournisseurs & clients management, reachable from the sidebar's
// "Paramètres" area rather than nested inside Invoicing — a supplier record
// (who a lot was actually received from) is a Stock-module concern just as
// much as a customer record is an Invoicing one, and previously the only
// way to create a Partner at all was Invoicing's "+ Nouveau client" modal,
// which hardcodes isCustomer: true/isSupplier: false — there was no way to
// register a supplier anywhere in the app.
export function PartnersModal({ onClose }: { onClose: () => void }) {
  const { accessToken } = useAuth();
  const [partners, setPartners] = useState<Partner[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Partner | null>(null);
  const [filter, setFilter] = useState<'all' | 'customer' | 'supplier'>('all');

  async function load() {
    if (!accessToken) return;
    try {
      setPartners(await invoicingApi.listPartners(accessToken));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur de chargement.');
    }
  }

  useEffect(() => {
    load();
  }, [accessToken]);

  function roleLabel(p: Partner) {
    if (p.isCustomer && p.isSupplier) return 'Client & fournisseur';
    if (p.isSupplier) return 'Fournisseur';
    if (p.isCustomer) return 'Client';
    return '—';
  }

  const list = useListControls(
    (partners ?? []).filter((p) => filter === 'all' || (filter === 'customer' ? p.isCustomer : p.isSupplier)),
    {
      id: 'partners',
      noun: ['partenaire', 'partenaires'],
      searchPlaceholder: 'Nom, code, téléphone, NIF…',
      search: (p) => [p.name, p.code, p.phone, p.email, p.nif, p.rc, p.address],
      filters: [
        {
          key: 'balance',
          label: 'Solde',
          type: 'select',
          value: (p) => (p.balance > 0.004 ? 'debit' : p.balance < -0.004 ? 'credit' : 'zero'),
          options: [
            { value: 'debit', label: 'Solde positif (doit de l’argent)' },
            { value: 'credit', label: 'Solde négatif (avoir / on lui doit)' },
            { value: 'zero', label: 'Soldé' },
          ],
        },
        { key: 'amount', label: 'Montant du solde', type: 'range', unit: 'DA', value: (p) => p.balance },
        {
          key: 'tier',
          label: 'Tarif',
          type: 'select',
          value: (p) => (p.isCustomer ? String(p.priceTier) : null),
          options: [
            { value: '1', label: 'Détail (prix 1)' },
            { value: '2', label: 'Gros (prix 2)' },
          ],
        },
        { key: 'both', label: 'Client et fournisseur', type: 'flag', test: (p) => p.isCustomer && p.isSupplier },
        { key: 'nif', label: 'Avec NIF', type: 'flag', test: (p) => !!p.nif },
        { key: 'email', label: 'Avec email', type: 'flag', test: (p) => !!p.email },
        { key: 'nophone', label: 'Sans téléphone', type: 'flag', test: (p) => !p.phone },
      ],
      sorts: [
        { key: 'code', label: 'Code', value: (p) => p.code },
        { key: 'name', label: 'Nom', value: (p) => p.name },
        { key: 'type', label: 'Type', value: (p) => roleLabel(p) },
        { key: 'balance', label: 'Solde', value: (p) => p.balance, desc: true },
      ],
      defaultSort: { key: 'name', dir: 'asc' },
    },
  );
  const visible = list.rows;
  const totalCustomers = (partners ?? []).filter((p) => p.isCustomer).reduce((sum, p) => sum + p.balance, 0);
  const totalSuppliers = (partners ?? []).filter((p) => p.isSupplier && !p.isCustomer).reduce((sum, p) => sum + p.balance, 0);


  return (
    <div className="modal-backdrop open">
      <div className="modal xwide">
        <div className="modal-header">
          <div className="modal-header-titles">
            <h3>Fournisseurs & clients</h3>
            <p className="modal-sub">Clients et fournisseurs de votre entreprise.</p>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>
        {error && <div className="error-banner">{error}</div>}
        {list.toolbar(
          <div className="toggle-row">
            {(
              [
                ['all', 'Tous'],
                ['customer', 'Clients'],
                ['supplier', 'Fournisseurs'],
              ] as const
            ).map(([k, label]) => (
              <button key={k} type="button" className={`toggle-btn${filter === k ? ' on' : ''}`} onClick={() => setFilter(k)}>
                {label}
              </button>
            ))}
          </div>,
        )}
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                {list.th('code', 'Code')}
                {list.th('name', 'Nom')}
                {list.th('type', 'Type')}
                <th>Téléphone</th>
                <th>Email</th>
                {list.th('balance', 'Solde', 'num')}
              </tr>
            </thead>
            <tbody>
              {partners === null ? (
                <tr>
                  <td colSpan={6} className="muted" style={{ textAlign: 'center', padding: '24px 0' }}>
                    Chargement…
                  </td>
                </tr>
              ) : visible.length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted" style={{ textAlign: 'center', padding: '24px 0' }}>
                    {partners.length === 0 ? (
                      'Aucun partenaire enregistré.'
                    ) : (
                      <>
                        Aucun résultat.{' '}
                        <button type="button" className="btn-link" onClick={list.reset}>
                          Effacer les filtres
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ) : (
                visible.map((p) => (
                  <tr key={p.id} className="clickable" onClick={() => setEditing(p)}>
                    <td className="mono">{p.code ?? '—'}</td>
                    <td>
                      <div className="cell-title">{p.name}</div>
                      {p.isCustomer && p.priceTier === 2 && <div className="cell-sub">Tarif gros</div>}
                    </td>
                    <td className="muted">{roleLabel(p)}</td>
                    <td className="muted">{p.phone || '—'}</td>
                    <td className="muted">{p.email || '—'}</td>
                    <td className={`num ${p.balance > 0 ? 'bad' : p.balance < 0 ? 'good' : 'muted'}`}>{money.format(p.balance)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {partners && partners.length > 0 && (
          <div className="lines-total">
            <span>Total soldes clients</span>
            <strong>{money.format(totalCustomers)} DZD</strong>
            <span>Total soldes fournisseurs</span>
            <strong>{money.format(totalSuppliers)} DZD</strong>
          </div>
        )}
        <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
          <span className="sub">Solde = solde initial + bons et factures − retours − versements.</span>
          <button className="btn-primary" onClick={() => setShowForm(true)}>
            + Nouveau partenaire
          </button>
        </div>
      </div>
      {showForm && (
        <PartnerEditForm
          onClose={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false);
            load();
          }}
        />
      )}
      {editing && (
        <PartnerEditForm
          partner={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function PartnerEditForm({
  partner,
  onClose,
  onSaved,
}: {
  partner?: Partner;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { accessToken } = useAuth();
  const [name, setName] = useState(partner?.name ?? '');
  const [isCustomer, setIsCustomer] = useState(partner?.isCustomer ?? false);
  const [isSupplier, setIsSupplier] = useState(partner?.isSupplier ?? true);
  const [nif, setNif] = useState(partner?.nif ?? '');
  const [nis, setNis] = useState(partner?.nis ?? '');
  const [rc, setRc] = useState(partner?.rc ?? '');
  const [taxArticle, setTaxArticle] = useState(partner?.taxArticle ?? '');
  const [address, setAddress] = useState(partner?.address ?? '');
  const [phone, setPhone] = useState(partner?.phone ?? '');
  const [email, setEmail] = useState(partner?.email ?? '');
  const [paymentTermsNetDays, setPaymentTermsNetDays] = useState(partner?.paymentTermsNetDays?.toString() ?? '');
  const [code, setCode] = useState(partner?.code ?? '');
  const [priceTier, setPriceTier] = useState<1 | 2>(partner?.priceTier === 2 ? 2 : 1);
  const [openingBalance, setOpeningBalance] = useState(partner ? String(partner.openingBalance) : '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [tab, setTab] = useState<'fiche' | 'compte'>('fiche');

  async function handleDelete() {
    if (!accessToken || !partner) return;
    setSubmitting(true);
    setError(null);
    try {
      await invoicingApi.deletePartner(accessToken, partner.id);
      notifyDataChanged('partners');
      toast.success('Partenaire supprimé.');
      onSaved();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Échec de la suppression.';
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
      setConfirmingDelete(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!accessToken) return;
    setSubmitting(true);
    setError(null);
    const data = {
      name,
      isCustomer,
      isSupplier,
      nif: nif || null,
      nis: nis || null,
      rc: rc || null,
      taxArticle: taxArticle || null,
      address: address || null,
      phone: phone || null,
      email: email || null,
      paymentTermsNetDays: paymentTermsNetDays ? Number(paymentTermsNetDays) : null,
      code: code.trim() || undefined,
      priceTier,
      openingBalance: openingBalance === '' ? 0 : Number(openingBalance),
    };
    try {
      if (partner) {
        await invoicingApi.updatePartner(accessToken, partner.id, data);
      } else {
        await invoicingApi.createPartner(accessToken, data);
      }
      notifyDataChanged('partners');
      toast.success(partner ? 'Partenaire modifié.' : 'Partenaire créé.');
      onSaved();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Échec de l’enregistrement.';
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop open">
      <div className={`modal${partner ? ' wide' : ''}`}>
        <div className="modal-header">
          <div className="modal-header-titles">
            <h3>{partner ? partner.name : 'Nouveau partenaire'}</h3>
            {partner && (
              <div className="modal-meta">
                {partner.code && <span className="chip mono">{partner.code}</span>}
                <span className={`chip${partner.balance > 0 ? ' bad' : ''}`}>Solde {money.format(partner.balance)} DZD</span>
              </div>
            )}
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>
        {partner && (
          <div className="modal-tabs" role="tablist">
            <button type="button" role="tab" className={tab === 'fiche' ? 'on' : ''} onClick={() => setTab('fiche')}>
              Fiche
            </button>
            <button type="button" role="tab" className={tab === 'compte' ? 'on' : ''} onClick={() => setTab('compte')}>
              Compte & relevé
            </button>
          </div>
        )}
        {partner && tab === 'compte' && <PartnerAccount partner={partner} onChanged={onSaved} />}
        <form onSubmit={handleSubmit} className="field-form" style={tab === 'compte' ? { display: 'none' } : undefined}>
          <div className="field-grid" style={{ gridTemplateColumns: '1fr 2fr' }}>
            <div className="field-row">
              <label>Code</label>
              <input className="mono" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Auto" />
            </div>
            <div className="field-row">
              <label>Nom / raison sociale</label>
              <input value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
          </div>
          <div className="field-row">
            <label>Rôle</label>
            <div className="toggle-row">
              <button type="button" className={`toggle-btn ${isSupplier ? 'on' : ''}`} onClick={() => setIsSupplier(!isSupplier)}>
                Fournisseur
              </button>
              <button type="button" className={`toggle-btn ${isCustomer ? 'on' : ''}`} onClick={() => setIsCustomer(!isCustomer)}>
                Client
              </button>
            </div>
          </div>
          <div className="field-grid">
            <div className="field-row">
              <label>NIF</label>
              <input value={nif} onChange={(e) => setNif(e.target.value)} />
            </div>
            <div className="field-row">
              <label>NIS</label>
              <input value={nis} onChange={(e) => setNis(e.target.value)} />
            </div>
            <div className="field-row">
              <label>RC</label>
              <input value={rc} onChange={(e) => setRc(e.target.value)} />
            </div>
            <div className="field-row">
              <label>Article d'imposition</label>
              <input value={taxArticle} onChange={(e) => setTaxArticle(e.target.value)} />
            </div>
          </div>
          <div className="field-row">
            <label>Adresse</label>
            <textarea rows={2} value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <div className="field-grid">
            <div className="field-row">
              <label>Téléphone</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="field-row">
              <label>Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          </div>
          <div className="field-grid">
            <div className="field-row">
              <label>Solde initial (DZD)</label>
              <input type="number" step="any" inputMode="decimal" value={openingBalance} onChange={(e) => setOpeningBalance(e.target.value)} placeholder="0" />
            </div>
            <div className="field-row">
              <label>Délai de paiement (jours)</label>
              <input type="number" min={0} value={paymentTermsNetDays} onChange={(e) => setPaymentTermsNetDays(e.target.value)} placeholder="ex: 30" />
            </div>
          </div>
          {isCustomer && (
            <div className="field-row">
              <label>Tarif appliqué</label>
              <div className="toggle-row" style={{ margin: 0 }}>
                <button type="button" className={`toggle-btn${priceTier === 1 ? ' on' : ''}`} onClick={() => setPriceTier(1)}>
                  Prix 1 · détail
                </button>
                <button type="button" className={`toggle-btn${priceTier === 2 ? ' on' : ''}`} onClick={() => setPriceTier(2)}>
                  Prix 2 · gros
                </button>
              </div>
            </div>
          )}
          {partner && (
            <p className="sub" style={{ margin: '0 0 8px' }}>
              Solde actuel : <b className={partner.balance > 0 ? 'bad' : ''}>{money.format(partner.balance)} DZD</b>
            </p>
          )}
          {error && <div className="error-banner">{error}</div>}
          <div className="modal-footer">
            {partner && (
              <button
                type="button"
                className="btn-link danger"
                style={{ marginRight: 'auto' }}
                disabled={submitting}
                onClick={() => (confirmingDelete ? handleDelete() : setConfirmingDelete(true))}
                onBlur={() => setConfirmingDelete(false)}
              >
                {confirmingDelete ? 'Confirmer la suppression ?' : 'Supprimer'}
              </button>
            )}
            <button type="button" className="btn-secondary" onClick={onClose}>
              Annuler
            </button>
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? 'Enregistrement…' : partner ? 'Enregistrer' : 'Créer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function PartnerAccount({ partner, onChanged }: { partner: Partner; onChanged: () => void }) {
  const { accessToken } = useAuth();
  const [data, setData] = useState<{ entries: StatementEntry[]; customerBalance: number; supplierBalance: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!accessToken) return;
    try {
      setData(await tradeApi.statement(accessToken, partner.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur de chargement.');
    }
  }
  useEffect(() => {
    load();
  }, [partner.id]);

  const sides: ('customer' | 'supplier')[] = [...(partner.isCustomer ? ['customer' as const] : []), ...(partner.isSupplier ? ['supplier' as const] : [])];
  if (sides.length === 0) sides.push('customer');

  return (
    <div>
      {error && <div className="error-banner">{error}</div>}
      {!data ? (
        <div className="page-loader">
          <span className="spinner" /> Chargement…
        </div>
      ) : (
        sides.map((side) => {
          const rows = data.entries.filter((e) => e.side === side);
          const bal = side === 'customer' ? data.customerBalance : data.supplierBalance;
          return (
            <div key={side} className="modal-section">
              <div className="lines-head" style={{ justifyContent: 'space-between' }}>
                <span className="modal-section-label">{side === 'customer' ? 'Compte client' : 'Compte fournisseur'}</span>
                <span className="sub">
                  {side === 'customer' ? 'Doit' : 'À payer'} : <b className={bal > 0 ? 'bad' : ''}>{money.format(bal)} DZD</b>
                </span>
              </div>
              <table className="lot-mini-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Opération</th>
                    <th>Réf.</th>
                    <th className="num">Montant</th>
                    <th className="num">Solde</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((e, i) => (
                    <tr key={i}>
                      <td className="muted">{e.kind === 'opening' ? '—' : new Date(e.date).toLocaleDateString('fr-FR')}</td>
                      <td>{e.label}</td>
                      <td className="mono muted">{e.ref ?? ''}</td>
                      <td className={`num ${e.amount < 0 ? 'good' : ''}`}>{e.amount > 0 ? '+' : ''}{money.format(e.amount)}</td>
                      <td className="num">{money.format(e.balanceAfter)}</td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={5} className="muted">
                        Aucune opération.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={async () => {
                    if (!accessToken) return;
                    try {
                      const blob = await tradeApi.fetchUnpaidPdf(accessToken, partner.id, side);
                      window.open(URL.createObjectURL(blob), '_blank');
                    } catch (err) {
                      setError(err instanceof ApiError ? err.message : 'Impossible de générer le PDF.');
                    }
                  }}
                >
                  Imprimer l’{side === 'customer' ? 'état des créances' : 'état des dettes'}
                </button>
                <PaymentInline
                  partnerId={partner.id}
                  direction={side === 'customer' ? 'in' : 'out'}
                  label={side === 'customer' ? 'Encaisser un versement du client' : 'Enregistrer un paiement au fournisseur'}
                  onSaved={() => {
                    load();
                    onChanged();
                  }}
                />
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
