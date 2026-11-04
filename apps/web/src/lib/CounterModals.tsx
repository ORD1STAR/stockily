import { FormEvent, useState } from 'react';
import { useAuth } from './auth-context';
import { ApiError, CounterSessionView, CounterView, countersApi } from './api';
import { toast } from './toast';

export const money = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export async function openPdf(promise: Promise<Blob>) {
  try {
    window.open(URL.createObjectURL(await promise), '_blank');
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'Impossible de générer le PDF.');
  }
}

export function OpenSessionModal({ counter, onClose, onOpened }: { counter: CounterView; onClose: () => void; onOpened: (s: CounterSessionView) => void }) {
  const { accessToken } = useAuth();
  const [cash, setCash] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!accessToken) return;
    setBusy(true);
    try {
      const s = await countersApi.open(accessToken, counter.id, Number(cash) || 0);
      toast.success(`${counter.name} ouverte.`);
      onOpened(s);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Ouverture impossible.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="modal-backdrop open">
      <div className="modal">
        <div className="modal-header">
          <div className="modal-header-titles">
            <h3>Ouvrir {counter.name}</h3>
            <p className="modal-sub">{counter.site.name}</p>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>
        <form className="field-form" onSubmit={submit}>
          <div className="field-row">
            <label>Fond de caisse (DZD)</label>
            <input type="number" min={0} step="any" inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value)} placeholder="0,00" autoFocus />
          </div>
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Annuler
            </button>
            <button type="submit" className="btn-primary" disabled={busy}>
              Ouvrir la caisse
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function CloseSessionModal({ session, onClose, onClosed }: { session: CounterSessionView; onClose: () => void; onClosed: (s: CounterSessionView) => void }) {
  const { accessToken } = useAuth();
  const [counted, setCounted] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const diff = counted === '' ? null : Math.round((Number(counted) - session.expectedCash) * 100) / 100;
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!accessToken || counted === '') return;
    setBusy(true);
    try {
      const s = await countersApi.close(accessToken, session.id, Number(counted), notes.trim() || undefined);
      toast.success(`Caisse clôturée — ${s.number}.`);
      onClosed(s);
      openPdf(countersApi.zPdf(accessToken, s.id));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Clôture impossible.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="modal-backdrop open">
      <div className="modal">
        <div className="modal-header">
          <div className="modal-header-titles">
            <h3>Clôturer {session.counter.name}</h3>
            <p className="modal-sub">
              {session.number} · ouverte le {new Date(session.openedAt).toLocaleString('fr-FR')}
            </p>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>
        <form className="field-form" onSubmit={submit}>
          <SessionTotals session={session} />
          <div className="field-row" style={{ marginTop: 14 }}>
            <label>Espèces comptées dans la caisse (DZD)</label>
            <input type="number" min={0} step="any" inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} placeholder={money.format(session.expectedCash)} autoFocus required />
            {diff != null && (
              <span className={`sub ${diff < 0 ? 'bad' : diff > 0 ? 'good' : ''}`}>
                Écart : {diff > 0 ? '+' : ''}
                {money.format(diff)} DZD {diff === 0 ? '— caisse juste' : diff < 0 ? '— manque' : '— excédent'}
              </span>
            )}
          </div>
          <div className="field-row">
            <label>Observation</label>
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optionnel" />
          </div>
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Annuler
            </button>
            <button type="submit" className="btn-primary" disabled={busy || counted === ''}>
              Clôturer et imprimer le ticket Z
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function CashMovementModal({ session, onClose, onSaved }: { session: CounterSessionView; onClose: () => void; onSaved: (s: CounterSessionView) => void }) {
  const { accessToken } = useAuth();
  const [direction, setDirection] = useState<'in' | 'out'>('out');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!accessToken) return;
    try {
      onSaved(await countersApi.movement(accessToken, session.id, { direction, amount: Number(amount), reason }));
      toast.success('Mouvement de caisse enregistré.');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Échec.');
    }
  }
  return (
    <div className="modal-backdrop open">
      <div className="modal">
        <div className="modal-header">
          <div className="modal-header-titles">
            <h3>Mouvement de caisse</h3>
            <p className="modal-sub">Argent entré ou sorti hors ventes (dépense, retrait, apport).</p>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>
        <form className="field-form" onSubmit={submit}>
          <div className="toggle-row">
            <button type="button" className={`toggle-btn${direction === 'out' ? ' on' : ''}`} onClick={() => setDirection('out')}>
              Sortie
            </button>
            <button type="button" className={`toggle-btn${direction === 'in' ? ' on' : ''}`} onClick={() => setDirection('in')}>
              Entrée
            </button>
          </div>
          <div className="field-grid">
            <div className="field-row">
              <label>Montant (DZD)</label>
              <input type="number" min={0.01} step="any" value={amount} onChange={(e) => setAmount(e.target.value)} required />
            </div>
            <div className="field-row">
              <label>Motif</label>
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="ex. Achat fournitures" required />
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Annuler
            </button>
            <button type="submit" className="btn-primary">
              Enregistrer
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function SessionTotals({ session }: { session: CounterSessionView }) {
  return (
    <div className="account-box">
      <div className="account-row">
        <span>Ventes</span>
        <span>
          {session.salesCount} · {money.format(session.salesTotal)} DZD
        </span>
      </div>
      {session.byMethod.map((m) => (
        <div className="account-row" key={m.method}>
          <span>&nbsp;&nbsp;dont {m.label.toLowerCase()}</span>
          <span>{money.format(m.total)}</span>
        </div>
      ))}
      <div className="account-row">
        <span>Fond de caisse</span>
        <span>{money.format(session.openingCash)}</span>
      </div>
      {(session.cashIn > 0 || session.cashOut > 0) && (
        <div className="account-row">
          <span>Entrées / sorties</span>
          <span>
            +{money.format(session.cashIn)} / −{money.format(session.cashOut)}
          </span>
        </div>
      )}
      <div className="account-row total">
        <span>Espèces attendues</span>
        <span>{money.format(session.expectedCash)} DZD</span>
      </div>
    </div>
  );
}
