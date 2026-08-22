import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth-context';
import { AppShell } from '../lib/AppShell';
import { useIsMobile } from '../lib/useIsMobile';
import './DashboardPage.css';

// Not a full product home screen — proves the whole chain works end-to-end
// from the browser: sign in, call a guarded endpoint with the stored token,
// render what it returns. Navigation to the real Stock/Sites screens (and
// logout) now lives in AppShell's sidebar, shared across every page.
//
// On a real phone this same route becomes something else entirely: a
// persistent 232px dark sidebar (AppShell's) has no business existing on a
// 375px-wide screen, and Scan's own header comment already anticipated a
// "real Capacitor-wrapped build would drop AppShell entirely for this
// route" — MobileHome is that anticipated mobile entry point, landing here
// instead of the desktop org-summary dashboard.
export function DashboardPage() {
  const { me, logoutEverywhere } = useAuth();
  const isMobile = useIsMobile();

  if (!me) return null; // ProtectedRoute guarantees this doesn't happen

  if (isMobile) return <MobileHome />;

  return (
    <AppShell>
      <div className="dashboard-shell">
        <div className="dashboard-card">
          <h2>{me.organization.name}</h2>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.88rem' }}>Connecté en tant que {me.user.email}</p>
          <button className="btn-secondary" style={{ alignSelf: 'flex-start', marginTop: 8 }} onClick={() => logoutEverywhere()}>
            Déconnecter tous les appareils
          </button>
        </div>

        <div className="dashboard-card">
          <h2>Modules</h2>
          {me.entitlements.map((e) => (
            <div className="entitlement-row" key={e.module}>
              <span>{e.module}</span>
              <span className="pill">
                {e.status}
                {e.trialEndsAt ? ` — jusqu'au ${new Date(e.trialEndsAt).toLocaleDateString('fr-FR')}` : ''}
              </span>
            </div>
          ))}
        </div>

        <div className="dashboard-card">
          <h2>Rôles</h2>
          {me.roles.map((r, i) => (
            <div className="role-row" key={i}>
              <span>{r.role}</span>
              <span className="pill">{r.site ?? 'Toute l’organisation'}</span>
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  );
}

// The phone landing screen: two big destinations instead of a sidebar —
// "Applications" for everything AppShell's sidebar would otherwise list,
// "Scan / QR" as its own direct shortcut since it's the one module actually
// meant to be used one-handed, in the moment, at a shelf or a till.
function MobileHome() {
  const { me, logout } = useAuth();
  const navigate = useNavigate();

  if (!me) return null;

  return (
    <div className="mobile-home">
      <div className="mobile-home-header">
        <div>
          <div className="dashboard-wordmark">
            Stock<span className="ily">ily</span>
          </div>
          <div className="mobile-home-org">{me.organization.name}</div>
        </div>
        <button className="btn-secondary" onClick={() => logout()}>
          Se déconnecter
        </button>
      </div>
      <div className="mobile-home-cards">
        <button className="mobile-home-card" onClick={() => navigate('/apps')}>
          <span className="mobile-home-card-label">Applications</span>
          <span className="mobile-home-card-hint">Stock, Qualité, Factures, Multi-Sites…</span>
        </button>
        <button className="mobile-home-card" onClick={() => navigate('/scan')}>
          <span className="mobile-home-card-label">Scan / QR</span>
          <span className="mobile-home-card-hint">Scanner, vente rapide, étiquettes</span>
        </button>
      </div>
    </div>
  );
}

export default DashboardPage;
