import { Fragment, useEffect, useState } from 'react';
import { AdminShell } from './AdminShell';
import { useAdminAuth } from './admin-auth-context';
import { AdminLogRow, adminApi } from './admin-api';
import { Icon } from '../lib/Icon';
import { Combobox } from './Combobox';
import '../lib/data-views.css';
import './admin.css';

// Raw action codes → readable French. Falls back to a prettified code.
const ACTION_LABEL: Record<string, string> = {
  'organization.created': 'Organisation créée',
  'members.user.created': 'Sous-utilisateur créé',
  'members.user.updated': 'Sous-utilisateur modifié',
  'members.user.deactivated': 'Sous-utilisateur désactivé',
  'sites.site.created': 'Site créé',
  'counter.created': 'Comptoir créé',
  'counter.session.opened': 'Caisse ouverte',
  'counter.session.closed': 'Caisse fermée',
  'counter.sale.created': 'Vente comptoir',
  'counter.cash.movement': 'Mouvement de caisse',
  'cash.entry.created': 'Encaissement / décaissement',
  'cash.entry.cancelled': 'Mouvement de caisse annulé',
  'licensing.device.activated': 'Appareil activé',
  'licensing.device.deactivated': 'Appareil désactivé',
  'licensing.anomaly.activation_burst': 'Anomalie : activations multiples',
  'module.activate': 'Module activé',
  'module.suspend': 'Module suspendu',
  'module.cancel': 'Module annulé',
  'org.seats': 'Postes par site modifiés',
  'user.create': 'Utilisateur créé (admin)',
  'user.update': 'Utilisateur modifié (admin)',
  'device.deactivate': 'Appareil désactivé (admin)',
  'device.revoke': 'Appareil révoqué (admin)',
  'pricing.set': 'Tarif modifié',
  'sql.write': 'Écriture SQL',
};

const ENTITY_LABEL: Record<string, string> = {
  user: 'Utilisateur',
  site: 'Site',
  organization: 'Organisation',
  device_activation: 'Appareil',
  cash_entry: 'Caisse',
  invoice: 'Facture',
  counter: 'Comptoir',
  counter_session: 'Session caisse',
  trade_document: 'Bon',
};

function actionLabel(a: string): string {
  return ACTION_LABEL[a] ?? a.replace(/[._]/g, ' · ');
}

function summary(l: AdminLogRow): string {
  if (l.entityType) return ENTITY_LABEL[l.entityType] ?? l.entityType.replace(/_/g, ' ');
  if (l.detail && typeof l.detail === 'object') {
    const d = l.detail as Record<string, unknown>;
    if (d.module) return `Module « ${d.module} »`;
    if (d.sql) return String(d.sql).slice(0, 60);
    if (d.username) return `@${d.username}`;
    const first = Object.entries(d)[0];
    if (first) return `${first[0]} : ${String(first[1]).slice(0, 40)}`;
  }
  return '—';
}

export function AdminLogsPage() {
  const { accessToken } = useAdminAuth();
  const [rows, setRows] = useState<AdminLogRow[]>([]);
  const [source, setSource] = useState<'all' | 'tenant' | 'admin'>('all');
  const [org, setOrg] = useState('all');
  const [action, setAction] = useState('all');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    adminApi.logs(accessToken).then(setRows).finally(() => setLoading(false));
  }, [accessToken]);

  // Distinct actions and orgs present in the loaded logs, for the dropdowns.
  const actions = [...new Set(rows.map((r) => r.action))].sort((a, b) => actionLabel(a).localeCompare(actionLabel(b)));
  const orgs = [...new Set(rows.filter((r) => r.kind === 'tenant').map((r) => r.org))].sort();

  const q = query.trim().toLowerCase();
  const shown = rows.filter((r) => {
    if (source !== 'all' && r.kind !== source) return false;
    if (org !== 'all' && r.org !== org) return false;
    if (action !== 'all' && r.action !== action) return false;
    if (q && !(`${r.actor} ${r.org} ${actionLabel(r.action)}`.toLowerCase().includes(q))) return false;
    return true;
  });
  const filtersActive = source !== 'all' || org !== 'all' || action !== 'all' || !!q;
  const reset = () => { setSource('all'); setOrg('all'); setAction('all'); setQuery(''); };

  return (
    <AdminShell
      title="Journaux système"
      subtitle={`${shown.length} événement${shown.length > 1 ? 's' : ''}${filtersActive ? ` (sur ${rows.length})` : ''}`}
      actions={
        <div className="logs-filters">
          <div className="logs-search">
            <Icon name="scan" size={15} />
            <input placeholder="Rechercher un acteur…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <Combobox value={source} onChange={(v) => { setSource(v as typeof source); if (v !== 'tenant') setOrg('all'); }} allLabel="Toutes les sources" width={190}
            options={[{ value: 'admin', label: 'Plateforme (admin)' }, { value: 'tenant', label: 'Organisations' }]} />
          <Combobox value={org} onChange={setOrg} allLabel="Toutes les organisations" disabled={source === 'admin'}
            options={orgs.map((o) => ({ value: o, label: o }))} />
          <Combobox value={action} onChange={setAction} allLabel="Toutes les actions" width={230}
            options={actions.map((a) => ({ value: a, label: actionLabel(a) }))} />
          {filtersActive && (
            <button type="button" className="btn-secondary logs-reset" onClick={reset} title="Réinitialiser les filtres">
              <Icon name="x" size={14} />
            </button>
          )}
        </div>
      }
    >
      {loading ? (
        <div className="page-loader"><span className="spinner" /> Chargement…</div>
      ) : (
        <div className="table-wrap">
          <table className="data logs-table">
            <thead>
              <tr>
                <th style={{ width: 150 }}>Date</th>
                <th>Source</th>
                <th>Acteur</th>
                <th>Événement</th>
                <th>Détail</th>
                <th style={{ width: 36 }} />
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => {
                const expanded = open === i;
                const hasDetail = !!r.detail || !!r.entityId;
                return (
                  <Fragment key={i}>
                    <tr className={hasDetail ? 'clickable' : undefined} onClick={() => hasDetail && setOpen(expanded ? null : i)}>
                      <td className="muted" style={{ whiteSpace: 'nowrap' }}>
                        {new Date(r.at).toLocaleDateString('fr-FR')}
                        <div className="cell-sub">{new Date(r.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</div>
                      </td>
                      <td>{r.kind === 'admin' ? <span className="chip chip-admin">Plateforme</span> : r.org}</td>
                      <td className="muted">{r.actor}</td>
                      <td><span className="log-event">{actionLabel(r.action)}</span></td>
                      <td className="muted" style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{summary(r)}</td>
                      <td style={{ textAlign: 'center', color: 'var(--text-subtle)' }}>
                        {hasDetail && <Icon name={expanded ? 'chevronDown' : 'chevronRight'} size={14} />}
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="log-detail-row">
                        <td colSpan={6}>
                          <div className="log-detail">
                            <div className="log-detail-grid">
                              <div><span className="k">Action</span><span className="v mono">{r.action}</span></div>
                              {r.entityType && <div><span className="k">Entité</span><span className="v">{ENTITY_LABEL[r.entityType] ?? r.entityType}</span></div>}
                              {r.entityId && <div><span className="k">Identifiant</span><span className="v mono">{r.entityId}</span></div>}
                              <div><span className="k">Date</span><span className="v">{new Date(r.at).toLocaleString('fr-FR')}</span></div>
                            </div>
                            {r.detail != null && typeof r.detail === 'object' && (
                              <pre className="log-json">{JSON.stringify(r.detail, null, 2)}</pre>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {shown.length === 0 && <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: '28px 0' }}>Aucun événement.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </AdminShell>
  );
}
