import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { SuggestionModal } from '../site/SuggestionModal';
import { useAuth } from './auth-context';
import { useDesktopStatus } from './desktop';
import { Icon } from './Icon';
import { flushSuggestions } from './suggestion-queue';

const EVERY_MS = 15 * 24 * 60 * 60 * 1000;
const SHOW_AFTER_MS = 4000;
// Pages where a popup would interrupt work at the counter.
const BUSY_PAGES = ['/scan', '/counters', '/cash'];

const storageKey = (userId: string) => `stockily.feedbackPrompt.${userId}`;

function readLast(userId: string): number | null | undefined {
  try {
    const v = localStorage.getItem(storageKey(userId));
    if (v === null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  } catch {
    return undefined; // storage unavailable: never prompt
  }
}

function saveLast(userId: string, at: number) {
  try {
    localStorage.setItem(storageKey(userId), String(at));
  } catch {
    /* storage unavailable */
  }
}

/**
 * Asks "Une idée pour améliorer Stockily ?" (Oui / Non); "Oui" opens the "Proposer des ajouts"
 * form. Shown once to every account, then again 15 days after it was last closed (whatever the
 * answer). Remembered per user on this device. Works offline in the desktop app: the proposal
 * is kept and sent once the connection is back.
 */
export function FeedbackPrompt() {
  const { me, accessToken } = useAuth();
  const desktop = useDesktopStatus();
  const { pathname } = useLocation();
  const [step, setStep] = useState<'idle' | 'ask' | 'form'>('idle');

  const userId = me?.user.id;
  const offline = !!desktop && !desktop.online;
  const busy = BUSY_PAGES.some((p) => pathname.startsWith(p));

  useEffect(() => {
    if (!userId || busy || step !== 'idle') return;
    const last = readLast(userId);
    if (last === undefined) return;
    if (last !== null && Date.now() - last < EVERY_MS) return;
    const t = setTimeout(() => setStep('ask'), SHOW_AFTER_MS);
    return () => clearTimeout(t);
  }, [userId, busy, step]);

  // Send proposals written while offline as soon as the connection is back.
  useEffect(() => {
    if (offline || !accessToken) return;
    void flushSuggestions(accessToken);
  }, [offline, accessToken]);

  // Closing the prompt, whatever the answer, starts the next 15 days.
  const answer = (next: 'idle' | 'form') => {
    if (userId) saveLast(userId, Date.now());
    setStep(next);
  };

  useEffect(() => {
    if (step !== 'ask') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (userId) saveLast(userId, Date.now());
      setStep('idle');
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [step, userId]);

  if (step === 'form') return <SuggestionModal onClose={() => setStep('idle')} />;
  if (step !== 'ask') return null;
  return (
    <div className="modal-backdrop open" onMouseDown={(e) => e.target === e.currentTarget && answer('idle')}>
      <div className="modal fb-prompt" role="dialog" aria-modal="true" aria-labelledby="fb-title">
        <span className="fb-prompt-icon">
          <Icon name="sparkles" size={24} />
        </span>
        <h3 id="fb-title">Une idée pour améliorer Stockily ?</h3>
        <p>Une fonction vous manque, ou quelque chose pourrait être plus simple ? Chaque proposition est lue par l’équipe.</p>
        <div className="fb-prompt-actions">
          <button type="button" className="btn-secondary" onClick={() => answer('idle')}>
            Non
          </button>
          <button type="button" className="btn-primary" onClick={() => answer('form')} autoFocus>
            Oui
          </button>
        </div>
      </div>
    </div>
  );
}
