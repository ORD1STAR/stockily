import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth-context';
import { Icon } from '../lib/Icon';
import { OrganizationSettingsModal } from '../lib/OrganizationSettingsModal';
import { PartnersModal } from '../lib/PartnersModal';
import { MobileHeader, ModuleTiles } from '../lib/MobileChrome';
import { entitledModuleKeys } from '../lib/modules';
import './DashboardPage.css';

// Phone "Applications" launcher — every module as a tile, plus the two
// business-management screens that don't live inside any one module.
export function AppsListPage() {
  const { me, logout } = useAuth();
  const navigate = useNavigate();
  const [showPartners, setShowPartners] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  if (!me) return null;

  const entitledKeys = entitledModuleKeys(me.entitlements);
  const hasInvoicing = entitledKeys.has('invoicing');

  return (
    <div className="mobile-home">
      <MobileHeader
        back={() => navigate('/dashboard')}
        right={
          <button className="shell-icon-btn" onClick={() => logout()} aria-label="Se déconnecter">
            <Icon name="logout" size={19} />
          </button>
        }
      />
      <ModuleTiles has={entitledKeys} />
      {hasInvoicing && (
        <div className="mobile-section">
          <div className="mobile-section-label">Gestion</div>
          <div className="mobile-list">
            <button className="mobile-list-item" onClick={() => setShowPartners(true)}>
              <span className="mod-chip sm tone-slate">
                <Icon name="users" size={16} />
              </span>
              <span className="mobile-list-text">Fournisseurs & clients</span>
              <Icon name="chevronRight" size={16} />
            </button>
            <button className="mobile-list-item" onClick={() => setShowSettings(true)}>
              <span className="mod-chip sm tone-slate">
                <Icon name="settings" size={16} />
              </span>
              <span className="mobile-list-text">Paramètres du business</span>
              <Icon name="chevronRight" size={16} />
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
