import { useCallback, useEffect, useState } from 'react';
import { ApiError, AppUpdateState, localApi } from './api';
import { useAuth } from './auth-context';
import { Icon } from './Icon';
import { toast } from './toast';

const mo = (n?: number) => `${((n ?? 0) / 1e6).toFixed(0)} Mo`;

/**
 * Desktop app only: sidebar row to look for a new version of Stockily and install it.
 * The work is done by the desktop shell (it owns the updater); this follows its progress.
 * One quiet check shortly after opening shows the alert dot when something new is out.
 */
export function UpdateRow({ onNavigate }: { onNavigate?: () => void }) {
  const { accessToken } = useAuth();
  const [u, setU] = useState<AppUpdateState | null>(null);
  const [justChecked, setJustChecked] = useState(false);
  const busy = u?.phase === 'checking' || u?.phase === 'downloading';

  const load = useCallback(async () => {
    if (!accessToken) return;
    setU(await localApi.update(accessToken).catch(() => null));
  }, [accessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  // A silent look ~15 s after opening (not on every page change: the shell is asked once per app session).
  useEffect(() => {
    if (!accessToken || sessionStorage.getItem('stockily-update-checked')) return;
    const t = setTimeout(() => {
      sessionStorage.setItem('stockily-update-checked', '1');
      localApi.checkUpdate(accessToken).then(setU).catch(() => undefined);
    }, 15_000);
    return () => clearTimeout(t);
  }, [accessToken]);

  // Follow the shell while it works.
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => void load(), 1000);
    return () => clearInterval(t);
  }, [busy, load]);

  // "À jour ✓" fades back to the plain row after a few seconds.
  useEffect(() => {
    if (u?.phase !== 'uptodate') return;
    setJustChecked(true);
    const t = setTimeout(() => setJustChecked(false), 5000);
    return () => clearTimeout(t);
  }, [u?.phase, u?.checkedAt]);

  async function run(kind: 'check' | 'install') {
    if (!accessToken) return;
    onNavigate?.();
    try {
      setU(await (kind === 'check' ? localApi.checkUpdate(accessToken) : localApi.installUpdate(accessToken)));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Échec.');
    }
  }

  if (!u) return null;
  const pct = u.total ? Math.min(100, Math.round(((u.downloaded ?? 0) / u.total) * 100)) : null;
  const version = u.current ? `Version ${u.current}` : 'Stockily';

  if (u.phase === 'available') {
    return (
      <button type="button" className="shell-update is-available" onClick={() => run('install')} title={u.notes || undefined}>
        <span className="shell-update-dot" />
        <Icon name="download" size={16} />
        <span className="shell-update-text">
          <b>Version {u.version} disponible</b>
          <small>Installer et redémarrer</small>
        </span>
      </button>
    );
  }

  if (u.phase === 'downloading') {
    return (
      <div className="shell-update is-busy" role="status">
        <Icon name="download" size={16} />
        <span className="shell-update-text">
          <b>Mise à jour… {pct !== null ? `${pct} %` : mo(u.downloaded)}</b>
          <small>{pct !== null ? `${mo(u.downloaded)} sur ${mo(u.total)} · ` : ''}Stockily va redémarrer</small>
          <span className="shell-update-bar">
            <span style={{ width: `${pct ?? 5}%` }} />
          </span>
        </span>
      </div>
    );
  }

  return (
    <>
      <button type="button" className="shell-update" onClick={() => run('check')} disabled={busy} title="Rechercher une mise à jour de Stockily">
        <Icon name="refresh" size={16} className={u.phase === 'checking' ? 'spin' : undefined} />
        <span className="shell-update-text">
          <b>{u.phase === 'checking' ? 'Recherche…' : justChecked ? 'Stockily est à jour ✓' : 'Rechercher une mise à jour'}</b>
          <small>{version}</small>
        </span>
      </button>
      {u.phase === 'error' && <div className="shell-update-error">{u.error}</div>}
    </>
  );
}
