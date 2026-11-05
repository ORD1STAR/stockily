import { FormEvent, useState } from 'react';
import { useAdminAuth } from './admin-auth-context';
import { ApiError } from '../lib/api';
import './admin.css';

export function AdminLoginPage() {
  const { login } = useAdminAuth();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(identifier, password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Échec de la connexion.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#1d1b26' }}>
      <form onSubmit={submit} style={{ width: 'min(400px, calc(100vw - 32px))', background: '#fff', borderRadius: 16, padding: 32 }}>
        <div style={{ fontWeight: 700, fontSize: '1.3rem', marginBottom: 4 }}>
          Stockily <span style={{ fontSize: '0.65rem', background: '#5b3fd1', color: '#fff', borderRadius: 6, padding: '2px 6px' }}>ADMIN</span>
        </div>
        <p style={{ color: '#6b6880', marginTop: 0, marginBottom: 20, fontSize: '0.9rem' }}>Console d'administration de la plateforme</p>
        {error && <div className="error-banner" style={{ marginBottom: 12 }}>{error}</div>}
        <div className="field-row">
          <label>Email ou identifiant</label>
          <input value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" required />
        </div>
        <div className="field-row">
          <label>Mot de passe</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </div>
        <button className="btn-primary" type="submit" disabled={busy} style={{ width: '100%', marginTop: 8 }}>
          {busy ? 'Connexion…' : 'Se connecter'}
        </button>
      </form>
    </div>
  );
}
