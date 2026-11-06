import { FormEvent, useEffect, useState } from 'react';
import { AccessEditor, AccessState, buildAccess, initialAccess } from '../lib/AccessEditor';
import { adminApi } from './admin-api';
import { ApiError, GrantableModule, MemberView } from '../lib/api';
import { toast } from '../lib/toast';

function genPassword() {
  const c = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const a = new Uint32Array(12);
  crypto.getRandomValues(a);
  return Array.from(a, (n) => c[n % c.length]).join('');
}

/** Platform-admin account editor: identity, credentials, status. No password policy. */
export function AdminUserModal({ token, orgId, user, sites, onClose, onSaved }: {
  token: string; orgId: string; user: MemberView; sites: { id: string; name: string }[]; onClose: () => void; onSaved: () => void;
}) {
  const [displayName, setDisplayName] = useState(user.displayName ?? '');
  const [username, setUsername] = useState(user.username ?? '');
  const [email, setEmail] = useState(user.email ?? '');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [isActive, setIsActive] = useState(user.isActive);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [modules, setModules] = useState<GrantableModule[]>([]);
  const [access, setAccess] = useState<AccessState | null>(null);
  const editable = !user.isAdmin; // owners / admins have full access by role

  useEffect(() => {
    if (!editable) return;
    adminApi.grantableModules(token).then((m) => { setModules(m); setAccess(initialAccess(user.access, m)); }).catch(() => undefined);
  }, [token, editable, user.access]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    try {
      await adminApi.updateUserAccount(token, orgId, user.id, {
        displayName,
        username,
        email,
        isActive,
        ...(password ? { password } : {}),
      });
      if (editable && access) {
        const built = buildAccess(access, modules);
        if ('error' in built) throw new ApiError(400, { message: built.error });
        await adminApi.updateUser(token, orgId, user.id, { access: built.access });
      }
      toast.success('Utilisateur mis à jour.');
      onSaved();
      onClose();
    } catch (error) {
      setErr(error instanceof ApiError ? error.message : 'Échec de l’enregistrement.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop open" onMouseDown={onClose}>
      <div className="modal wide" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-header-titles">
            <h3>{user.displayName ?? user.username ?? user.email}</h3>
            <p className="modal-sub">{user.isAdmin ? `Compte administrateur (${user.roleName ?? 'admin'})` : 'Sous-utilisateur'}, aucune restriction de sécurité côté plateforme.</p>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Fermer">✕</button>
        </div>
        <form className="field-form" onSubmit={submit}>
          {err && <div className="error-banner" style={{ marginBottom: 14 }}>{err}</div>}
          <div className="field-grid">
            <div className="field-row">
              <label>Nom affiché</label>
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </div>
            <div className="field-row">
              <label>Nom d'utilisateur</label>
              <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
            </div>
            <div className="field-row" style={{ gridColumn: '1 / -1' }}>
              <label>Email</label>
              <input value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
            </div>
            <div className="field-row" style={{ gridColumn: '1 / -1' }}>
              <label>Nouveau mot de passe</label>
              <div className="admin-pw">
                <input type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Laisser vide pour ne pas changer" autoComplete="new-password" />
                <button type="button" className="btn-secondary" onClick={() => setShow((s) => !s)}>{show ? 'Masquer' : 'Afficher'}</button>
                <button type="button" className="btn-secondary" onClick={() => { setPassword(genPassword()); setShow(true); }}>Générer</button>
              </div>
              <span className="muted" style={{ fontSize: '0.78rem' }}>Toute longueur acceptée. Changer le mot de passe déconnecte l'utilisateur.</span>
            </div>
          </div>
          {editable && access && <div style={{ marginTop: 18 }}><AccessEditor modules={modules} sites={sites} value={access} onChange={setAccess} /></div>}
          <label className="admin-active-toggle">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            Compte actif
          </label>
          <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
            <button type="button" className="btn-secondary" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
