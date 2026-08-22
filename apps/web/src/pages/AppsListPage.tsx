import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth-context';
import { PHASE1_MODULES } from '../lib/modules';
import './DashboardPage.css';

// The "Applications" card's destination from MobileHome — everything
// AppShell's desktop sidebar lists, as a full-screen tappable list instead
// of a persistent 232px column that has no room on a phone. Reachable
// directly at /apps too (not only via the mobile home card), so it stays
// useful on its own if someone bookmarks or shares the link.
export function AppsListPage() {
  const { me, logout } = useAuth();
  const navigate = useNavigate();

  if (!me) return null;

  const entitledKeys = new Set(me.entitlements.map((e) => e.module));

  return (
    <div className="mobile-home">
      <div className="mobile-home-header">
        <div>
          <button className="btn-link" onClick={() => navigate('/dashboard')} style={{ marginBottom: 10 }}>
            ← Accueil
          </button>
          <div className="dashboard-wordmark">
            Stock<span className="ily">ily</span>
          </div>
          <div className="mobile-home-org">{me.organization.name}</div>
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
    </div>
  );
}

export default AppsListPage;
