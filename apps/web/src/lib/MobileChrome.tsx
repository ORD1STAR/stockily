import { ReactNode, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './auth-context';
import { BrandMark, initials } from './AppShell';
import { Icon } from './Icon';
import { PurchaseModal } from './billing';
import { entitledModuleKeys, PRODUCT_MODULES } from './modules';
import './MobileChrome.css';

// Phone-only chrome shared by the screens that run full-screen without
// AppShell (home, Applications launcher, Scan).
export function MobileHeader({ back, right }: { back?: () => void; right?: ReactNode }) {
  const { me } = useAuth();
  return (
    <div className="mobile-home-header">
      <div className="mobile-home-header-left">
        {back && (
          <button className="shell-icon-btn" onClick={back} aria-label="Retour">
            <Icon name="chevronLeft" size={20} />
          </button>
        )}
        <BrandMark size={28} />
        <span className="shell-wordmark-text">
          Stock<span className="ily">ily</span>
        </span>
      </div>
      <div className="mobile-home-header-right">
        {right}
        <span className="shell-avatar sm">{initials(me?.organization.name ?? '')}</span>
      </div>
    </div>
  );
}

// Owned apps first, in colour; apps the organization hasn't unlocked yet
// follow in black & white — tapping one opens the purchase flow.
export function ModuleTiles({ has }: { has: Set<string> }) {
  const navigate = useNavigate();
  const { me } = useAuth();
  const [buying, setBuying] = useState<string | null>(null);
  const orgHas = entitledModuleKeys(me?.entitlements ?? []);
  const owned = PRODUCT_MODULES.filter((m) => has.has(m.key));
  const locked = PRODUCT_MODULES.filter((m) => !orgHas.has(m.key));
  return (
    <div className="mobile-section">
      <div className="mobile-section-label">Applications</div>
      <div className="mobile-tiles">
        {owned.map((m) => (
          <button key={m.to} className="mobile-tile" onClick={() => navigate(m.to)}>
            <span className={`mod-chip tone-${m.tone}`}>
              <Icon name={m.icon} size={20} />
            </span>
            <span className="mobile-tile-label">{m.label}</span>
            <span className="mobile-tile-hint">{m.hint}</span>
          </button>
        ))}
      </div>
      {locked.length > 0 && (
        <>
          <div className="mobile-section-label mobile-locked-label">À débloquer</div>
          <div className="mobile-tiles">
            {locked.map((m) => (
              <button key={m.to} className="mobile-tile locked" onClick={() => setBuying(m.key)}>
                <span className={`mod-chip tone-${m.tone}`}>
                  <Icon name={m.icon} size={20} />
                </span>
                <span className="mobile-tile-label">{m.label}</span>
                <span className="mobile-tile-hint">
                  <Icon name="lock" size={11} /> Débloquer
                </span>
              </button>
            ))}
          </div>
        </>
      )}
      {buying && <PurchaseModal initialModules={[buying]} onClose={() => setBuying(null)} />}
    </div>
  );
}

/** "Espace client" row for the phone home / Applications lists. */
export function ClientSpaceRow() {
  const navigate = useNavigate();
  return (
    <button className="mobile-list-item" onClick={() => navigate('/compte')}>
      <span className="mod-chip sm tone-violet">
        <Icon name="building" size={16} />
      </span>
      <span className="mobile-list-text">Espace client · abonnement & compte</span>
      <Icon name="chevronRight" size={16} />
    </button>
  );
}
