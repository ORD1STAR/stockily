import { ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppShell } from '../lib/AppShell';
import { PartnersModal } from '../lib/PartnersModal';
import { useAuth } from '../lib/auth-context';
import { ApiError, Site, StatsGranularity, StatsOverview, sitesApi, statsApi } from '../lib/api';

const da0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const da2 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 });
const DA = (n: number) => `${da0.format(n)} DA`;

type Preset = 'day' | '7d' | 'month' | 'year' | 'custom';
const PRESETS: [Preset, string][] = [
  ['day', 'Aujourd’hui'],
  ['7d', '7 jours'],
  ['month', 'Ce mois'],
  ['year', 'Cette année'],
  ['custom', 'Personnalisé'],
];

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

interface Range {
  from: string;
  to: string;
  granularity: StatsGranularity;
  compareFrom: string;
  compareTo: string;
  compareLabel: string;
}

/** Period, bucket size and the period it is compared to (same days of the previous day / week / month / year). */
function rangeFor(preset: Preset, customFrom: string, customTo: string): Range {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  if (preset === 'day') return { from: iso(now), to: iso(now), granularity: 'day', compareFrom: iso(new Date(y, m, d - 1)), compareTo: iso(new Date(y, m, d - 1)), compareLabel: 'vs hier' };
  if (preset === '7d')
    return { from: iso(new Date(y, m, d - 6)), to: iso(now), granularity: 'day', compareFrom: iso(new Date(y, m, d - 13)), compareTo: iso(new Date(y, m, d - 7)), compareLabel: 'vs 7 j. avant' };
  if (preset === 'month') {
    // Same days of last month (1 → today), capped at the end of that month.
    const lastDay = new Date(y, m, 0).getDate();
    return { from: iso(new Date(y, m, 1)), to: iso(now), granularity: 'day', compareFrom: iso(new Date(y, m - 1, 1)), compareTo: iso(new Date(y, m - 1, Math.min(d, lastDay))), compareLabel: 'vs mois dernier' };
  }
  if (preset === 'year') return { from: iso(new Date(y, 0, 1)), to: iso(now), granularity: 'month', compareFrom: iso(new Date(y - 1, 0, 1)), compareTo: iso(new Date(y - 1, m, d)), compareLabel: `vs ${y - 1}` };
  const a = new Date(`${customFrom}T00:00:00`);
  const b = new Date(`${customTo}T00:00:00`);
  const days = Math.round((b.getTime() - a.getTime()) / 86_400_000);
  return {
    from: customFrom,
    to: customTo,
    granularity: days > 62 ? 'month' : 'day',
    compareFrom: iso(new Date(a.getFullYear(), a.getMonth(), a.getDate() - days - 1)),
    compareTo: iso(new Date(a.getFullYear(), a.getMonth(), a.getDate() - 1)),
    compareLabel: 'vs période préc.',
  };
}

/** "3 nov." — with the year when it is not the current one. */
const shortDate = (isoDay: string) => {
  const d = new Date(`${isoDay}T00:00:00`);
  return d.toLocaleDateString('fr-FR', d.getFullYear() === new Date().getFullYear() ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
};
const spanLabel = (from: string, to: string) => (from === to ? `le ${shortDate(from)}` : `du ${shortDate(from)} au ${shortDate(to)}`);
function bucketLabel(key: string, g: StatsGranularity, long = false) {
  if (g === 'year') return key;
  if (g === 'month') return new Date(`${key}-01T00:00:00`).toLocaleDateString('fr-FR', long ? { month: 'long', year: 'numeric' } : { month: 'short' });
  return new Date(`${key}T00:00:00`).toLocaleDateString('fr-FR', long ? { weekday: 'long', day: 'numeric', month: 'long' } : { day: 'numeric', month: 'short' });
}

/** Percentage change vs the previous period; null when there is nothing to compare to. */
const change = (cur: number, prev: number) => (Math.abs(prev) < 0.005 ? null : ((cur - prev) / Math.abs(prev)) * 100);

function niceCeil(v: number) {
  if (v <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * pow >= v) return m * pow;
  return 10 * pow;
}

const METHOD_COLOR: Record<string, string> = {
  especes: 'var(--brand-600)',
  carte: '#0f8f84',
  cheque: '#c27a12',
  virement: '#2f6fd6',
  autre: 'var(--gray-400)',
};

export function StatsPage() {
  const { accessToken } = useAuth();
  const [preset, setPreset] = useState<Preset>('month');
  const today = iso(new Date());
  const [customFrom, setCustomFrom] = useState(iso(new Date(new Date().setDate(1))));
  const [customTo, setCustomTo] = useState(today);
  const [siteId, setSiteId] = useState('');
  const [sites, setSites] = useState<Site[]>([]);
  const [data, setData] = useState<StatsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showPartners, setShowPartners] = useState(false);
  const range = useMemo(() => rangeFor(preset, customFrom, customTo), [preset, customFrom, customTo]);

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const { from, to, granularity, compareFrom, compareTo } = range;
      setData(await statsApi.overview(accessToken, { from, to, granularity, compareFrom, compareTo, siteId: siteId || undefined }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur de chargement.');
    } finally {
      setLoading(false);
    }
  }, [accessToken, range, siteId]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (accessToken) sitesApi.list(accessToken).then(setSites).catch(() => setSites([]));
  }, [accessToken]);

  return (
    <AppShell>
      <div className="panel-head">
        <div>
          <h2>Statistiques</h2>
          <div className="sub">
            Activité {spanLabel(range.from, range.to)} · comparée {spanLabel(range.compareFrom, range.compareTo)}
          </div>
        </div>
      </div>

      <div className="st-filters">
        <div className="toggle-row" style={{ margin: 0 }}>
          {PRESETS.map(([p, label]) => (
            <button key={p} type="button" className={`toggle-btn${preset === p ? ' on' : ''}`} onClick={() => setPreset(p)}>
              {label}
            </button>
          ))}
        </div>
        {preset === 'custom' && (
          <div className="date-range">
            <input type="date" className="control" value={customFrom} max={customTo} onChange={(e) => e.target.value && setCustomFrom(e.target.value)} />
            <span className="muted">→</span>
            <input type="date" className="control" value={customTo} min={customFrom} max={today} onChange={(e) => e.target.value && setCustomTo(e.target.value)} />
          </div>
        )}
        {sites.length > 1 && (
          <select className="control st-site" value={siteId} onChange={(e) => setSiteId(e.target.value)}>
            <option value="">Tous les dépôts</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
        {loading && data && <span className="spinner" aria-label="Chargement" />}
      </div>

      {error && <div className="error-banner">{error}</div>}

      {!data ? (
        loading && (
          <div className="page-loader">
            <span className="spinner" /> Chargement…
          </div>
        )
      ) : (
        <div className={`st-page${loading ? ' is-loading' : ''}`}>
          <Headline data={data} vs={range.compareLabel} />
          <Watchlist data={data} onPartners={() => setShowPartners(true)} />
          <div className="st-row st-row-chart">
            <SalesChart data={data} />
            <PaymentsCard data={data} />
          </div>
          <div className="st-row st-row-ranks">
            <RankCard
              title="Produits les plus vendus"
              empty="Aucune vente de produit sur la période."
              total={data.sales.totalTtc}
              items={data.sales.topProducts.map((p) => ({ id: p.id, name: p.name, value: p.revenue, meta: `${da0.format(p.quantity)} vendu(s)` }))}
            />
            <RankCard
              title="Meilleurs clients"
              empty="Aucun client sur la période."
              total={data.sales.totalTtc}
              items={data.sales.topCustomers.map((c) => ({ id: c.id, name: c.name, value: c.revenue, meta: `${c.count} vente(s)` }))}
            />
            <RankCard
              title="Principaux fournisseurs"
              empty="Aucun achat sur la période."
              total={data.purchases.total}
              items={data.purchases.topSuppliers.map((s) => ({ id: s.id, name: s.name, value: s.amount, meta: `${s.count} réception(s)` }))}
            />
          </div>
        </div>
      )}
      {showPartners && <PartnersModal onClose={() => setShowPartners(false)} />}
    </AppShell>
  );
}

// ───────────────────────── Headline: CA + 4 KPI ─────────────────────────

function Delta({ cur, prev, neutral = false, suffix }: { cur: number; prev: number; neutral?: boolean; suffix: string }) {
  const pct = change(cur, prev);
  if (pct == null)
    return (
      <span className="st-delta is-flat">
        <b>—</b> pas de chiffre {suffix}
      </span>
    );
  const dir = Math.abs(pct) < 0.5 ? 'flat' : pct > 0 ? 'up' : 'down';
  const tone = neutral || dir === 'flat' ? 'is-flat' : dir === 'up' ? 'is-good' : 'is-bad';
  return (
    <span className={`st-delta ${tone}`} title={`Période précédente : ${da2.format(prev)}`}>
      <b>
        {dir === 'up' ? '▲' : dir === 'down' ? '▼' : '='} {Math.abs(pct) >= 1000 ? `×${da0.format(cur / prev)}` : `${da0.format(Math.abs(pct))} %`}
      </b>{' '}
      {suffix}
    </span>
  );
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * 100, 38 - (Math.max(v, 0) / max) * 34] as const);
  const line = pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  return (
    <svg className="st-spark" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden>
      <polygon points={`0,40 ${line} 100,40`} className="st-spark-area" />
      <polyline points={line} className="st-spark-line" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Headline({ data, vs }: { data: StatsOverview; vs: string }) {
  const { sales, purchases, payments, previous } = data;
  const creditShare = sales.totalTtc > 0 ? (payments.credit / sales.totalTtc) * 100 : 0;
  return (
    <div className="st-headline">
      <div className="st-hero">
        <div className="st-label">Chiffre d’affaires TTC</div>
        <div className="st-hero-value">
          {da0.format(sales.totalTtc)} <span>DA</span>
        </div>
        <Delta cur={sales.totalTtc} prev={previous.salesTtc} suffix={vs} />
        <Sparkline values={data.series.map((s) => s.sales)} />
        <div className="st-hero-foot">
          <span>
            HT <b>{DA(sales.totalHt)}</b>
          </span>
          <span>
            Panier moyen <b>{DA(sales.averageBasket)}</b>
          </span>
        </div>
      </div>
      <div className="st-kpis">
        <Kpi label="Bénéfice estimé" value={DA(sales.estimatedMargin)} hint={sales.marginRate ? `Marge de ${da0.format(sales.marginRate)} % sur les produits` : 'Sur les produits vendus'}>
          <Delta cur={sales.estimatedMargin} prev={previous.margin} suffix={vs} />
        </Kpi>
        <Kpi label="Nombre de ventes" value={da0.format(sales.count)} hint={sales.count ? `Panier moyen ${DA(sales.averageBasket)}` : 'Aucune vente'}>
          <Delta cur={sales.count} prev={previous.count} suffix={vs} />
        </Kpi>
        <Kpi
          label="Encaissé"
          value={DA(payments.collected)}
          hint={payments.credit > 0 ? `${DA(payments.credit)} à crédit (${da0.format(creditShare)} % des ventes)` : 'Tout est encaissé'}
          warn={creditShare >= 30}
        >
          <Delta cur={payments.collected} prev={previous.collected} suffix={vs} />
        </Kpi>
        <Kpi label="Achats" value={DA(purchases.total)} hint={`${purchases.count} réception(s) / facture(s)`}>
          <Delta cur={purchases.total} prev={previous.purchases} neutral suffix={vs} />
        </Kpi>
      </div>
    </div>
  );
}

function Kpi({ label, value, hint, warn, children }: { label: string; value: string; hint: string; warn?: boolean; children: ReactNode }) {
  return (
    <div className="st-kpi">
      <div className="st-label">{label}</div>
      <div className="st-kpi-value">{value}</div>
      {children}
      <div className={`st-kpi-hint${warn ? ' is-warn' : ''}`}>{hint}</div>
    </div>
  );
}

// ───────────────────────── À surveiller ─────────────────────────

function Watchlist({ data, onPartners }: { data: StatsOverview; onPartners: () => void }) {
  const { balances, stock } = data;
  const items: { key: string; tone: 'ok' | 'warn' | 'bad'; label: string; value: string; detail: string; action: ReactNode }[] = [
    {
      key: 'customers',
      tone: balances.customers.total > 0 ? 'warn' : 'ok',
      label: 'Les clients vous doivent',
      value: DA(balances.customers.total),
      detail: balances.customers.count ? `${balances.customers.count} client(s)${balances.customers.top[0] ? ` · surtout ${balances.customers.top[0].name}` : ''}` : 'Aucune créance',
      action: (
        <button type="button" className="btn-link" onClick={onPartners}>
          Voir les clients →
        </button>
      ),
    },
    {
      key: 'suppliers',
      tone: balances.suppliers.total > 0 ? 'warn' : 'ok',
      label: 'Vous devez aux fournisseurs',
      value: DA(balances.suppliers.total),
      detail: balances.suppliers.count ? `${balances.suppliers.count} fournisseur(s)${balances.suppliers.top[0] ? ` · surtout ${balances.suppliers.top[0].name}` : ''}` : 'Aucune dette',
      action: (
        <button type="button" className="btn-link" onClick={onPartners}>
          Voir les fournisseurs →
        </button>
      ),
    },
    {
      key: 'stock',
      tone: stock.outOfStockCount > 0 ? 'bad' : stock.lowStockCount > 0 ? 'warn' : 'ok',
      label: 'Ruptures de stock',
      value: `${stock.outOfStockCount} produit(s)`,
      detail: stock.lowStockCount
        ? `+ ${stock.lowStockCount} sous le seuil minimum`
        : stock.outOfStockCount
          ? stock.outOfStock
              .slice(0, 2)
              .map((p) => p.name)
              .join(', ')
          : `Stock valorisé à ${DA(stock.value)}`,
      action: (
        <Link className="btn-link" to="/stock">
          Voir le stock →
        </Link>
      ),
    },
    {
      key: 'lots',
      tone: stock.expired.length > 0 ? 'bad' : stock.expiringSoon.length > 0 ? 'warn' : 'ok',
      label: 'Lots périmés',
      value: `${stock.expired.length} lot(s)`,
      detail: stock.expiringSoon.length ? `${stock.expiringSoon.length} expirent dans les 30 jours` : 'Aucun lot proche de sa date',
      action: (
        <Link className="btn-link" to="/quality">
          Voir les lots →
        </Link>
      ),
    },
  ];
  return (
    <section className="st-watch" aria-label="À surveiller">
      {items.map((it) => (
        <div key={it.key} className={`st-watch-item is-${it.tone}`}>
          <div className="st-watch-top">
            <span className="st-watch-dot" aria-hidden>
              {it.tone === 'ok' ? '✓' : '!'}
            </span>
            <span className="st-label">{it.label}</span>
          </div>
          <div className="st-watch-value">{it.value}</div>
          <div className="st-watch-detail">{it.detail}</div>
          {it.action}
        </div>
      ))}
    </section>
  );
}

// ───────────────────────── Évolution des ventes ─────────────────────────

function SalesChart({ data }: { data: StatsOverview }) {
  const [active, setActive] = useState<number | null>(null);
  const g = data.period.granularity;
  const series = data.series;
  const max = niceCeil(Math.max(0, ...series.map((s) => Math.max(s.sales, s.purchases))));
  const ticks = [max, max / 2, 0];
  const every = series.length > 16 ? Math.ceil(series.length / 8) : 1;
  const best = series.reduce<(typeof series)[number] | null>((b, s) => (s.sales > (b?.sales ?? 0) ? s : b), null);
  const cur = active != null ? series[active] : null;

  return (
    <div className="card st-card st-chart-card">
      <div className="st-card-head">
        <div>
          <h3>Évolution des ventes</h3>
          <div className="sub">{best ? `Meilleur${g === 'month' ? ' mois' : 'e journée'} : ${bucketLabel(best.key, g, true)} · ${DA(best.sales)}` : 'Aucune vente sur la période.'}</div>
        </div>
        <div className="st-legend">
          <span>
            <i style={{ background: 'var(--brand-500)' }} /> Ventes
          </span>
          <span>
            <i style={{ background: 'var(--gray-300)' }} /> Achats
          </span>
        </div>
      </div>
      {series.length < 2 ? (
        <div className="st-chart-empty">
          <div className="st-chart-single">
            <div>
              <div className="st-label">Ventes</div>
              <b>{DA(data.sales.totalTtc)}</b>
            </div>
            <div>
              <div className="st-label">Achats</div>
              <b>{DA(data.purchases.total)}</b>
            </div>
          </div>
          <span className="sub">Choisissez « 7 jours » ou plus pour voir l’évolution.</span>
        </div>
      ) : (
        <div className="st-chart" onMouseLeave={() => setActive(null)}>
          <div className="st-axis">
            {ticks.map((t) => (
              <span key={t}>{compact.format(t)}</span>
            ))}
          </div>
          <div className="st-plot">
            <div className="st-gridlines">
              {ticks.map((t) => (
                <div key={t} className="st-grid" style={{ bottom: `${(t / max) * 100}%` }} />
              ))}
            </div>
            <div className="st-cols">
              {series.map((s, i) => (
                <div
                  key={s.key}
                  className={`st-col${active === i ? ' is-active' : ''}`}
                  onMouseEnter={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                  tabIndex={0}
                  aria-label={`${bucketLabel(s.key, g, true)} : ventes ${DA(s.sales)}, achats ${DA(s.purchases)}`}
                >
                  <div className="st-bars">
                    <span className="st-bar is-sales" style={{ height: `${(Math.max(s.sales, 0) / max) * 100}%` }} />
                    <span className="st-bar is-purchases" style={{ height: `${(Math.max(s.purchases, 0) / max) * 100}%` }} />
                  </div>
                  <span className="st-tick">{i % every === 0 ? bucketLabel(s.key, g) : ''}</span>
                </div>
              ))}
            </div>
            {cur && active != null && (
              <div className={`st-tip${active >= series.length / 2 ? ' is-left' : ''}`} style={{ left: `${((active + 0.5) / series.length) * 100}%` }}>
                <div className="st-tip-title">{bucketLabel(cur.key, g, true)}</div>
                <div className="st-tip-row">
                  <i style={{ background: 'var(--brand-500)' }} /> Ventes <b>{DA(cur.sales)}</b>
                </div>
                <div className="st-tip-row">
                  <i style={{ background: 'var(--gray-300)' }} /> Achats <b>{DA(cur.purchases)}</b>
                </div>
                <div className="st-tip-sub">
                  {cur.count} vente(s) · bénéfice {DA(cur.margin)}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ───────────────────────── Encaissements ─────────────────────────

function PaymentsCard({ data }: { data: StatsOverview }) {
  const { payments } = data;
  const rows = [
    ...payments.byMethod.map((m) => ({ key: m.method, label: m.label, amount: m.amount, color: METHOD_COLOR[m.method] ?? 'var(--gray-400)', hatch: false })),
    ...(payments.credit > 0 ? [{ key: 'credit', label: 'À crédit (non payé)', amount: payments.credit, color: 'var(--gray-300)', hatch: true }] : []),
  ];
  const total = rows.reduce((s, r) => s + r.amount, 0);
  return (
    <div className="card st-card st-pay-card">
      <div className="st-card-head">
        <div>
          <h3>Comment vos clients paient</h3>
          <div className="sub">Ventes de la période</div>
        </div>
      </div>
      {total <= 0 ? (
        <div className="st-empty">Aucune vente sur la période.</div>
      ) : (
        <>
          <div className="st-split" role="img" aria-label="Répartition des encaissements">
            {rows.map((r) => (
              <span key={r.key} className={r.hatch ? 'is-hatch' : ''} style={{ flexGrow: r.amount, background: r.hatch ? undefined : r.color }} title={`${r.label} : ${DA(r.amount)}`} />
            ))}
          </div>
          <ul className="st-split-list">
            {rows.map((r) => (
              <li key={r.key}>
                <i className={r.hatch ? 'is-hatch' : ''} style={{ background: r.hatch ? undefined : r.color }} />
                <span className="st-split-name">{r.label}</span>
                <span className="st-split-pct">{da0.format((r.amount / total) * 100)} %</span>
                <b>{DA(r.amount)}</b>
              </li>
            ))}
          </ul>
          {data.sales.credit.count > 0 && (
            <div className="st-note">
              {data.sales.credit.count} vente(s) à terme sur la période · {DA(data.sales.credit.amount)} restent à encaisser.
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ───────────────────────── Classements ─────────────────────────

function RankCard({ title, items, total, empty }: { title: string; items: { id: string; name: string; value: number; meta: string }[]; total: number; empty: string }) {
  const top = items.slice(0, 6);
  const max = Math.max(...top.map((i) => i.value), 1);
  return (
    <div className="card st-card">
      <div className="st-card-head">
        <h3>{title}</h3>
      </div>
      {top.length === 0 ? (
        <div className="st-empty">{empty}</div>
      ) : (
        <ol className="st-rank">
          {top.map((it, i) => (
            <li key={it.id}>
              <span className="st-rank-n">{i + 1}</span>
              <div className="st-rank-body">
                <div className="st-rank-line">
                  <span className="st-rank-name" title={it.name}>
                    {it.name}
                  </span>
                  <b>{DA(it.value)}</b>
                </div>
                <div className="st-rank-bar">
                  <span style={{ width: `${Math.max(2, (it.value / max) * 100)}%` }} />
                </div>
                <div className="st-rank-meta">
                  {it.meta}
                  {total > 0 && <> · {da0.format((it.value / total) * 100)} % du total</>}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export default StatsPage;
