import { FormEvent, useCallback, useEffect, useState } from 'react';
import { AppShell } from '../lib/AppShell';
import { PageSkeleton } from '../lib/PageSkeleton';
import { Icon } from '../lib/Icon';
import { useAuth } from '../lib/auth-context';
import { ApiError, GrantableModule, MemberView, Site, membersApi, sitesApi } from '../lib/api';
import { AccessEditor, AccessState, buildAccess, initialAccess } from '../lib/AccessEditor';
import { toast } from '../lib/toast';
import '../lib/data-views.css';
import './members.css';


export function MembersPage() {
  const { accessToken } = useAuth();
  const [members, setMembers] = useState<MemberView[]>([]);
  const [modules, setModules] = useState<GrantableModule[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<MemberView | 'new' | null>(null);

  const load = useCallback(async () => {
    if (!accessToken) return;
    setError(null);
    try {
      const [m, mods, s] = await Promise.all([membersApi.list(accessToken), membersApi.grantableModules(accessToken), sitesApi.list(accessToken)]);
      setMembers(m);
      setModules(mods);
      setSites(s);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur de chargement.');
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    load();
  }, [load]);

  async function toggleActive(m: MemberView) {
    if (!accessToken) return;
    try {
      if (m.isActive) await membersApi.deactivate(accessToken, m.id);
      else await membersApi.update(accessToken, m.id, { isActive: true });
      toast.success(m.isActive ? 'Utilisateur désactivé.' : 'Utilisateur réactivé.');
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Échec.');
    }
  }

  const moduleName = (key: string) => modules.find((x) => x.key === key)?.name ?? key;

  return (
    <AppShell>
      <div className="panel-head">
        <div>
          <h2>Utilisateurs</h2>
          <div className="sub">Les sous-utilisateurs de votre organisation et leurs accès</div>
        </div>
        <button className="btn-primary" onClick={() => setEditing('new')}>
          <Icon name="plus" size={16} /> Nouvel utilisateur
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {loading ? (
        <PageSkeleton />
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Utilisateur</th>
                <th>Accès</th>
                <th>Sites</th>
                <th>Statut</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id} className={m.isActive ? undefined : 'row-dim'}>
                  <td>
                    <div className="cell-title">{m.displayName ?? m.username ?? m.email}</div>
                    <div className="cell-sub">{m.username ? `@${m.username}` : m.email}</div>
                  </td>
                  <td>
                    {m.isAdmin ? (
                      <span className="chip">{m.roleName}</span>
                    ) : m.access && m.access.modules.length > 0 ? (
                      <div className="chip-wrap">
                        {m.access.modules.map((mod) => (
                          <span key={mod.key} className={`chip${mod.level === 'edit' ? ' chip-edit' : ''}`}>
                            {moduleName(mod.key)}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className="muted">
                    {m.isAdmin ? 'Tous' : m.access?.sites === 'all' ? 'Tous' : (m.access?.sites ?? []).map((s) => s.name).join(', ') || '—'}
                  </td>
                  <td>{m.isActive ? <span className="pill success">Actif</span> : <span className="pill danger">Désactivé</span>}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {!m.isAdmin && (
                      <>
                        <button className="btn-link" onClick={() => setEditing(m)}>Modifier</button>
                        <button className="btn-link danger" style={{ marginLeft: 12 }} onClick={() => toggleActive(m)}>
                          {m.isActive ? 'Désactiver' : 'Réactiver'}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {members.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted" style={{ textAlign: 'center', padding: '28px 0' }}>
                    Aucun sous-utilisateur. Créez-en un pour donner un accès limité à un employé.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <MemberModal
          member={editing === 'new' ? null : editing}
          modules={modules}
          sites={sites}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}
    </AppShell>
  );
}

function MemberModal({
  member,
  modules,
  sites,
  onClose,
  onSaved,
}: {
  member: MemberView | null;
  modules: GrantableModule[];
  sites: Site[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { accessToken } = useAuth();
  const isEdit = !!member;
  const [username, setUsername] = useState(member?.username ?? '');
  const [displayName, setDisplayName] = useState(member?.displayName ?? '');
  const [password, setPassword] = useState('');
  const [accessState, setAccessState] = useState<AccessState>(() => initialAccess(member?.access, modules));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const chosenCount = Object.values(accessState.levels).filter((l) => l !== 'none').length;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!accessToken) return;
    setErr(null);
    const built = buildAccess(accessState, modules);
    if ('error' in built) {
      setErr(built.error);
      return;
    }
    const access = built.access;
    setSaving(true);
    try {
      if (isEdit) {
        await membersApi.update(accessToken, member!.id, { displayName, access, ...(password ? { password } : {}) });
        toast.success('Utilisateur mis à jour.');
      } else {
        await membersApi.create(accessToken, { username, displayName, password, access });
        toast.success('Utilisateur créé.');
      }
      onSaved();
    } catch (error) {
      setErr(error instanceof ApiError ? error.message : 'Échec de l’enregistrement.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop open" onMouseDown={onClose}>
      <div className="modal form-md" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-header-titles">
            <h3>{isEdit ? (member?.displayName ?? `@${member?.username}`) : 'Nouvel utilisateur'}</h3>
            <p className="modal-sub">{isEdit ? 'Modifier l’accès de ce sous-utilisateur.' : 'Créez un accès limité pour un employé.'}</p>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Fermer">✕</button>
        </div>

        <form className="field-form" onSubmit={submit}>
          {err && <div className="error-banner" style={{ marginBottom: 14 }}>{err}</div>}

          <div className="field-grid">
            {!isEdit && (
              <div className="field-row">
                <label>Nom d'utilisateur</label>
                <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="caissier1" autoComplete="off" required />
              </div>
            )}
            <div className="field-row">
              <label>Nom affiché</label>
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Caissier Comptoir 1" />
            </div>
            <div className="field-row" style={isEdit ? undefined : { gridColumn: '1 / -1' }}>
              <label>{isEdit ? 'Nouveau mot de passe' : 'Mot de passe'}</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={isEdit ? 'Laisser vide pour ne pas changer' : '6 caractères minimum'} required={!isEdit} minLength={6} autoComplete="new-password" />
            </div>
          </div>

          <AccessEditor modules={modules} sites={sites} value={accessState} onChange={setAccessState} />
        </form>

        <div className="modal-footer">
          <button type="button" className="btn-secondary" onClick={onClose}>Annuler</button>
          <button type="button" className="btn-primary" disabled={saving} onClick={submit}>
            {saving ? 'Enregistrement…' : isEdit ? 'Enregistrer' : `Créer l'utilisateur${chosenCount ? ` (${chosenCount})` : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}

export default MembersPage;
