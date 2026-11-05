import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppShell } from '../lib/AppShell';
import { Icon } from '../lib/Icon';
import { useAuth } from '../lib/auth-context';
import { toast } from '../lib/toast';
import { ApiError, CounterSessionView, CounterView, Site, countersApi, sitesApi } from '../lib/api';
import { CashMovementModal, CloseSessionModal, OpenSessionModal, money, openPdf } from '../lib/CounterModals';

export function CountersPage() {
  const { accessToken, can } = useAuth();
  const [counters, setCounters] = useState<CounterView[] | null>(null);
  const [sessions, setSessions] = useState<CounterSessionView[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [opening, setOpening] = useState<CounterView | null>(null);
  const [closing, setClosing] = useState<CounterSessionView | null>(null);
  const [moving, setMoving] = useState<CounterSessionView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accessToken) return;
    try {
      const [list, hist, siteList] = await Promise.all([countersApi.list(accessToken), countersApi.sessions(accessToken), sitesApi.list(accessToken)]);
      setCounters(list);
      setSessions(hist.filter((s) => s.status === 'closed'));
      setSites(siteList);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur de chargement.');
    }
  }, [accessToken]);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <AppShell>
      <div className="panel-head">
        <div>
          <h2>Comptoirs</h2>
          <div className="sub">Caisses : ouverture, ventes au scan, clôture et ticket Z.</div>
        </div>
        {can('scan.counter.create') && (
          <button className="btn-primary" onClick={() => setShowCreate(true)} disabled={sites.length === 0}>
            <Icon name="plus" size={16} /> Nouveau comptoir
          </button>
        )}
      </div>
      {error && <div className="error-banner">{error}</div>}

      {counters === null ? (
        <div className="page-loader">
          <span className="spinner" /> Chargement…
        </div>
      ) : counters.length === 0 ? (
        <div className="center-message">
          <span className="center-message-icon">
            <Icon name="calculator" size={26} />
          </span>
          <div className="center-message-title">Aucun comptoir</div>
          <div className="center-message-sub">Créez une caisse pour vendre au scan et suivre les espèces.</div>
          {can('scan.counter.create') && (
            <button className="btn-primary" style={{ marginTop: 10 }} onClick={() => setShowCreate(true)} disabled={sites.length === 0}>
              Nouveau comptoir
            </button>
          )}
        </div>
      ) : (
        <div className="counter-grid">
          {counters.map((c) => {
            const s = c.openSession;
            return (
              <div key={c.id} className={`counter-card${s ? ' is-open' : ''}`}>
                <div className="counter-card-head">
                  <div>
                    <div className="counter-card-name">{c.name}</div>
                    <div className="sub">{c.site.name}</div>
                  </div>
                  <span className={`pill ${s ? 'success' : c.isActive ? 'info' : 'danger'}`}>{s ? 'Ouverte' : c.isActive ? 'Fermée' : 'Désactivée'}</span>
                </div>
                {s ? (
                  <>
                    <div className="counter-card-stats">
                      <div>
                        <span className="fact-label">Ventes</span>
                        <span className="fact-value">{s.salesCount}</span>
                      </div>
                      <div>
                        <span className="fact-label">Chiffre d’affaires</span>
                        <span className="fact-value">{money.format(s.salesTotal)}</span>
                      </div>
                      <div>
                        <span className="fact-label">Espèces attendues</span>
                        <span className="fact-value">{money.format(s.expectedCash)}</span>
                      </div>
                    </div>
                    <div className="sub">
                      {s.number} · ouverte le {new Date(s.openedAt).toLocaleString('fr-FR')}
                    </div>
                    <div className="counter-card-actions">
                      {can('scan.counter.sell') && (
                        <Link className="btn-primary btn-sm" to="/scan?mode=checkout">
                          Vendre
                        </Link>
                      )}
                      {can('scan.counter.cash') && (
                        <button className="btn-secondary btn-sm" onClick={() => setMoving(s)}>
                          Mouvement de caisse
                        </button>
                      )}
                      {can('scan.counter.session') && (
                        <button className="btn-secondary btn-sm" onClick={() => setClosing(s)}>
                          Clôturer
                        </button>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="counter-card-actions">
                    {can('scan.counter.session') && (
                      <button className="btn-primary btn-sm" onClick={() => setOpening(c)} disabled={!c.isActive}>
                        Ouvrir la caisse
                      </button>
                    )}
                    <button
                      className="btn-link"
                      onClick={async () => {
                        if (!accessToken) return;
                        await countersApi.update(accessToken, c.id, { isActive: !c.isActive }).catch(() => undefined);
                        load();
                      }}
                    >
                      {c.isActive ? 'Désactiver' : 'Réactiver'}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {sessions.length > 0 && (
        <>
          <h3 className="section-title" style={{ marginTop: 28 }}>
            Clôtures (tickets Z)
          </h3>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>N°</th>
                  <th>Comptoir</th>
                  <th>Clôture</th>
                  <th className="num">Ventes</th>
                  <th className="num">CA</th>
                  <th className="num">Écart caisse</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id}>
                    <td className="mono">{s.number}</td>
                    <td>{s.counter.name}</td>
                    <td className="muted">{s.closedAt ? new Date(s.closedAt).toLocaleString('fr-FR') : '—'}</td>
                    <td className="num">{s.salesCount}</td>
                    <td className="num">{money.format(s.salesTotal)}</td>
                    <td className={`num ${s.difference && s.difference < 0 ? 'bad' : s.difference ? 'good' : 'muted'}`}>{s.difference != null ? money.format(s.difference) : '—'}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn-link" onClick={() => accessToken && openPdf(countersApi.zPdf(accessToken, s.id))}>
                        Ticket Z
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {showCreate && (
        <CreateCounterModal
          sites={sites}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            load();
          }}
        />
      )}
      {opening && (
        <OpenSessionModal
          counter={opening}
          onClose={() => setOpening(null)}
          onOpened={() => {
            setOpening(null);
            load();
          }}
        />
      )}
      {closing && (
        <CloseSessionModal
          session={closing}
          onClose={() => setClosing(null)}
          onClosed={() => {
            setClosing(null);
            load();
          }}
        />
      )}
      {moving && (
        <CashMovementModal
          session={moving}
          onClose={() => setMoving(null)}
          onSaved={() => {
            setMoving(null);
            load();
          }}
        />
      )}
    </AppShell>
  );
}

function CreateCounterModal({ sites, onClose, onCreated }: { sites: Site[]; onClose: () => void; onCreated: () => void }) {
  const { accessToken } = useAuth();
  const [name, setName] = useState('');
  const [siteId, setSiteId] = useState(sites[0]?.id ?? '');
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!accessToken) return;
    try {
      await countersApi.create(accessToken, { name, siteId });
      toast.success('Comptoir créé.');
      onCreated();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Échec de la création.');
    }
  }
  return (
    <div className="modal-backdrop open">
      <div className="modal">
        <div className="modal-header">
          <div className="modal-header-titles">
            <h3>Nouveau comptoir</h3>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>
        <form className="field-form" onSubmit={submit}>
          <div className="field-grid">
            <div className="field-row">
              <label>Nom</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="ex. Caisse 1" required autoFocus />
            </div>
            <div className="field-row">
              <label>Dépôt</label>
              <select value={siteId} onChange={(e) => setSiteId(e.target.value)}>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Annuler
            </button>
            <button type="submit" className="btn-primary">
              Créer
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default CountersPage;
