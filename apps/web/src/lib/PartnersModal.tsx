import { FormEvent, useEffect, useState } from 'react';
import { useAuth } from './auth-context';
import { ApiError, Partner, invoicingApi } from './api';
import './data-views.css';

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

  return (
    <div className="modal-backdrop open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide">
        <div className="modal-header">
          <div className="modal-header-titles">
            <h3>Fournisseurs & clients</h3>
            <p className="modal-sub">
              Le répertoire des partenaires — utilisé pour les factures et pour indiquer d&#39;où vient un lot reçu en stock.
            </p>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>
        {error && <div className="error-banner">{error}</div>}
        <div className="modal-section">
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Nom</th>
                  <th>Type</th>
                  <th>NIF</th>
                  <th>Téléphone</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {partners === null ? (
                  <tr>
                    <td colSpan={5} className="muted" style={{ textAlign: 'center', padding: '24px 0' }}>
                      Chargement…
                    </td>
                  </tr>
                ) : partners.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="muted" style={{ textAlign: 'center', padding: '24px 0' }}>
                      Aucun partenaire enregistré.
                    </td>
                  </tr>
                ) : (
                  partners.map((p) => (
                    <tr key={p.id} className="clickable" onClick={() => setEditing(p)}>
                      <td>{p.name}</td>
                      <td className="muted">{roleLabel(p)}</td>
                      <td className="mono">{p.nif}</td>
                      <td className="muted">{p.phone ?? '—'}</td>
                      <td style={{ textAlign: 'right' }}>
                        <span className="btn-link">Modifier</span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
        <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
          <button className="btn-secondary" onClick={onClose}>
            Fermer
          </button>
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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!accessToken) return;
    setSubmitting(true);
    setError(null);
    const data = {
      name,
      isCustomer,
      isSupplier,
      nif,
      nis: nis || null,
      rc: rc || null,
      taxArticle: taxArticle || null,
      address: address || null,
      phone: phone || null,
      email: email || null,
      paymentTermsNetDays: paymentTermsNetDays ? Number(paymentTermsNetDays) : null,
    };
    try {
      if (partner) {
        await invoicingApi.updatePartner(accessToken, partner.id, data);
      } else {
        await invoicingApi.createPartner(accessToken, data);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Échec de l’enregistrement.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <div className="modal-header-titles">
            <h3>{partner ? 'Modifier le partenaire' : 'Nouveau partenaire'}</h3>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>
        <form onSubmit={handleSubmit} className="field-form">
          <div className="field-row">
            <label>Nom complet / raison sociale</label>
            <input value={name} onChange={(e) => setName(e.target.value)} required />
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
              <input value={nif} onChange={(e) => setNif(e.target.value)} required />
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
          <div className="field-row">
            <label>Conditions de paiement (jours)</label>
            <input
              type="number"
              min={0}
              value={paymentTermsNetDays}
              onChange={(e) => setPaymentTermsNetDays(e.target.value)}
              placeholder="ex: 30"
            />
          </div>
          {error && <div className="error-banner">{error}</div>}
          <div className="modal-footer">
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
