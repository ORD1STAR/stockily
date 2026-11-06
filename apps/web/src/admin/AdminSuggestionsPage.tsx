import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { AdminShell } from './AdminShell';
import { useAdminAuth } from './admin-auth-context';
import { AdminSuggestion, adminApi } from './admin-api';
import { useConfirm } from '../lib/ConfirmDialog';
import '../lib/data-views.css';

const STATUS: Record<AdminSuggestion['status'], { label: string; tone: string }> = {
  new: { label: 'Nouvelle', tone: 'info' },
  reviewing: { label: 'À l’étude', tone: 'warning' },
  planned: { label: 'Prévue', tone: 'success' },
  done: { label: 'Faite', tone: 'success' },
  declined: { label: 'Refusée', tone: 'danger' },
};
const AREA: Record<string, string> = {
  stock: 'Stock & Inventaire', quality: 'Qualité', scan: 'Scan & Comptoirs', invoicing: 'Factures', sales: 'Ventes', purchasing: 'Achats',
  cash: 'Caisse', sites: 'Multi-sites', stats: 'Statistiques', new_module: 'Nouveau module', mobile: 'Application mobile', other: 'Autre',
};
const PRIORITY: Record<string, string> = { must_have: 'Indispensable', useful: 'Utile', nice_to_have: 'Confort' };
const ACTIVITY: Record<string, string> = { retail: 'Commerce de détail', wholesale: 'Grossiste', distribution: 'Distribution', production: 'Production', services: 'Services', other: 'Autre' };

export function AdminSuggestionsPage() {
  const { accessToken } = useAdminAuth();
  const confirm = useConfirm();
  const [rows, setRows] = useState<AdminSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | AdminSuggestion['status']>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    if (!accessToken) return;
    adminApi.suggestions(accessToken).then(setRows).finally(() => setLoading(false));
  }, [accessToken]);
  useEffect(load, [load]);

  const shown = useMemo(() => (filter === 'all' ? rows : rows.filter((r) => r.status === filter)), [rows, filter]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length };
    for (const r of rows) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [rows]);

  async function patch(id: string, data: { status?: string; adminNote?: string }) {
    if (!accessToken) return;
    const updated = await adminApi.updateSuggestion(accessToken, id, data);
    setRows((rs) => rs.map((r) => (r.id === id ? updated : r)));
  }
  async function remove(r: AdminSuggestion) {
    if (!accessToken) return;
    if (!(await confirm({ title: 'Supprimer cette proposition ?', message: `De ${r.email}. Cette action est définitive.`, confirmLabel: 'Supprimer', tone: 'danger' }))) return;
    await adminApi.deleteSuggestion(accessToken, r.id);
    setRows((rs) => rs.filter((x) => x.id !== r.id));
  }

  return (
    <AdminShell title="Propositions" subtitle="Les idées et besoins envoyés depuis le formulaire « Proposer des ajouts » du site public.">
      <div className="toggle-row" style={{ marginBottom: 14 }}>
        {(['all', 'new', 'reviewing', 'planned', 'done', 'declined'] as const).map((s) => (
          <button key={s} type="button" className={`toggle-btn${filter === s ? ' on' : ''}`} onClick={() => setFilter(s)}>
            {s === 'all' ? 'Toutes' : STATUS[s].label} <span className="muted">({counts[s] ?? 0})</span>
          </button>
        ))}
      </div>
      {loading ? (
        <div className="page-loader"><span className="spinner" /> Chargement…</div>
      ) : shown.length === 0 ? (
        <div className="empty-state">Aucune proposition pour le moment.</div>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Date</th><th>De</th><th>Domaine</th><th>Importance</th><th>Besoin</th><th>Statut</th><th></th></tr></thead>
            <tbody>
              {shown.map((r) => {
                const open = openId === r.id;
                return (
                  <Fragment key={r.id}>
                    <tr style={{ cursor: 'pointer' }} onClick={() => setOpenId(open ? null : r.id)}>
                      <td style={{ whiteSpace: 'nowrap' }}>{new Date(r.createdAt).toLocaleDateString('fr-FR')}</td>
                      <td>
                        <b>{r.name || r.email}</b>
                        {r.name && <div className="muted">{r.email}</div>}
                      </td>
                      <td>{r.area ? AREA[r.area] ?? r.area : '·'}</td>
                      <td>{r.priority ? PRIORITY[r.priority] ?? r.priority : '·'}</td>
                      <td style={{ maxWidth: 380 }}>{r.need.length > 110 && !open ? `${r.need.slice(0, 110)}…` : r.need}</td>
                      <td><span className={`pill ${STATUS[r.status].tone}`}>{STATUS[r.status].label}</span></td>
                      <td><button type="button" className="btn-link">{open ? 'Fermer' : 'Ouvrir'}</button></td>
                    </tr>
                    {open && (
                      <tr key={`${r.id}-d`}>
                        <td colSpan={7} style={{ background: 'var(--gray-25)' }}>
                          <div style={{ display: 'grid', gap: 10, padding: '6px 4px' }}>
                            <div style={{ whiteSpace: 'pre-wrap' }}>{r.need}</div>
                            <div className="muted">
                              Email : <a href={`mailto:${r.email}`}>{r.email}</a>
                              {r.activity && <> · Activité : {ACTIVITY[r.activity] ?? r.activity}</>}
                              {r.currentTool && <> · Outil actuel : {r.currentTool}</>}
                            </div>
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                              <select className="control" value={r.status} onChange={(e) => patch(r.id, { status: e.target.value })} style={{ width: 'auto' }}>
                                {(Object.keys(STATUS) as AdminSuggestion['status'][]).map((s) => <option key={s} value={s}>{STATUS[s].label}</option>)}
                              </select>
                              <input className="control" style={{ flex: '1 1 260px' }} placeholder="Note interne" value={notes[r.id] ?? r.adminNote ?? ''} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} />
                              <button type="button" className="btn-secondary" onClick={() => patch(r.id, { adminNote: notes[r.id] ?? r.adminNote ?? '' })}>Enregistrer la note</button>
                              <button type="button" className="btn-danger" onClick={() => remove(r)}>Supprimer</button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </AdminShell>
  );
}

export default AdminSuggestionsPage;
