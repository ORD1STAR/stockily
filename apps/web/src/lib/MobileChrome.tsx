import { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './auth-context';
import { BrandMark, initials } from './AppShell';
import { Icon } from './Icon';
import { PRODUCT_MODULES } from './modules';
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

export function ModuleTiles({ has }: { has: Set<string> }) {
  const navigate = useNavigate();
  const { can } = useAuth();
  const showLocked = can('members.user.manage');
  return (
    <div className="mobile-section">
      <div className="mobile-section-label">Applications</div>
      <div className="mobile-tiles">
        {PRODUCT_MODULES.map((m) =>
          has.has(m.key) ? (
            <button key={m.to} className="mobile-tile" onClick={() => navigate(m.to)}>
              <span className={`mod-chip tone-${m.tone}`}>
                <Icon name={m.icon} size={20} />
              </span>
              <span className="mobile-tile-label">{m.label}</span>
              <span className="mobile-tile-hint">{m.hint}</span>
            </button>
          ) : !showLocked ? null : (
            <div key={m.to} className="mobile-tile locked" title="Module non activé pour votre organisation">
              <span className="mod-chip tone-slate">
                <Icon name="lock" size={18} />
              </span>
              <span className="mobile-tile-label">{m.label}</span>
              <span className="mobile-tile-hint">Non activé</span>
            </div>
          ),
        )}
      </div>
    </div>
  );
}

