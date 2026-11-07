import { FormEvent, useEffect, useRef, useState } from 'react';
import { ApiError, authApi, OtpChallenge } from '../lib/api';

/**
 * The "enter the 6-digit code we just emailed you" step, shared by signup
 * (confirm the address) and login (second factor).
 */
export function OtpStep({
  challenge: initial,
  onVerify,
  onBack,
}: {
  challenge: OtpChallenge;
  onVerify: (challengeId: string, code: string) => Promise<void>;
  onBack: () => void;
}) {
  const [challenge, setChallenge] = useState(initial);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(initial.resendIn);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  async function submit(value: string) {
    if (busy || !/^\d{6}$/.test(value)) return;
    setBusy(true);
    setError(null);
    try {
      await onVerify(challenge.challengeId, value);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Une erreur est survenue. Veuillez réessayer.');
      setCode('');
      input.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setError(null);
    setInfo(null);
    try {
      const next = await authApi.resendOtp(challenge.challengeId);
      setChallenge(next);
      setWait(next.resendIn);
      setCode('');
      setInfo('Un nouveau code vient d’être envoyé.');
      input.current?.focus();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Envoi impossible.');
    }
  }

  const verifying = challenge.purpose === 'verify_email';
  return (
    <form
      className="auth-card-form otp-step"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void submit(code);
      }}
    >
      <p className="otp-lead">
        {verifying ? 'Confirmez votre adresse e-mail. ' : 'Connexion sécurisée. '}
        Nous avons envoyé un code à 6 chiffres à <b>{challenge.email}</b>. Il est valable 10 minutes.
      </p>

      {error && <div className="error-banner">{error}</div>}
      {info && !error && <div className="otp-info">{info}</div>}

      <div className="field-row">
        <label htmlFor="otp-code">Code de vérification</label>
        <input
          id="otp-code"
          ref={input}
          className="otp-input"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={6}
          placeholder="••••••"
          value={code}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, '').slice(0, 6);
            setCode(v);
            if (v.length === 6) void submit(v);
          }}
        />
      </div>

      <button className="btn-primary" type="submit" disabled={busy || code.length !== 6}>
        {busy ? 'Vérification…' : verifying ? 'Confirmer mon adresse' : 'Se connecter'}
      </button>

      <div className="otp-actions">
        <button type="button" className="btn-link" onClick={resend} disabled={wait > 0}>
          {wait > 0 ? `Renvoyer le code (${wait} s)` : 'Renvoyer le code'}
        </button>
        <button type="button" className="btn-link" onClick={onBack}>
          {verifying ? 'Changer d’adresse' : 'Retour'}
        </button>
      </div>
      <p className="otp-hint">Rien reçu ? Vérifiez vos courriers indésirables.</p>
    </form>
  );
}
