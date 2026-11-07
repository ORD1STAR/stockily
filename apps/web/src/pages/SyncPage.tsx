import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { AppShell } from '../lib/AppShell';
import { Icon } from '../lib/Icon';
import { useAuth } from '../lib/auth-context';
import { ApiError, OutboxEntryView, localApi } from '../lib/api';
import { describeEntry, refreshDesktopStatus, useDesktopStatus } from '../lib/desktop';
import { toast } from '../lib/toast';
import { useConfirm } from '../lib/ConfirmDialog';
import '../lib/data-views.css';

const ago = (d: string | null) => {
  if (!d) return 'jamais';
  const min = Math.round((Date.now() - new Date(d).getTime()) / 60_000);
  if (min < 1) return 'à l’instant';
  if (min < 60) return `il y a ${min} min`;
  return new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};

// Desktop app only: what this poste has saved locally and not yet (or not
// successfully) sent to the server. Failed entries are business refusals
// from the server — never fixed silently; a person retries or abandons them.
export function SyncPage() {
  const { accessToken, me } = useAuth();
  const confirm = useConfirm();
  const status = useDesktopStatus();
  const [entries, setEntries] = useState<OutboxEntryView[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const isAdmin = !!me?.roles.some((r) => r.role === 'Super Admin' || r.role === 'Gestionnaire');

  const load = useCallback(async () => {
    if (!accessToken) return;
    try {
      setEntries(await localApi.outbox(accessToken));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erreur de chargement.');
    }
  }, [accessToken]);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  if (status === null) return <Navigate to="/dashboard" replace />;

  async function act(id: string, action: 'retry' | 'discard') {
    if (!accessToken) return;
    if (action === 'discard') {
      const ok = await confirm({
        title: 'Abandonner cette saisie',
        message: 'Elle ne sera jamais envoyée au serveur et disparaîtra de ce poste à la prochaine synchronisation.',
        confirmLabel: 'Abandonner',
        tone: 'danger',
      });
      if (!ok) return;
    }
    setBusy(id);
    try {
      await (action === 'retry' ? localApi.retry(accessToken, id) : localApi.discard(accessToken, id));
      toast.success(action === 'retry' ? 'Nouvel essai lancé.' : 'Saisie abandonnée.');
      await Promise.all([load(), refreshDesktopStatus()]);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Échec.');
    } finally {
      setBusy(null);
    }
  }

  async function syncNow() {
    if (!accessToken) return;
    await localApi.syncNow(accessToken).catch(() => undefined);
    toast.success('Synchronisation lancée.');
    setTimeout(() => void Promise.all([load(), refreshDesktopStatus()]), 2500);
  }

  const failed = entries.filter((e) => e.status === 'failed');
  const pending = entries.filter((e) => e.status === 'pending');

  return (
    <AppShell>
      <div className="panel-head">
        <div>
          <h2>Synchronisation</h2>
          <div className="sub">
            {status?.online ? 'Connecté au serveur' : 'Hors ligne, vos saisies sont enregistrées sur ce poste'} · envoi {ago(status?.lastPushAt ?? null)} ·
            mise à jour {ago(status?.lastPullAt ?? null)}
          </div>
        </div>
        <button className="btn-primary" onClick={syncNow} disabled={!status?.online || status?.syncing}>
          <Icon name="refresh" size={16} /> {status?.syncing ? 'Synchronisation…' : 'Synchroniser maintenant'}
        </button>
      </div>

      {status?.lastError && !status.online && <div className="error-banner">{status.lastError}</div>}


      <div className="stat-strip">
        <div className={`stat-card${status?.online ? ' good' : ' warn'}`}>
          <div className="num">{status?.online ? 'En ligne' : 'Hors ligne'}</div>
          <div className="label">Connexion</div>
        </div>
        <div className={`stat-card${pending.length ? ' warn' : ''}`}>
          <div className="num">{pending.length}</div>
          <div className="label">En attente d’envoi</div>
        </div>
        <div className={`stat-card${failed.length ? ' bad' : ''}`}>
          <div className="num">{failed.length}</div>
          <div className="label">Refusées par le serveur</div>
        </div>
        <div className="stat-card">
          <div className="num">{status?.licenseExpiresAt ? new Date(status.licenseExpiresAt).toLocaleDateString('fr-FR') : '—'}</div>
          <div className="label">Licence valable jusqu’au</div>
        </div>
      </div>

      {failed.length > 0 && (
        <>
          <h3 className="section-title">Refusées par le serveur</h3>
          <div className="sub" style={{ marginBottom: 8 }}>
            Le serveur fait foi : ces saisies n’ont pas été appliquées (par exemple, le stock avait déjà été vendu depuis un autre poste). Corrigez la
            situation si besoin, puis réessayez, ou abandonnez la saisie.
          </div>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Saisie</th>
                  <th>Opération</th>
                  <th>Motif du refus</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {failed.map((e) => (
                  <tr key={e.id}>
                    <td>{ago(e.createdAt)}</td>
                    <td>{describeEntry(e.method, e.path)}</td>
                    <td>{e.lastError ?? `Erreur ${e.httpStatus}`}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button className="btn-link" disabled={busy === e.id || !status?.online} onClick={() => act(e.id, 'retry')}>
                        Réessayer
                      </button>
                      {isAdmin && (
                        <button className="btn-link danger" disabled={busy === e.id} onClick={() => act(e.id, 'discard')} style={{ marginLeft: 12 }}>
                          Abandonner
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h3 className="section-title">En attente d’envoi</h3>
      {pending.length === 0 ? (
        <div className="empty-state">Tout est à jour : aucune saisie en attente sur ce poste.</div>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Saisie</th>
                <th>Opération</th>
                <th>Dernier essai</th>
              </tr>
            </thead>
            <tbody>
              {pending.map((e) => (
                <tr key={e.id}>
                  <td>{ago(e.createdAt)}</td>
                  <td>{describeEntry(e.method, e.path)}</td>
                  <td>{e.attempts ? e.lastError ?? `${e.attempts} essai(s)` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}

export default SyncPage;
