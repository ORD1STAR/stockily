import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth-context';
import './DashboardPage.css';

// Not a real product screen (that's docs/Wireframes.html's job) — this
// proves the whole chain works end-to-end from the browser: sign in, call
// a guarded endpoint with the stored token, render what it returns.
export function DashboardPage() {
  const { me, logout, logoutEverywhere } = useAuth();
  const navigate = useNavigate();

  if (!me) return null; // ProtectedRoute guarantees this doesn't happen

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  async function handleLogoutEverywhere() {
    await logoutEverywhere();
    navigate('/login', { replace: true });
  }

  return (
    <div className="dashboard-shell">
      <div className="dashboard-header">
        <div className="dashboard-wordmark">
          Stock<span className="ily">ily</span>
        </div>
        <div className="dashboard-actions">
          <button className="btn-secondary" onClick={handleLogout}>
            Se déconnecter
          </button>
          <button className="btn-secondary" onClick={handleLogoutEverywhere}>
            Déconnecter tous les appareils
          </button>
        </div>
      </div>

      <div className="dashboard-card">
        <h2>{me.organization.name}</h2>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.88rem' }}>
          Connecté en tant que {me.user.email}
        </p>
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
  );
}

export default DashboardPage;
