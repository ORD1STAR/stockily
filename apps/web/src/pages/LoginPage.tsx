import { FormEvent, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth-context';
import { ApiError } from '../lib/api';
import { AuthLayout } from './AuthLayout';

export function LoginPage() {
  const { me, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (me) return <Navigate to="/dashboard" replace />;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Une erreur est survenue. Veuillez réessayer.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout title="Connexion" subtitle="Content de vous revoir. Connectez-vous à votre espace.">
      <form className="auth-card-form" onSubmit={handleSubmit}>

        {error && <div className="error-banner">{error}</div>}

        <div className="field-row">
          <label htmlFor="email">Email</label>
          <input id="email" type="email" autoComplete="email" placeholder="vous@entreprise.dz" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field-row">
          <label htmlFor="password">Mot de passe</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        <button className="btn-primary" type="submit" disabled={submitting}>
          {submitting ? 'Connexion…' : 'Se connecter'}
        </button>

        <p className="auth-switch">
          Pas encore de compte ? <Link to="/signup">Créer un compte</Link>
        </p>
      </form>
    </AuthLayout>
  );
}

export default LoginPage;
