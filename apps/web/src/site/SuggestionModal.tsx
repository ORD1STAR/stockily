import { FormEvent, useEffect, useState } from 'react';
import { ApiError, suggestionsApi } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { Icon } from '../lib/Icon';

const ACTIVITIES = [
  ['retail', 'Commerce de détail'],
  ['wholesale', 'Grossiste'],
  ['distribution', 'Distribution'],
  ['production', 'Production'],
  ['services', 'Services'],
  ['other', 'Autre'],
];
const AREAS = [
  ['stock', 'Stock & Inventaire'],
  ['quality', 'Qualité'],
  ['scan', 'Scan & Comptoirs'],
  ['invoicing', 'Factures'],
  ['sales', 'Ventes'],
  ['purchasing', 'Achats'],
  ['cash', 'Caisse'],
  ['sites', 'Multi-sites'],
  ['stats', 'Statistiques'],
  ['new_module', 'Un nouveau module'],
  ['mobile', 'Application mobile ou PC'],
  ['other', 'Autre chose'],
];
const PRIORITIES = [
  ['must_have', 'Indispensable', 'Sans ça, je ne peux pas travailler'],
  ['useful', 'Utile', 'Ça me ferait gagner du temps'],
  ['nice_to_have', 'Confort', 'Ce serait un plus'],
];

// Public form (no account needed) that feeds the admin console's
// "Propositions" page.
export function SuggestionModal({ onClose }: { onClose: () => void }) {
  const { me } = useAuth();
  const [email, setEmail] = useState(me?.user.email ?? '');
  const [name, setName] = useState(me?.user.displayName ?? '');
  const [activity, setActivity] = useState('');
  const [area, setArea] = useState('');
  const [need, setNeed] = useState('');
  const [priority, setPriority] = useState('useful');
  const [currentTool, setCurrentTool] = useState('');
  const [website, setWebsite] = useState(''); // honeypot
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !sending && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose, sending]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSending(true);
    try {
      await suggestionsApi.send({
        email: email.trim(),
        name: name.trim() || undefined,
        activity: activity || undefined,
        area: area || undefined,
        need: need.trim(),
        priority,
        currentTool: currentTool.trim() || undefined,
        website: website || undefined,
      });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 429 ? 'Vous avez envoyé plusieurs messages à la suite. Réessayez dans quelques minutes.' : err instanceof ApiError ? err.message : 'Envoi impossible pour le moment. Réessayez.');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="modal-backdrop open" onMouseDown={(e) => e.target === e.currentTarget && !sending && onClose()}>
      <div className="modal wide sg-modal" role="dialog" aria-modal="true" aria-labelledby="sg-title">
        <div className="modal-header">
          <div className="modal-header-titles">
            <h3 id="sg-title">{sent ? 'Merci, c’est bien reçu !' : 'Proposer des ajouts'}</h3>
            <p className="modal-sub">{sent ? 'Chaque proposition est lue par l’équipe Stockily.' : 'Une fonction manque ? Dites-nous ce qui vous ferait gagner du temps.'}</p>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Fermer" disabled={sending}>
            <Icon name="x" size={18} />
          </button>
        </div>

        {sent ? (
          <div className="bl-done">
            <span className="bl-done-icon">
              <Icon name="check" size={28} strokeWidth={2.6} />
            </span>
            <p>Nous étudions votre besoin et vous répondons par email si nous avons besoin de précisions.</p>
            <div className="bl-done-actions">
              <button type="button" className="btn-primary" onClick={onClose}>
                Fermer
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="sg-form">
            {error && <div className="error-banner">{error}</div>}
            <div className="sg-grid">
              <div className="field-row">
                <label htmlFor="sg-email">Votre email *</label>
                <input id="sg-email" type="email" required autoComplete="email" placeholder="vous@entreprise.dz" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="field-row">
                <label htmlFor="sg-name">Qui êtes-vous ? (optionnel)</label>
                <input id="sg-name" autoComplete="name" placeholder="Nom, ou nom de votre commerce" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="field-row">
                <label htmlFor="sg-activity">Votre activité</label>
                <select id="sg-activity" value={activity} onChange={(e) => setActivity(e.target.value)}>
                  <option value="">Choisir…</option>
                  {ACTIVITIES.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field-row">
                <label htmlFor="sg-area">Ça concerne quoi ?</label>
                <select id="sg-area" value={area} onChange={(e) => setArea(e.target.value)}>
                  <option value="">Choisir…</option>
                  {AREAS.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="field-row">
              <label htmlFor="sg-need">Expliquez votre besoin *</label>
              <textarea id="sg-need" required rows={5} minLength={10} maxLength={3000} placeholder="Ex. Je voudrais imprimer mes étiquettes au format 40 x 30 mm, ou gérer les retours clients par produit…" value={need} onChange={(e) => setNeed(e.target.value)} />
            </div>
            <div className="field-row">
              <label>Quelle importance ?</label>
              <div className="sg-prio" role="radiogroup" aria-label="Importance">
                {PRIORITIES.map(([v, l, hint]) => (
                  <button key={v} type="button" role="radio" aria-checked={priority === v} className={`sg-prio-opt${priority === v ? ' is-on' : ''}`} onClick={() => setPriority(v)}>
                    <b>{l}</b>
                    <span>{hint}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="field-row">
              <label htmlFor="sg-tool">Aujourd’hui, comment faites-vous ? (optionnel)</label>
              <input id="sg-tool" placeholder="Ex. Excel, un cahier, un autre logiciel…" maxLength={200} value={currentTool} onChange={(e) => setCurrentTool(e.target.value)} />
            </div>
            {/* Honeypot: hidden from people, tempting for bots. */}
            <input className="sg-hp" tabIndex={-1} autoComplete="off" aria-hidden="true" name="website" value={website} onChange={(e) => setWebsite(e.target.value)} />
            <div className="modal-footer bl-footer">
              <span className="form-hint">Réponse par email, sans engagement.</span>
              <button type="submit" className="btn-primary" disabled={sending || !email.trim() || need.trim().length < 10}>
                {sending ? 'Envoi…' : 'Envoyer ma proposition'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
