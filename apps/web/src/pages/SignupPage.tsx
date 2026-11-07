import { FormEvent, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth-context';
import { ApiError, OtpChallenge } from '../lib/api';
import { OtpStep } from './OtpStep';
import { AuthLayout } from './AuthLayout';

export function SignupPage() {
  const { me, signup, verifyOtp } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // Only same-site paths — never an absolute URL (open redirect).
  const rawNext = params.get('next');
  const next = rawNext && rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/dashboard';
  const [organizationName, setOrganizationName] = useState('');
  const [email, setEmail] = useState('');
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
      const c = await signup(organizationName, email, password);
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
      title={challenge ? 'Confirmez votre e-mail' : 'Créer votre compte'}
      subtitle={challenge ? 'Dernière étape avant d’accéder à votre essai gratuit.' : 'Essai gratuit de 15 jours, sans carte bancaire.'}
    >
      {challenge ? (
        <OtpStep
          challenge={challenge}
          onVerify={async (id, code) => {
            await verifyOtp(id, code);
            navigate(next, { replace: true });
          }}
          onBack={() => setChallenge(null)}
        />
      ) : (
      <form className="auth-card-form" onSubmit={handleSubmit}>

        {error && <div className="error-banner">{error}</div>}

        <div className="field-row">
          <label htmlFor="organizationName">Nom de l'entreprise</label>
          <input
            id="organizationName"
            required
            minLength={2}
            value={organizationName}
            onChange={(e) => setOrganizationName(e.target.value)}
          />
        </div>
        <div className="field-row">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="vous@entreprise.dz"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="field-row">
          <label htmlFor="password">Mot de passe</label>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        <button className="btn-primary" type="submit" disabled={submitting}>
          {submitting ? 'Création…' : "Créer mon compte"}
        </button>

        <p className="auth-switch">
          Déjà un compte ? <Link to={`/login${rawNext ? `?next=${encodeURIComponent(next)}` : ''}`}>Se connecter</Link>
        </p>
      </form>
      )}
    </AuthLayout>
  );
}

export default SignupPage;
