import { useAuth } from '../lib/auth-context';
import { AppShell } from '../lib/AppShell';
import './DashboardPage.css';

// Not a full product home screen — proves the whole chain works end-to-end
// from the browser: sign in, call a guarded endpoint with the stored token,
// render what it returns. Navigation to the real Stock/Sites screens (and
// logout) now lives in AppShell's sidebar, shared across every page.
export function DashboardPage() {
  const { me, logoutEverywhere } = useAuth();

  if (!me) return null; // ProtectedRoute guarantees this doesn't happen

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

export default DashboardPage;
