import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { AdminShell } from './AdminShell';
import { useAdminAuth } from './admin-auth-context';
import { SchemaTable, SqlResult, adminApi } from './admin-api';
import { Icon } from '../lib/Icon';
import { ApiError } from '../lib/api';
import './admin.css';
import '../lib/data-views.css';

const CONFIRM_PHRASE = 'JE CONFIRME';

export function AdminSqlPage() {
  const { accessToken } = useAdminAuth();
  const [schema, setSchema] = useState<SchemaTable[]>([]);
  const [tableFilter, setTableFilter] = useState('');
  const [openTable, setOpenTable] = useState<string | null>(null);
  const [sql, setSql] = useState('SELECT id, name, plan, "createdAt"\nFROM organizations\nORDER BY "createdAt" DESC\nLIMIT 50;');
  const [writeMode, setWriteMode] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [result, setResult] = useState<SqlResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  // Custom horizontal scrollbar — native scrollbars are unreliable (OS overlay
  // mode hides them, and the grid sits flush at the viewport bottom).
  const scrollRef = useRef<HTMLDivElement>(null);
  const [hbar, setHbar] = useState<{ w: number; l: number; show: boolean }>({ w: 0, l: 0, show: false });

  const syncBar = () => {
    const el = scrollRef.current;
    if (!el) return;
    const show = el.scrollWidth - el.clientWidth > 1;
    setHbar({ w: (el.clientWidth / el.scrollWidth) * 100, l: (el.scrollLeft / el.scrollWidth) * 100, show });
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const raf = requestAnimationFrame(syncBar);
    const ro = new ResizeObserver(syncBar);
    ro.observe(el);
    window.addEventListener('resize', syncBar);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('resize', syncBar);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  function dragBar(e: ReactPointerEvent<HTMLDivElement>) {
    const track = e.currentTarget;
    const el = scrollRef.current;
    if (!el) return;
    const rect = track.getBoundingClientRect();
    const toScroll = (clientX: number) => {
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      el.scrollLeft = ratio * (el.scrollWidth - el.clientWidth);
    };
    toScroll(e.clientX);
    const move = (ev: PointerEvent) => toScroll(ev.clientX);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  useEffect(() => {
    if (!accessToken) return;
    adminApi.schema(accessToken).then(setSchema).catch(() => undefined);
  }, [accessToken]);

  const tables = useMemo(
    () => schema.filter((t) => t.table.toLowerCase().includes(tableFilter.toLowerCase())),
    [schema, tableFilter],
  );

  function insertAtCursor(text: string) {
    const el = editorRef.current;
    if (!el) {
      setSql((s) => s + text);
      return;
    }
    const start = el.selectionStart ?? sql.length;
    const end = el.selectionEnd ?? sql.length;
    const next = sql.slice(0, start) + text + sql.slice(end);
    setSql(next);
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = start + text.length;
    });
  }

  async function run(query?: string) {
    if (!accessToken) return;
    const toRun = query ?? sql;
    if (query) setSql(query);
    setError(null);
    setResult(null);
    setBusy(true);
    try {
      const r = await adminApi.sql(accessToken, toRun, !query && writeMode, !query && writeMode ? confirm : undefined);
      setResult(r);
      if (writeMode) setConfirm('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur.');
    } finally {
      setBusy(false);
    }
  }

  const selectFrom = (t: string) => run(`SELECT * FROM "${t}" LIMIT 100;`);

  return (
    <AdminShell title="Console SQL" subtitle="Requêtes sur la base de production. Lecture seule par défaut ; les écritures sont confirmées et journalisées." flush>
      <div className="sql-layout">
        {/* ── Left: tables explorer ── */}
        <aside className="sql-tables">
          <div className="sql-tables-head">
            <input placeholder="Filtrer les tables…" value={tableFilter} onChange={(e) => setTableFilter(e.target.value)} />
          </div>
          <div className="sql-tables-list">
            {tables.map((t) => {
              const expanded = openTable === t.table;
              return (
                <div key={t.table} className="sql-table">
                  <div className={`sql-table-row${expanded ? ' open' : ''}`} onClick={() => setOpenTable(expanded ? null : t.table)}>
                    <Icon name={expanded ? 'chevronDown' : 'chevronRight'} size={13} />
                    <Icon name="grid" size={13} />
                    <span className="sql-table-name" title={t.table}>{t.table}</span>
                    <button
                      type="button"
                      className="sql-table-run"
                      title={`SELECT * FROM ${t.table}`}
                      onClick={(e) => { e.stopPropagation(); selectFrom(t.table); }}
                    >
                      <Icon name="arrowRight" size={13} />
                    </button>
                  </div>
                  {expanded && (
                    <div className="sql-cols">
                      {t.columns.map((c) => (
                        <div key={c.name} className="sql-col" onClick={() => insertAtCursor(`"${c.name}"`)} title={`${c.type}${c.nullable ? ' · nullable' : ''}`}>
                          <span className="sql-col-name">{c.name}</span>
                          <span className="sql-col-type">{c.type}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {tables.length === 0 && <div className="muted" style={{ padding: 12, fontSize: '0.82rem' }}>Aucune table.</div>}
          </div>
        </aside>

        {/* ── Right: editor (top) + results (bottom) ── */}
        <div className="sql-right">
          <div className="sql-editor-pane">
            <textarea
              ref={editorRef}
              className="sql-editor"
              value={sql}
              onChange={(e) => setSql(e.target.value)}
              spellCheck={false}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                  e.preventDefault();
                  if (!writeMode || confirm === CONFIRM_PHRASE) run();
                }
              }}
            />
            <div className="sql-controls">
              <label className="sql-write-toggle">
                <input type="checkbox" checked={writeMode} onChange={(e) => { setWriteMode(e.target.checked); setConfirm(''); }} />
                Mode écriture
              </label>
              {writeMode && (
                <input className="sql-confirm" placeholder={`Tapez « ${CONFIRM_PHRASE} »`} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              )}
              <span className="sql-hint">Ctrl+Entrée pour exécuter</span>
              <button
                className={writeMode ? 'btn-danger' : 'btn-primary'}
                onClick={() => run()}
                disabled={busy || (writeMode && confirm !== CONFIRM_PHRASE)}
              >
                {busy ? 'Exécution…' : writeMode ? 'Exécuter (écriture)' : 'Exécuter'}
              </button>
            </div>
          </div>

          <div className="sql-results-pane">
            {error && <div className="error-banner" style={{ margin: 14 }}>{error}</div>}
            {!error && !result && <div className="sql-empty">Les résultats de la requête s'afficheront ici.</div>}
            {result && (
              <>
                <div className="sql-result-bar">
                  {result.message ?? `${result.rowCount} ligne(s)`}
                  {result.truncated && ', affichage limité à 1000 lignes'}
                </div>
                {result.columns.length > 0 && (
                  <>
                    <div className="sql-result-scroll" ref={scrollRef} onScroll={syncBar}>
                      <table className="data sql-result-table">
                        <thead>
                          <tr>{result.columns.map((c) => <th key={c}>{c}</th>)}</tr>
                        </thead>
                        <tbody>
                          {result.rows.map((row, i) => (
                            <tr key={i}>{result.columns.map((c) => <td key={c} title={formatCell(row[c])}>{formatCell(row[c])}</td>)}</tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {hbar.show && (
                      <div className="sql-hscroll" onPointerDown={dragBar}>
                        <div className="sql-hscroll-thumb" style={{ width: `${hbar.w}%`, left: `${hbar.l}%` }} />
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </AdminShell>
  );
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return '∅';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
