import { useEffect, useState } from 'react';
import { AdminShell } from './AdminShell';
import { useAdminAuth } from './admin-auth-context';
import { AdminDashboard, adminApi } from './admin-api';
import '../lib/data-views.css';

export function AdminDashboardPage() {
  const { accessToken } = useAdminAuth();
  const [d, setD] = useState<AdminDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    adminApi.dashboard(accessToken).then(setD).catch((e) => setError(String(e.message ?? e)));
  }, [accessToken]);

  return (
    <AdminShell title="Tableau de bord">
      {error && <div className="error-banner">{error}</div>}
      {!d ? (
        <div className="page-loader"><span className="spinner" /> Chargement…</div>
      ) : (
        <>
          <div className="admin-kpis">
            <div className="admin-kpi"><div className="num">{d.organizations}</div><div className="label">Organisations</div></div>
            <div className="admin-kpi"><div className="num">{d.activeUsers}</div><div className="label">Utilisateurs actifs</div></div>
            <div className="admin-kpi"><div className="num">{d.activeDevices}</div><div className="label">Appareils actifs</div></div>
            {d.byPlan.map((p) => (
              <div className="admin-kpi" key={p.plan}><div className="num">{p.count}</div><div className="label">Plan « {p.plan} »</div></div>
            ))}
          </div>

          <h3 className="section-title">Adoption des modules</h3>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Module</th><th>Organisations actives</th></tr></thead>
              <tbody>
                {d.moduleAdoption.map((m) => (
                  <tr key={m.key}><td>{m.name}</td><td>{m.orgs}</td></tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 className="section-title">Dernières inscriptions</h3>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Organisation</th><th>Plan</th><th>Créée le</th></tr></thead>
              <tbody>
                {d.recentOrganizations.map((o) => (
                  <tr key={o.id}><td>{o.name}</td><td>{o.plan}</td><td>{new Date(o.createdAt).toLocaleDateString('fr-FR')}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </AdminShell>
  );
}
