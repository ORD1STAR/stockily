import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AdminShell } from './AdminShell';
import { useAdminAuth } from './admin-auth-context';
import { AdminOrgRow, adminApi } from './admin-api';
import { Icon } from '../lib/Icon';
import '../lib/data-views.css';

export function AdminOrganizationsPage() {
  const { accessToken } = useAdminAuth();
  const [rows, setRows] = useState<AdminOrgRow[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!accessToken) return;
    const h = setTimeout(() => {
      setLoading(true);
      adminApi.organizations(accessToken, search || undefined).then(setRows).finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(h);
  }, [accessToken, search]);

  return (
    <AdminShell
      title="Organisations"
      actions={<input placeholder="Rechercher une organisation…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 260 }} />}
    >
      {loading ? (
        <div className="page-loader"><span className="spinner" /> Chargement…</div>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr><th>Organisation</th><th>Plan</th><th>Modules actifs</th><th>Utilisateurs</th><th>Sites</th><th>Appareils</th><th>Créée le</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id}>
                  <td><strong>{o.name}</strong></td>
                  <td><span className="pill info">{o.plan}</span></td>
                  <td>{o.activeModules}</td>
                  <td>{o.users}</td>
                  <td>{o.sites}</td>
                  <td>{o.activeDevices} / {Math.max(1, o.sites) * o.seatsPerSite}</td>
                  <td>{new Date(o.createdAt).toLocaleDateString('fr-FR')}</td>
                  <td style={{ textAlign: 'right' }}>
                    <Link className="btn-link" to={`/admin/organizations/${o.id}`}>Gérer <Icon name="chevronRight" size={13} /></Link>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={8} className="empty-state">Aucune organisation.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </AdminShell>
  );
}
