import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';

// Shared search + filters + sort for every list (stock, achats, ventes,
// factures, partenaires). One compact toolbar row: search, a "Filtres"
// button opening a small panel, a sort picker (headers are clickable too),
// the result count — and a row of removable chips only when something is
// active. Everything runs on the rows already loaded, so it is instant.

export type SortValue = string | number | null | undefined;
export interface SortDef<T> {
  key: string;
  label: string;
  value: (row: T) => SortValue;
  /** First click sorts descending (amounts, dates, quantities). */
  desc?: boolean;
}

export type FilterDef<T> =
  | { key: string; label: string; type: 'select'; value: (row: T) => string | null | undefined; options?: { value: string; label: string }[] }
  | { key: string; label: string; type: 'range'; value: (row: T) => number | null | undefined; unit?: string }
  | { key: string; label: string; type: 'dates'; value: (row: T) => string | null | undefined }
  | { key: string; label: string; type: 'flag'; test: (row: T) => boolean };

type FilterState = Record<string, string | { min?: string; max?: string } | { from?: string; to?: string } | boolean | undefined>;
export interface SortState {
  key: string;
  dir: 'asc' | 'desc';
}

const collator = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });
function compare(a: SortValue, b: SortValue) {
  const na = a == null || a === '';
  const nb = b == null || b === '';
  if (na || nb) return na === nb ? 0 : na ? 1 : -1; // empty values always last
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return collator.compare(String(a), String(b));
}

const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : '');
const fmtDate = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: '2-digit' });
const fmtNum = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });

/**
 * Deep links: a list can be opened pre-filtered/sorted from the URL, e.g.
 * `/stock?f.out=1&sort=qty:asc` or `/purchasing?f.status=Envoyé`. Select →
 * `f.<key>=<value>`, flag → `f.<key>=1`, range → `f.<key>.min/.max`, dates →
 * `f.<key>.from/.to`; `q=` pre-fills the search. Read once, on mount — used
 * by the dashboard and Statistiques cards to open "exactly what to look at".
 */
function readUrlState(): { filters: FilterState; sort: SortState | null; query: string } {
  const filters: FilterState = {};
  let sort: SortState | null = null;
  let query = '';
  try {
    const params = new URLSearchParams(window.location.search);
    params.forEach((value, name) => {
      if (name === 'q') query = value;
      else if (name === 'sort') {
        const [key, dir] = value.split(':');
        if (key) sort = { key, dir: dir === 'desc' ? 'desc' : 'asc' };
      } else if (name.startsWith('f.')) {
        const [key, part] = name.slice(2).split('.');
        if (!key) return;
        if (!part) filters[key] = value === '1' || value === 'true' ? true : value;
        else filters[key] = { ...((filters[key] as Record<string, string> | undefined) ?? {}), [part]: value };
      }
    });
  } catch {
    /* no window (tests) */
  }
  return { filters, sort, query };
}

function readSort(id: string): SortState | null {
  try {
    const raw = localStorage.getItem(`stockily.sort.${id}`);
    return raw ? (JSON.parse(raw) as SortState) : null;
  } catch {
    return null;
  }
}

export interface ListControls<T> {
  rows: T[];
  total: number;
  /** The toolbar (+ active chips). `leading` goes before the search (e.g. a segmented toggle). */
  toolbar: (leading?: ReactNode) => ReactNode;
  /** A sortable <th>. */
  th: (key: string, label: ReactNode, className?: string) => ReactNode;
  filtered: boolean;
  reset: () => void;
  query: string;
}

export function useListControls<T>(
  allRows: T[],
  opts: {
    id: string;
    search?: (row: T) => (string | null | undefined)[];
    searchPlaceholder?: string;
    filters?: FilterDef<T>[];
    sorts: SortDef<T>[];
    defaultSort?: SortState;
    noun?: [string, string];
  },
): ListControls<T> {
  const { id, filters = [], sorts } = opts;
  const [fromUrl] = useState(readUrlState);
  const [query, setQuery] = useState(fromUrl.query);
  // Only keys this list actually defines are taken from the URL, with the
  // right shape (a flag must be `true`, a select a string).
  const [state, setState] = useState<FilterState>(() => {
    const out: FilterState = {};
    for (const f of filters) {
      const v = fromUrl.filters[f.key];
      if (v === undefined) continue;
      if (f.type === 'flag') out[f.key] = v === true;
      else if (f.type === 'select') out[f.key] = typeof v === 'string' ? v : undefined;
      else if (typeof v === 'object') out[f.key] = v;
    }
    return out;
  });
  const [sort, setSortState] = useState<SortState | null>(() =>
    fromUrl.sort && sorts.some((s) => s.key === fromUrl.sort?.key) ? fromUrl.sort : (readSort(id) ?? opts.defaultSort ?? null),
  );
  const setSort = (s: SortState | null) => {
    setSortState(s);
    try {
      if (s) localStorage.setItem(`stockily.sort.${id}`, JSON.stringify(s));
      else localStorage.removeItem(`stockily.sort.${id}`);
    } catch {
      /* ignore */
    }
  };

  // Options of select filters without a fixed list come from the rows themselves.
  const selectOptions = useMemo(() => {
    const out: Record<string, { value: string; label: string }[]> = {};
    for (const f of filters) {
      if (f.type !== 'select') continue;
      if (f.options) {
        out[f.key] = f.options;
        continue;
      }
      const seen = new Set<string>();
      for (const r of allRows) {
        const v = f.value(r);
        if (v) seen.add(v);
      }
      out[f.key] = [...seen].sort((a, b) => collator.compare(a, b)).map((v) => ({ value: v, label: v }));
    }
    return out;
  }, [allRows, filters]);

  const isActive = (f: FilterDef<T>) => {
    const v = state[f.key];
    if (f.type === 'flag') return v === true;
    if (f.type === 'select') return typeof v === 'string' && v !== '';
    if (!v || typeof v !== 'object') return false;
    return Object.values(v).some((x) => x !== undefined && x !== '');
  };
  const active = filters.filter(isActive);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = allRows.filter((r) => {
      if (q && opts.search && !opts.search(r).some((v) => (v ?? '').toLowerCase().includes(q))) return false;
      for (const f of active) {
        const v = state[f.key];
        if (f.type === 'flag') {
          if (!f.test(r)) return false;
        } else if (f.type === 'select') {
          if ((f.value(r) ?? '') !== v) return false;
        } else if (f.type === 'range') {
          const { min, max } = v as { min?: string; max?: string };
          const n = f.value(r);
          if (n == null) return false;
          if (min !== undefined && min !== '' && n < Number(min)) return false;
          if (max !== undefined && max !== '' && n > Number(max)) return false;
        } else {
          const { from, to } = v as { from?: string; to?: string };
          const d = day(f.value(r));
          if (!d) return false;
          if (from && d < from) return false;
          if (to && d > to) return false;
        }
      }
      return true;
    });
    const def = sort && sorts.find((s) => s.key === sort.key);
    if (def && sort) {
      const sign = sort.dir === 'asc' ? 1 : -1;
      out = out
        .map((r, i) => ({ r, i, v: def.value(r) }))
        .sort((a, b) => {
          const na = a.v == null || a.v === '';
          const nb = b.v == null || b.v === '';
          if (na || nb) return na === nb ? a.i - b.i : na ? 1 : -1;
          return sign * compare(a.v, b.v) || a.i - b.i;
        })
        .map((x) => x.r);
    }
    return out;
  }, [allRows, query, state, sort]);

  const clickSort = (key: string) => {
    const def = sorts.find((s) => s.key === key);
    if (!def) return;
    const first = def.desc ? 'desc' : 'asc';
    if (!sort || sort.key !== key) setSort({ key, dir: first });
    else if (sort.dir === first) setSort({ key, dir: first === 'asc' ? 'desc' : 'asc' });
    else setSort(opts.defaultSort ?? null);
  };

  const reset = () => {
    setState({});
    setQuery('');
  };

  const chipLabel = (f: FilterDef<T>) => {
    const v = state[f.key];
    if (f.type === 'flag') return f.label;
    if (f.type === 'select') return `${f.label} : ${selectOptions[f.key]?.find((o) => o.value === v)?.label ?? v}`;
    if (f.type === 'range') {
      const { min, max } = v as { min?: string; max?: string };
      const u = f.unit ? ` ${f.unit}` : '';
      if (min && max) return `${f.label} : ${fmtNum.format(Number(min))} – ${fmtNum.format(Number(max))}${u}`;
      return min ? `${f.label} ≥ ${fmtNum.format(Number(min))}${u}` : `${f.label} ≤ ${fmtNum.format(Number(max))}${u}`;
    }
    const { from, to } = v as { from?: string; to?: string };
    if (from && to) return `${f.label} : ${fmtDate(from)} → ${fmtDate(to)}`;
    return from ? `${f.label} : depuis le ${fmtDate(from)}` : `${f.label} : jusqu’au ${fmtDate(to as string)}`;
  };

  const [noun1, nounN] = opts.noun ?? ['résultat', 'résultats'];
  const toolbar = (leading?: ReactNode) => (
    <div className="lc">
      <div className="lc-bar">
        {leading}
        {opts.search && (
          <input
            className="control list-search lc-search"
            type="search"
            placeholder={opts.searchPlaceholder ?? 'Rechercher…'}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        )}
        {filters.length > 0 && (
          <FilterPopover
            filters={filters}
            state={state}
            setState={setState}
            options={selectOptions}
            activeCount={active.length}
            onReset={() => setState({})}
          />
        )}
        <SortPicker sorts={sorts} sort={sort} onChange={setSort} />
        <span className="lc-count">
          {rows.length !== allRows.length ? `${rows.length} / ${allRows.length}` : rows.length} {Math.max(rows.length, allRows.length) > 1 ? nounN : noun1}
        </span>
      </div>
      {(active.length > 0 || query.trim()) && (
        <div className="lc-chips">
          {query.trim() && (
            <button type="button" className="lc-chip" onClick={() => setQuery('')}>
              « {query.trim()} » <span aria-hidden>✕</span>
            </button>
          )}
          {active.map((f) => (
            <button key={f.key} type="button" className="lc-chip" onClick={() => setState((s) => ({ ...s, [f.key]: undefined }))} aria-label={`Retirer le filtre ${f.label}`}>
              {chipLabel(f)} <span aria-hidden>✕</span>
            </button>
          ))}
          <button type="button" className="lc-clear" onClick={reset}>
            Tout effacer
          </button>
        </div>
      )}
    </div>
  );

  const th = (key: string, label: ReactNode, className?: string) => {
    const on = sort?.key === key;
    return (
      <th key={key} className={`${className ?? ''} lc-th`} aria-sort={on ? (sort?.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
        <button type="button" className="lc-th-btn" data-dir={on ? sort?.dir : undefined} onClick={() => clickSort(key)} title="Trier">
          {label}
        </button>
      </th>
    );
  };

  return { rows, total: allRows.length, toolbar, th, filtered: active.length > 0 || !!query.trim(), reset, query: query.trim().toLowerCase() };
}

function useOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);
  return ref;
}

function FilterPopover<T>({
  filters,
  state,
  setState,
  options,
  activeCount,
  onReset,
}: {
  filters: FilterDef<T>[];
  state: FilterState;
  setState: (fn: (s: FilterState) => FilterState) => void;
  options: Record<string, { value: string; label: string }[]>;
  activeCount: number;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [alignRight, setAlignRight] = useState(false);
  const ref = useOutside(open, () => setOpen(false));
  const toggle = () => {
    // Open towards the left when the panel would overflow the window.
    const r = ref.current?.getBoundingClientRect();
    setAlignRight(!!r && r.left + 350 > window.innerWidth - 16);
    setOpen((o) => !o);
  };
  const set = (key: string, v: FilterState[string]) => setState((s) => ({ ...s, [key]: v }));
  const flags = filters.filter((f) => f.type === 'flag');
  return (
    <div className="lc-pop-wrap" ref={ref}>
      <button type="button" className={`lc-btn${activeCount ? ' is-on' : ''}`} onClick={toggle} aria-expanded={open}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <path d="M3 5h18M6 12h12M10 19h4" />
        </svg>
        Filtres
        {activeCount > 0 && <span className="lc-badge">{activeCount}</span>}
      </button>
      {open && (
        <div className={`lc-pop${alignRight ? ' is-right' : ''}`} role="dialog" aria-label="Filtres">
          <div className="lc-pop-body">
            {filters.map((f) => {
              if (f.type === 'flag') return null;
              const v = state[f.key];
              return (
                <div key={f.key} className="lc-field">
                  <label>{f.label}</label>
                  {f.type === 'select' && (
                    <select className="control" value={(v as string) ?? ''} onChange={(e) => set(f.key, e.target.value || undefined)}>
                      <option value="">Tous</option>
                      {(options[f.key] ?? []).map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  )}
                  {f.type === 'range' && (
                    <div className="lc-pair">
                      <input
                        className="control"
                        type="number"
                        inputMode="decimal"
                        placeholder="Min"
                        value={(v as { min?: string })?.min ?? ''}
                        onChange={(e) => set(f.key, { ...(v as object), min: e.target.value })}
                      />
                      <span>–</span>
                      <input
                        className="control"
                        type="number"
                        inputMode="decimal"
                        placeholder="Max"
                        value={(v as { max?: string })?.max ?? ''}
                        onChange={(e) => set(f.key, { ...(v as object), max: e.target.value })}
                      />
                    </div>
                  )}
                  {f.type === 'dates' && (
                    <>
                      <div className="lc-pair">
                        <input className="control" type="date" value={(v as { from?: string })?.from ?? ''} onChange={(e) => set(f.key, { ...(v as object), from: e.target.value })} />
                        <span>→</span>
                        <input className="control" type="date" value={(v as { to?: string })?.to ?? ''} onChange={(e) => set(f.key, { ...(v as object), to: e.target.value })} />
                      </div>
                      <div className="lc-quick">
                        {(
                          [
                            ['Aujourd’hui', 0],
                            ['7 j', 6],
                            ['30 j', 29],
                            ['Ce mois', -1],
                          ] as const
                        ).map(([label, n]) => (
                          <button
                            key={label}
                            type="button"
                            onClick={() => {
                              const now = new Date();
                              const from = n === -1 ? new Date(now.getFullYear(), now.getMonth(), 1) : new Date(now.getFullYear(), now.getMonth(), now.getDate() - n);
                              const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                              set(f.key, { from: iso(from), to: iso(now) });
                            }}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
            {flags.length > 0 && (
              <div className="lc-field">
                <label>Afficher seulement</label>
                <div className="lc-flags">
                  {flags.map((f) => (
                    <label key={f.key} className="lc-flag">
                      <input type="checkbox" checked={state[f.key] === true} onChange={(e) => set(f.key, e.target.checked || undefined)} />
                      {f.label}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="lc-pop-foot">
            <button type="button" className="btn-link" onClick={onReset} disabled={activeCount === 0}>
              Réinitialiser
            </button>
            <button type="button" className="btn-primary btn-sm" onClick={() => setOpen(false)}>
              Voir les résultats
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SortPicker<T>({ sorts, sort, onChange }: { sorts: SortDef<T>[]; sort: SortState | null; onChange: (s: SortState | null) => void }) {
  const value = sort ? `${sort.key}:${sort.dir}` : '';
  return (
    <label className="lc-sort">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
        <path d="M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4" />
      </svg>
      <select
        value={value}
        onChange={(e) => {
          if (!e.target.value) return onChange(null);
          const [key, dir] = e.target.value.split(':');
          onChange({ key, dir: dir as 'asc' | 'desc' });
        }}
        aria-label="Trier"
      >
        <option value="">Tri par défaut</option>
        {sorts.flatMap((s) => {
          const order: ('asc' | 'desc')[] = s.desc ? ['desc', 'asc'] : ['asc', 'desc'];
          return order.map((dir) => (
            <option key={`${s.key}:${dir}`} value={`${s.key}:${dir}`}>
              {s.label} {dir === 'asc' ? '↑' : '↓'}
            </option>
          ));
        })}
      </select>
    </label>
  );
}
