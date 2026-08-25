import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth-context';
import { PHASE1_MODULES } from '../lib/modules';
import { OrganizationSettingsModal } from '../lib/OrganizationSettingsModal';
import { PartnersModal } from '../lib/PartnersModal';
import './DashboardPage.css';

// The "Applications" card's destination from MobileHome — everything
// AppShell's desktop sidebar lists, as a full-screen tappable list instead
// of a persistent 232px column that has no room on a phone. Reachable
// directly at /apps too (not only via the mobile home card), so it stays
// useful on its own if someone bookmarks or shares the link.
//
// "Paramètres du Business" and "Fournisseurs & clients" belong here too —
// on desktop they're reachable from AppShell's sidebar (buttons near the
// bottom, below the module list), but a phone never renders AppShell's
// sidebar at all (see AppShell.tsx's mobile branch): the only way in was
// opening the hamburger drawer from some other AppShell page and scrolling
// down past the module list and the locked Phase 2/3 section to find them.
// Nothing surfaced them as their own destination the way every other
// module already gets one here — found by trying to actually reach them
// starting from the phone's own home screen, not by reading the sidebar
// code and assuming the drawer was enough.
export function AppsListPage() {
  const { me, logout } = useAuth();
  const navigate = useNavigate();
  const [showPartners, setShowPartners] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  if (!me) return null;

  const entitledKeys = new Set(me.entitlements.map((e) => e.module));
  const hasInvoicing = entitledKeys.has('invoicing');

  return (
    <div className="mobile-home">
      <div className="mobile-home-header">
        <div className="mobile-home-header-left">
          <button className="mobile-home-back" onClick={() => navigate('/dashboard')} aria-label="Accueil">
            ←
          </button>
          <div>
            <div className="dashboard-wordmark">
              Stock<span className="ily">ily</span>
            </div>
            <div className="mobile-home-org">{me.organization.name}</div>
          </div>
        </div>
        <button className="btn-secondary" onClick={() => logout()}>
          Se déconnecter
        </button>
      </div>
      <div className="apps-list">
        {PHASE1_MODULES.map((m) =>
          entitledKeys.has(m.key) ? (
            <button key={m.key} className="apps-list-item" onClick={() => navigate(m.to)}>
              <span className="apps-list-item-label">{m.label}</span>
              <span className="apps-list-item-hint">{m.hint}</span>
            </button>
          ) : (
            <div key={m.key} className="apps-list-item locked" title="Module non activé pour votre organisation">
              <span className="apps-list-item-label">{m.label}</span>
              <span className="apps-list-item-hint">Non activé</span>
            </div>
          ),
        )}
      </div>
      {hasInvoicing && (
        <div className="apps-list-section">
          <div className="apps-list-group-label">Gestion</div>
          <div className="apps-list">
            <button className="apps-list-item" onClick={() => setShowPartners(true)}>
              <span className="apps-list-item-label">👥 Fournisseurs &amp; clients</span>
              <span className="apps-list-item-hint">Le répertoire des partenaires</span>
            </button>
            <button className="apps-list-item" onClick={() => setShowSettings(true)}>
              <span className="apps-list-item-label">⚙ Paramètres du Business</span>
              <span className="apps-list-item-hint">Coordonnées, NIF, logo — utilisés sur chaque facture</span>
            </button>
          </div>
        </div>
      )}
      {showPartners && <PartnersModal onClose={() => setShowPartners(false)} />}
      {showSettings && <OrganizationSettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  );
}

export default AppsListPage;
