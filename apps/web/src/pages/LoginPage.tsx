import { FormEvent, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth-context';
import { ApiError, OtpChallenge } from '../lib/api';
import { OtpStep } from './OtpStep';
import { AuthLayout } from './AuthLayout';

export function LoginPage() {
  const { me, login, verifyOtp } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // Only same-site paths — never an absolute URL (open redirect).
  const rawNext = params.get('next');
  const next = rawNext && rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/dashboard';
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [challenge, setChallenge] = useState<OtpChallenge | null>(null);

  if (me) return <Navigate to={next} replace />;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const c = await login(identifier, password);
      if (c) setChallenge(c);
      else navigate(next, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Une erreur est survenue. Veuillez réessayer.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title={challenge ? 'Vérification' : 'Connexion'}
      subtitle={challenge ? 'Entrez le code reçu par e-mail pour terminer la connexion.' : 'Content de vous revoir. Connectez-vous à votre espace.'}
    >
      {challenge ? (
        <OtpStep
          challenge={challenge}
          onVerify={async (id, code) => {
            await verifyOtp(id, code);
            navigate(next, { replace: true });
          }}
          onBack={() => {
            setChallenge(null);
            setPassword('');
          }}
        />
      ) : (
      <form className="auth-card-form" onSubmit={handleSubmit}>

        {error && <div className="error-banner">{error}</div>}

        <div className="field-row">
          <label htmlFor="identifier">Email ou nom d'utilisateur</label>
          <input id="identifier" type="text" autoComplete="username" placeholder="vous@entreprise.dz" required value={identifier} onChange={(e) => setIdentifier(e.target.value)} />
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
          Pas encore de compte ? <Link to={`/signup${rawNext ? `?next=${encodeURIComponent(next)}` : ''}`}>Créer un compte</Link>
        </p>
      </form>
      )}
    </AuthLayout>
  );
}

export default LoginPage;
