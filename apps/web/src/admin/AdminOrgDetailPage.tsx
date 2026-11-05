import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AdminShell } from './AdminShell';
import { useAdminAuth } from './admin-auth-context';
import { AdminOrgDetail, AdminOrgModule, adminApi } from './admin-api';
import { AdminUserModal } from './AdminUserModal';
import type { MemberView } from '../lib/api';
import { Icon } from '../lib/Icon';
import { toast } from '../lib/toast';
import { useConfirm } from '../lib/ConfirmDialog';
import { ApiError } from '../lib/api';
import '../lib/data-views.css';

export function AdminOrgDetailPage() {
  const { id = '' } = useParams();
  const { accessToken } = useAdminAuth();
  const confirm = useConfirm();
  const [d, setD] = useState<AdminOrgDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [editUser, setEditUser] = useState<MemberView | null>(null);

  const load = useCallback(async () => {
    if (!accessToken) return;
    try {
      setD(await adminApi.organization(accessToken, id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur.');
    }
  }, [accessToken, id]);

  useEffect(() => {
    load();
  }, [load]);

  async function setModule(m: AdminOrgModule, action: 'activate' | 'suspend' | 'cancel') {
    if (!accessToken) return;
    const verb = action === 'activate' ? 'Activer' : action === 'suspend' ? 'Suspendre' : 'Annuler';
    const ok = await confirm({
      title: `${verb} le module`,
      message: (
        <>
          Module « <strong>{m.name}</strong> » pour cette organisation ?
        </>
      ),
      confirmLabel: verb,
      tone: action === 'activate' ? 'default' : 'danger',
    });
    if (!ok) return;
    setBusyKey(m.key);
    try {
      await adminApi.setModule(accessToken, id, m.key, action);
      toast.success(`Module ${m.name} : ${action === 'activate' ? 'activé' : action === 'suspend' ? 'suspendu' : 'annulé'}.`);
      await load();
    } catch (err) {
      const e = err as ApiError;
      if (e.body && (e.body as { error?: string }).error === 'missing_dependencies') {
        const missing = (e.body as { missing?: string[] }).missing?.join(', ');
        const force = await confirm({
          title: 'Dépendances manquantes',
          message: `Ce module dépend de : ${missing}. L'activer quand même, sans ses dépendances ?`,
          confirmLabel: 'Activer quand même',
          tone: 'danger',
        });
        if (force) {
          await adminApi.setModule(accessToken, id, m.key, 'activate', true).then(load).catch(() => toast.error('Échec.'));
        }
      } else {
        toast.error(e.message ?? 'Échec.');
      }
    } finally {
      setBusyKey(null);
    }
  }

  async function setDevice(deviceId: string, action: 'deactivate' | 'revoke') {
    if (!accessToken) return;
    const ok = await confirm({
      title: action === 'revoke' ? 'Révoquer l’appareil' : 'Désactiver l’appareil',
      message:
        action === 'revoke'
          ? 'L’appareil sera révoqué ; sa réactivation nécessitera le support. Continuer ?'
          : 'Le poste sera libéré immédiatement et l’appareil passera en consultation seule.',
      confirmLabel: action === 'revoke' ? 'Révoquer' : 'Désactiver',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await adminApi.setDevice(accessToken, deviceId, action);
      toast.success('Appareil mis à jour.');
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Échec.');
    }
  }

  if (error) return <AdminShell title="Organisation"><div className="error-banner">{error}</div></AdminShell>;
  if (!d) return <AdminShell title="Organisation"><div className="page-loader"><span className="spinner" /> Chargement…</div></AdminShell>;

  return (
    <AdminShell
      title={d.organization.name}
      subtitle={`${d.organization.email ?? '—'} · plan ${d.organization.plan} · créée le ${new Date(d.organization.createdAt).toLocaleDateString('fr-FR')}`}
      actions={
        <Link className="btn-secondary" to="/admin/organizations">
          <Icon name="chevronLeft" size={14} /> Organisations
        </Link>
      }
    >
      <div className="admin-kpis">
        <div className="admin-kpi"><div className="num">{d.users.length}</div><div className="label">Utilisateurs</div></div>
        <div className="admin-kpi"><div className="num">{d.sites.length}</div><div className="label">Sites</div></div>
        <div className="admin-kpi"><div className="num">{d.seats.used} / {d.seats.total}</div><div className="label">Postes</div></div>
        <div className="admin-kpi"><div className="num">{d.organization.seatsPerSite}</div><div className="label">Postes / site</div></div>
      </div>

      <h3 className="section-title">Modules &amp; abonnement</h3>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Module</th><th>Statut</th><th /></tr></thead>
          <tbody>
            {d.modules.map((m) => (
              <tr key={m.key}>
                <td>{m.name}{m.dependencies.length > 0 && <span className="muted"> · dépend de {m.dependencies.join(', ')}</span>}</td>
                <td>
                  {m.active ? <span className="pill success">{m.status === 'trial' ? 'Essai' : 'Actif'}</span> : m.status === 'none' ? <span className="muted">Non souscrit</span> : <span className="pill danger">{m.status}</span>}
                </td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {m.active ? (
                    <>
                      <button className="btn-link" disabled={busyKey === m.key} onClick={() => setModule(m, 'suspend')}>Suspendre</button>
                      <button className="btn-link danger" style={{ marginLeft: 10 }} disabled={busyKey === m.key} onClick={() => setModule(m, 'cancel')}>Annuler</button>
                    </>
                  ) : (
                    <button className="btn-secondary" disabled={busyKey === m.key} onClick={() => setModule(m, 'activate')}>Activer</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="section-title">Utilisateurs</h3>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Utilisateur</th><th>Rôle / accès</th><th>Statut</th><th /></tr></thead>
          <tbody>
            {d.users.map((u) => (
              <tr key={u.id}>
                <td>{u.displayName ?? u.username ?? u.email}{u.username && <span className="muted"> @{u.username}</span>}</td>
                <td>{u.isAdmin ? u.roleName : (u.access?.modules.map((m) => m.key).join(', ') || '—')}</td>
                <td>{u.isActive ? <span className="pill success">Actif</span> : <span className="pill danger">Désactivé</span>}</td>
                <td style={{ textAlign: 'right' }}><button className="btn-link" onClick={() => setEditUser(u)}>Modifier</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="section-title">Appareils</h3>
      {d.devices.length === 0 ? (
        <div className="empty-state">Aucun appareil activé.</div>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Appareil</th><th>Statut</th><th>Licence jusqu'au</th><th /></tr></thead>
            <tbody>
              {d.devices.map((dev) => (
                <tr key={dev.id}>
                  <td>{dev.deviceLabel ?? 'Sans nom'}</td>
                  <td><span className={`pill ${dev.status === 'active' ? 'success' : dev.status === 'revoked' ? 'danger' : 'info'}`}>{dev.status}</span></td>
                  <td>{new Date(dev.licenseExpiresAt).toLocaleDateString('fr-FR')}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {dev.status === 'active' && (
                      <>
                        <button className="btn-link" onClick={() => setDevice(dev.id, 'deactivate')}>Désactiver</button>
                        <button className="btn-link danger" style={{ marginLeft: 10 }} onClick={() => setDevice(dev.id, 'revoke')}>Révoquer</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editUser && accessToken && (
        <AdminUserModal token={accessToken} orgId={id} user={editUser} sites={d.sites} onClose={() => setEditUser(null)} onSaved={load} />
      )}
    </AdminShell>
  );
}
