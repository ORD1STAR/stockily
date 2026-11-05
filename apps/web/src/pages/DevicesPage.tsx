import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '../lib/AppShell';
import { Icon } from '../lib/Icon';
import { useAuth } from '../lib/auth-context';
import { ApiError, DeviceView, ReplayView, SeatUsage, licensingApi } from '../lib/api';
import { describeEntry } from '../lib/desktop';
import { toast } from '../lib/toast';
import { useConfirm } from '../lib/ConfirmDialog';
import '../lib/data-views.css';

const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const fmtDateTime = (d: string) => new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

const STATUS: Record<DeviceView['status'], { label: string; cls: string }> = {
  active: { label: 'Actif', cls: 'success' },
  deactivated: { label: 'Désactivé', cls: 'info' },
  revoked: { label: 'Révoqué', cls: 'danger' },
};

// Org admins: the desktop-app seats (postes) of the organization. Freeing a
// seat takes effect immediately — no cooldown, by design.
export function DevicesPage() {
  const { accessToken } = useAuth();
  const confirm = useConfirm();
  const [seats, setSeats] = useState<SeatUsage | null>(null);
  const [devices, setDevices] = useState<DeviceView[]>([]);
  const [failed, setFailed] = useState<ReplayView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accessToken) return;
    setError(null);
    try {
      const [d, f] = await Promise.all([licensingApi.devices(accessToken), licensingApi.failedReplays(accessToken)]);
      setSeats(d.seats);
      setDevices(d.devices);
      setFailed(f);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur de chargement.');
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    load();
  }, [load]);

  async function deactivate(d: DeviceView) {
    if (!accessToken) return;
    const ok = await confirm({
      title: 'Désactiver l’appareil',
      message: (
        <>
          Désactiver « <strong>{d.deviceLabel ?? 'cet appareil'}</strong> » ? Son poste est libéré immédiatement ; l’appareil passe en consultation seule jusqu’à sa réactivation.
        </>
      ),
      confirmLabel: 'Désactiver',
      tone: 'danger',
    });
    if (!ok) return;
    setBusyId(d.id);
    try {
      await licensingApi.deactivate(accessToken, d.id);
      toast.success('Appareil désactivé — poste libéré.');
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Échec de la désactivation.');
    } finally {
      setBusyId(null);
    }
  }

  const labelOf = (id: string) => devices.find((d) => d.id === id)?.deviceLabel ?? 'Appareil';

  return (
    <AppShell>
      <div className="panel-head">
        <div>
          <h2>Appareils</h2>
          <div className="sub">Postes de l’application de bureau (fonctionnement hors ligne)</div>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {loading ? (
        <div className="page-loader"><span className="spinner" /> Chargement…</div>
      ) : (
        <>
          {seats && (
            <div className="stat-strip">
              <div className={`stat-card${seats.used >= seats.total ? ' warn' : ' good'}`}>
                <div className="num">
                  {seats.used} / {seats.total}
                </div>
                <div className="label">Postes utilisés</div>
              </div>
              <div className="stat-card">
                <div className="num">{seats.seatsPerSite}</div>
                <div className="label">
                  Postes par site × {seats.sites} site{seats.sites > 1 ? 's' : ''}
                </div>
              </div>
              <div className={`stat-card${failed.length ? ' bad' : ''}`}>
                <div className="num">{failed.length}</div>
                <div className="label">Synchronisations refusées</div>
              </div>
            </div>
          )}

          <h3 className="section-title">Postes</h3>
          {devices.length === 0 ? (
            <div className="empty-state">
              Aucun appareil activé. Installez l’application de bureau Stockily sur un ordinateur du magasin ou du dépôt et connectez-vous : il
              occupera un poste et fonctionnera ensuite même sans internet.
            </div>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Appareil</th>
                    <th>Statut</th>
                    <th>Activé le</th>
                    <th>Dernière connexion</th>
                    <th>Licence jusqu’au</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {devices.map((d) => (
                    <tr key={d.id}>
                      <td>
                        <Icon name="monitor" size={15} /> {d.deviceLabel ?? 'Appareil sans nom'}
                        {d.reactivationCount > 0 && (
                          <span className="muted" title="Réactivations après changement de matériel ou libération">
                            {' '}· {d.reactivationCount} réactivation{d.reactivationCount > 1 ? 's' : ''}
                          </span>
                        )}
                      </td>
                      <td>
                        <span className={`pill ${STATUS[d.status].cls}`}>{STATUS[d.status].label}</span>
                      </td>
                      <td>{fmtDate(d.activatedAt)}</td>
                      <td>{fmtDate(d.lastRenewedAt)}</td>
                      <td>{d.status === 'active' ? fmtDate(d.licenseExpiresAt) : '—'}</td>
                      <td style={{ textAlign: 'right' }}>
                        {d.status === 'active' && (
                          <button className="btn-link danger" disabled={busyId === d.id} onClick={() => deactivate(d)}>
                            Désactiver
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h3 className="section-title">Synchronisations refusées</h3>
          {failed.length === 0 ? (
            <div className="empty-state">Aucune. Tout ce qui a été saisi hors ligne a bien été enregistré sur le serveur.</div>
          ) : (
            <>
              <div className="sub" style={{ marginBottom: 8 }}>
                Saisies faites hors ligne que le serveur a refusées (par exemple un article vendu en même temps sur deux postes). Rien n’est corrigé
                automatiquement : vérifiez-les depuis la page Synchronisation de l’appareil concerné.
              </div>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Appareil</th>
                      <th>Opération</th>
                      <th>Motif</th>
                    </tr>
                  </thead>
                  <tbody>
                    {failed.map((f) => (
                      <tr key={f.id}>
                        <td>{fmtDateTime(f.createdAt)}</td>
                        <td>{labelOf(f.deviceActivationId)}</td>
                        <td>{describeEntry(f.method, f.path)}</td>
                        <td>{f.error ?? `Erreur ${f.httpStatus}`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </AppShell>
  );
}

export default DevicesPage;
