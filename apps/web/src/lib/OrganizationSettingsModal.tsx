import { FormEvent, useEffect, useRef, useState } from 'react';
import { useAuth } from './auth-context';
import { ApiError, OrganizationProfile, invoicingApi } from './api';

const MAX_LOGO_DIMENSION = 240; // px — a logo printed at ~36pt on an invoice never needs more
const ACCEPTED_LOGO_TYPES = ['image/png', 'image/jpeg'];

// Resizes/re-encodes to PNG client-side so a phone photo (several MB,
// wrong aspect ratio for a logo) never gets pushed at DB-storage size or
// pdfkit-decoding cost — draws onto an offscreen canvas at a capped
// dimension (never upscaling a smaller source) and reads back a data:
// URL, which is exactly the shape both the DB column and the invoice
// PDF's image renderer already expect.
function resizeToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Lecture du fichier impossible.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Image illisible.'));
      img.onload = () => {
        const scale = Math.min(1, MAX_LOGO_DIMENSION / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Rendu impossible sur ce navigateur.'));
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/png'));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

// Backs the wireframe's "⚙ Paramètres du Business" screen — the org's own
// legal identity (Décret 05-468's 12 mandatory mentions on the seller
// side), required before a CUSTOMER invoice can be finalized
// (InvoicingService.finalizeInvoice checks these same fields server-side;
// this form is what actually fills them in). Reachable from AppShell so
// it's available regardless of which module page is open, matching the
// wireframe's placement at the very bottom of the sidebar.
export function OrganizationSettingsModal({ onClose }: { onClose: () => void }) {
  const { accessToken } = useAuth();
  const [profile, setProfile] = useState<OrganizationProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!accessToken) return;
    invoicingApi.getOrganizationProfile(accessToken).then(setProfile);
  }, [accessToken]);

  async function handleLogoFile(file: File | undefined) {
    if (!file || !profile) return;
    setLogoError(null);
    if (!ACCEPTED_LOGO_TYPES.includes(file.type)) {
      setLogoError('Format non supporté — utilisez un PNG ou un JPEG.');
      return;
    }
    try {
      const dataUrl = await resizeToDataUrl(file);
      setProfile({ ...profile, logo: dataUrl });
    } catch (err) {
      setLogoError(err instanceof Error ? err.message : "Échec du traitement de l'image.");
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!accessToken || !profile) return;
    setError(null);
    setSaved(false);
    try {
      const updated = await invoicingApi.updateOrganizationProfile(accessToken, {
        name: profile.name,
        address: profile.address ?? undefined,
        nif: profile.nif ?? undefined,
        nis: profile.nis ?? undefined,
        rc: profile.rc ?? undefined,
        taxArticle: profile.taxArticle ?? undefined,
        phone: profile.phone ?? undefined,
        email: profile.email ?? undefined,
        logo: profile.logo,
      });
      setProfile(updated);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Échec de l’enregistrement.');
    }
  }

  if (!profile) return null;

  return (
    <div className="modal-backdrop open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide">
        <div className="modal-header">
          <div className="modal-header-titles">
            <h3>Paramètres du Business</h3>
            <p className="modal-sub">Ces informations apparaissent sur toutes les factures émises.</p>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>
        <form className="field-form" onSubmit={submit}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg"
            style={{ display: 'none' }}
            onChange={(e) => {
              handleLogoFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          {profile.logo ? (
            <div
              className="upload-box"
              style={{ display: 'flex', alignItems: 'center', gap: 14, textAlign: 'left' }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                handleLogoFile(e.dataTransfer.files?.[0]);
              }}
            >
              <img src={profile.logo} alt="Logo de l'entreprise" style={{ width: 56, height: 56, objectFit: 'contain', background: '#fff', borderRadius: 6 }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <button type="button" className="btn-link" onClick={() => fileInputRef.current?.click()}>
                  Remplacer le logo
                </button>
                <button type="button" className="btn-link" onClick={() => setProfile({ ...profile, logo: null })}>
                  Retirer le logo
                </button>
              </div>
            </div>
          ) : (
            <div
              className="upload-box"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                handleLogoFile(e.dataTransfer.files?.[0]);
              }}
              style={{ cursor: 'pointer' }}
            >
              Glisser un logo ou cliquer pour parcourir
              <br />
              <span style={{ fontSize: '0.72rem' }}>PNG ou JPEG</span>
            </div>
          )}
          {logoError && <div className="error-banner">{logoError}</div>}
          <div className="field-row">
            <label>Nom de l'entreprise</label>
            <input value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} required />
          </div>
          <div className="field-grid">
            <div className="field-row">
              <label>NIF</label>
              <input value={profile.nif ?? ''} onChange={(e) => setProfile({ ...profile, nif: e.target.value })} />
            </div>
            <div className="field-row">
              <label>NIS</label>
              <input value={profile.nis ?? ''} onChange={(e) => setProfile({ ...profile, nis: e.target.value })} />
            </div>
            <div className="field-row">
              <label>RC</label>
              <input value={profile.rc ?? ''} onChange={(e) => setProfile({ ...profile, rc: e.target.value })} />
            </div>
            <div className="field-row">
              <label>Article d'imposition</label>
              <input value={profile.taxArticle ?? ''} onChange={(e) => setProfile({ ...profile, taxArticle: e.target.value })} />
            </div>
          </div>
          <div className="field-row">
            <label>Adresse</label>
            <textarea rows={2} value={profile.address ?? ''} onChange={(e) => setProfile({ ...profile, address: e.target.value })} />
          </div>
          <div className="field-grid">
            <div className="field-row">
              <label>Téléphone</label>
              <input value={profile.phone ?? ''} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} />
            </div>
            <div className="field-row">
              <label>Email</label>
              <input type="email" value={profile.email ?? ''} onChange={(e) => setProfile({ ...profile, email: e.target.value })} />
            </div>
          </div>
          <div className="field-row">
            <label>Devise</label>
            <input value="DZD" disabled />
          </div>
          {error && <div className="error-banner">{error}</div>}
          {saved && <div className="note-box">Enregistré.</div>}
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Fermer
            </button>
            <button type="submit" className="btn-primary">
              Enregistrer
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
