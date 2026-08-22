import { FormEvent, useCallback, useEffect, useState } from 'react';
import { AppShell } from '../lib/AppShell';
import { useAuth } from '../lib/auth-context';
import { ApiError, Site, StockRow, Transfer, sitesApi, stockApi } from '../lib/api';
import '../lib/data-views.css';

export function SitesPage() {
  const { accessToken } = useAuth();
  const [sites, setSites] = useState<Site[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [products, setProducts] = useState<StockRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showTransferForm, setShowTransferForm] = useState(false);
  const [showSiteForm, setShowSiteForm] = useState(false);
  const [selectedTransfer, setSelectedTransfer] = useState<Transfer | null>(null);

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const [siteList, transferList, productRows] = await Promise.all([
        sitesApi.list(accessToken),
        sitesApi.listTransfers(accessToken),
        stockApi.listProducts(accessToken, 'all'),
      ]);
      setSites(siteList);
      setTransfers(transferList);
      setProducts(productRows);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur de chargement.');
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    load();
  }, [load]);

  function siteValue(siteId: string, sku: string) {
    return products.find((p) => p.site.id === siteId && p.sku === sku);
  }

  const uniqueSkus = Array.from(new Set(products.map((p) => p.sku)));

  return (
    <AppShell>
      <div className="panel-head">
        <div>
          <h2>Transferts Multi-Sites</h2>
          <div className="sub">Vue consolidée — {sites.length} site(s) actif(s)</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-secondary" onClick={() => setShowSiteForm(true)}>
            + Nouveau site
          </button>
          <button className="btn-primary" onClick={() => setShowTransferForm(true)} disabled={sites.length < 2}>
            + Transfert inter-site
          </button>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {loading ? (
        <p className="sub">Chargement…</p>
      ) : (
        <>
          <div className="site-grid">
            {sites.map((s) => {
              const siteSkus = uniqueSkus.filter((sku) => siteValue(s.id, sku));
              return (
                <div className="site-card" key={s.id}>
                  <h3>{s.name}</h3>
                  <div className="row">
                    <span>{siteSkus.length} SKUs en stock</span>
                  </div>
                </div>
              );
            })}
          </div>

          <div>
            <div className="sub" style={{ marginBottom: 8 }}>
              Transferts
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {transfers.map((t) => (
                <div className="transfer-item" key={t.id} onClick={() => setSelectedTransfer(t)}>
                  <span>Transfert du {new Date(t.createdAt).toLocaleDateString('fr-FR')}</span>
                  <span className="route">
                    {t.fromSite.name} → {t.toSite.name} · {statusLabel(t.status)}
                  </span>
                </div>
              ))}
              {transfers.length === 0 && <p className="sub">Aucun transfert pour le moment.</p>}
            </div>
          </div>
        </>
      )}

      {showSiteForm && (
        <SiteFormModal
          onClose={() => setShowSiteForm(false)}
          onSaved={() => {
            setShowSiteForm(false);
            load();
          }}
        />
      )}
      {showTransferForm && (
        <TransferFormModal
          sites={sites}
          products={products}
          onClose={() => setShowTransferForm(false)}
          onSaved={() => {
            setShowTransferForm(false);
            load();
          }}
        />
      )}
      {selectedTransfer && (
        <TransferDetailModal
          transfer={selectedTransfer}
          onClose={() => setSelectedTransfer(null)}
          onSaved={() => {
            setSelectedTransfer(null);
            load();
          }}
        />
      )}
    </AppShell>
  );
}

function statusLabel(status: Transfer['status']): string {
  return status === 'prepared' ? 'préparé' : status === 'in_transit' ? 'en transit' : 'livré';
}

function SiteFormModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { accessToken } = useAuth();
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!accessToken) return;
    setSubmitting(true);
    setError(null);
    try {
      await sitesApi.create(accessToken, { name, address: address || undefined });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur lors de la création du site.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <button className="modal-close" onClick={onClose}>
          ✕
        </button>
        <h3>Nouveau site</h3>
        <form onSubmit={handleSubmit} className="field-form">
          <div className="field-row">
            <label>Nom</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex. Alger — Entrepôt Central" required />
          </div>
          <div className="field-row">
            <label>Adresse (optionnel)</label>
            <textarea rows={2} value={address} onChange={(e) => setAddress(e.target.value)} />
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

function TransferFormModal({
  sites,
  products,
  onClose,
  onSaved,
}: {
  sites: Site[];
  products: StockRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { accessToken } = useAuth();
  const uniqueProducts = Array.from(new Map(products.map((p) => [p.productId, p])).values());
  const [productId, setProductId] = useState(uniqueProducts[0]?.productId ?? '');
  const [fromSiteId, setFromSiteId] = useState(sites[0]?.id ?? '');
  const [toSiteId, setToSiteId] = useState(sites[1]?.id ?? '');
  const [quantity, setQuantity] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A transfer can never move more than the source site actually has —
  // quantityOnHand is the sellable/available amount (quarantined stock is
  // tracked separately), the same figure the delivery-time ledger move will
  // be checked against.
  const availableAtSource = products.find((p) => p.productId === productId && p.site.id === fromSiteId)?.quantityOnHand ?? 0;

  useEffect(() => {
    if (quantity > availableAtSource) setQuantity(availableAtSource > 0 ? availableAtSource : 0);
  }, [availableAtSource, quantity]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!accessToken) return;
    setSubmitting(true);
    setError(null);
    try {
      await sitesApi.createTransfer(accessToken, { productId, fromSiteId, toSiteId, quantity });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur lors de la création du transfert.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <button className="modal-close" onClick={onClose}>
          ✕
        </button>
        <h3>Nouveau transfert</h3>
        <form onSubmit={handleSubmit} className="field-form">
          <div className="field-row">
            <label>Produit</label>
            <select value={productId} onChange={(e) => setProductId(e.target.value)} required>
              {uniqueProducts.map((p) => (
                <option key={p.productId} value={p.productId}>
                  {p.sku} — {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field-row">
            <label>Site de départ</label>
            <select value={fromSiteId} onChange={(e) => setFromSiteId(e.target.value)} required>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field-row">
            <label>Site de destination</label>
            <select value={toSiteId} onChange={(e) => setToSiteId(e.target.value)} required>
              {sites
                .filter((s) => s.id !== fromSiteId)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
          </div>
          <div className="field-row">
            <label>Quantité (disponible : {availableAtSource})</label>
            <input
              type="number"
              min={0.001}
              max={availableAtSource}
              step="any"
              value={quantity}
              onChange={(e) => setQuantity(Math.min(Number(e.target.value), availableAtSource))}
              required
            />
          </div>
          {error && <div className="error-banner">{error}</div>}
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Annuler
            </button>
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? 'Création…' : 'Créer le transfert'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function TransferDetailModal({ transfer, onClose, onSaved }: { transfer: Transfer; onClose: () => void; onSaved: () => void }) {
  const { accessToken } = useAuth();
  const [driverName, setDriverName] = useState(transfer.driverName ?? '');
  const [driverPhone, setDriverPhone] = useState(transfer.driverPhone ?? '');
  const [vehicleRef, setVehicleRef] = useState(transfer.vehicleRef ?? '');
  const [status, setStatus] = useState(transfer.status);
  const [submitting, setSubmitting] = useState(false);

  async function handleSave() {
    if (!accessToken) return;
    setSubmitting(true);
    try {
      await sitesApi.updateTransfer(accessToken, transfer.id, { status, driverName, driverPhone, vehicleRef });
      onSaved();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <button className="modal-close" onClick={onClose}>
          ✕
        </button>
        <h3>Transfert inter-site</h3>
        <p className="modal-sub">
          {transfer.fromSite.name} → {transfer.toSite.name}
        </p>
        <div className="field-row">
          <label>Statut</label>
          <select value={status} onChange={(e) => setStatus(e.target.value as Transfer['status'])}>
            <option value="prepared">Préparé</option>
            <option value="in_transit">En transit</option>
            <option value="delivered">Livré</option>
          </select>
        </div>
        <div className="field-row">
          <label>Chauffeur</label>
          <input value={driverName} onChange={(e) => setDriverName(e.target.value)} placeholder="Nom du chauffeur" />
        </div>
        <div className="field-row">
          <label>Téléphone</label>
          <input value={driverPhone} onChange={(e) => setDriverPhone(e.target.value)} placeholder="+213 ..." />
        </div>
        <div className="field-row">
          <label>Véhicule</label>
          <input value={vehicleRef} onChange={(e) => setVehicleRef(e.target.value)} placeholder="Immatriculation" />
        </div>
        <div className="modal-footer">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Fermer
          </button>
          <button type="button" className="btn-primary" onClick={handleSave} disabled={submitting}>
            {submitting ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default SitesPage;
