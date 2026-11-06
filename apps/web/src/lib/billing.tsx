import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, billingApi, BillingOverview, Catalog, CatalogModule, localApi, Quote } from './api';
import { useDesktopStatus } from './desktop';
import { useAuth } from './auth-context';
import { Icon, IconName } from './Icon';
import { PRODUCT_MODULES } from './modules';
import { toast } from './toast';
import './billing.css';

// Shared pieces of the self-service subscription UI: formatting, module
// visuals, state badges, and the purchase flow (select → recap → done) used
// by the dashboard's locked apps, the public Tarifs page and the Espace
// client alike — so buying works and looks the same from everywhere.

// Explicit thousands grouping: fr-FR's Intl skips it for 4-digit numbers ("7500"), which reads badly in a price list.
const nf = { format: (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0') };
export const formatDzd = (n: number) => `${nf.format(n)}\u00a0DZD`;
export const formatDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '—');

export function moduleVisual(key: string): { icon: IconName; tone: string } {
  const m = PRODUCT_MODULES.find((p) => p.key === key);
  return m ? { icon: m.icon, tone: m.tone } : { icon: 'grid', tone: 'slate' };
}

export function ModuleChip({ moduleKey, size = 18, muted = false }: { moduleKey: string; size?: number; muted?: boolean }) {
  const v = moduleVisual(moduleKey);
  return (
    <span className={`mod-chip tone-${muted ? 'slate' : v.tone}${size < 18 ? ' sm' : ''}`}>
      <Icon name={v.icon} size={size} />
    </span>
  );
}

/**
 * Human duration until `end`: days up to a month, then "2 mois et 12 j", and
 * "1 an et 2 mois" beyond a year (a bare "196 j" is hard to read).
 */
export function formatDuration(end: Date, from: Date = new Date()): string {
  const ms = end.getTime() - from.getTime();
  if (ms <= 0) return '0 j';
  const totalDays = Math.ceil(ms / 86_400_000);
  if (totalDays <= 31) return `${totalDays} j`;
  // Beyond a month, count in calendar days: the time of day must not turn an
  // exact "6 mois" into "5 mois et 30 j".
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  end = day(end);
  from = day(from);
  // Whole calendar months first, then the remaining days.
  let months = (end.getFullYear() - from.getFullYear()) * 12 + (end.getMonth() - from.getMonth());
  const anchor = (m: number) => {
    const d = new Date(from);
    d.setDate(1);
    d.setMonth(d.getMonth() + m);
    d.setDate(Math.min(from.getDate(), new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
    return d;
  };
  while (months > 0 && anchor(months) > end) months--;
  const days = Math.max(0, Math.round((end.getTime() - anchor(months).getTime()) / 86_400_000));
  if (months >= 12) {
    const years = Math.floor(months / 12);
    const rest = months % 12;
    return `${years} an${years > 1 ? 's' : ''}${rest ? ` et ${rest} mois` : ''}`;
  }
  return `${months} mois${days ? ` et ${days} j` : ''}`;
}

/** "Actif · 23 j restants", "Essai · 4 j", "Expiré", "Non activé". */
export function StateBadge({ state, daysLeft, endsAt }: { state: 'active' | 'trial' | 'expired' | 'none'; daysLeft: number | null; endsAt?: string | null }) {
  if (state === 'none') return <span className="bl-badge is-none">Non activé</span>;
  if (state === 'expired') return <span className="bl-badge is-expired">Expiré</span>;
  const left = daysLeft == null ? (endsAt === null ? 'sans échéance' : '') : daysLeft <= 1 ? 'dernier jour' : endsAt ? `${formatDuration(new Date(endsAt))} restants` : `${daysLeft} j restants`;
  return (
    <span className={`bl-badge ${state === 'trial' ? 'is-trial' : daysLeft != null && daysLeft <= 7 ? 'is-soon' : 'is-active'}`} title={endsAt ? `Jusqu’au ${formatDate(endsAt)}` : undefined}>
      {state === 'trial' ? 'Essai' : 'Actif'}
      {left && ` · ${left}`}
    </span>
  );
}

/** Selection plus every (transitive) dependency that isn't already running. */
export function withDeps(catalog: Catalog, selected: string[], usable: Set<string>): string[] {
  const deps = new Map(catalog.modules.map((m) => [m.key, m.dependencies]));
  const out = new Set<string>();
  const visit = (k: string) => {
    if (out.has(k)) return;
    out.add(k);
    (deps.get(k) ?? []).forEach((d) => !usable.has(d) && visit(d));
  };
  selected.forEach(visit);
  return catalog.modules.map((m) => m.key).filter((k) => out.has(k));
}

/** For each selected module, the other selected modules that need it (so it can't be unchecked). */
export function requiredByMap(catalog: Catalog, selected: string[]): Map<string, string[]> {
  const sel = new Set(selected);
  const names = new Map(catalog.modules.map((m) => [m.key, m.name]));
  const map = new Map<string, string[]>();
  for (const m of catalog.modules) {
    if (!sel.has(m.key)) continue;
    for (const d of m.dependencies) {
      if (!sel.has(d)) continue;
      map.set(d, [...(map.get(d) ?? []), names.get(m.key) ?? m.key]);
    }
  }
  return map;
}

/** Monthly price of a module: Multi-sites is per site beyond the first (the first is free for life). */
export const monthlyOf = (m: CatalogModule, extraSites: number) => (m.unit ? m.monthlyPrice * extraSites : m.monthlyPrice);

/** Modules really bought and running (a trial doesn't count: it would lapse under its dependents). */
export function paidKeys(overview: BillingOverview | null): Set<string> {
  return new Set((overview?.modules ?? []).filter((m) => m.state === 'active').map((m) => m.key));
}

export function usableKeys(overview: BillingOverview | null): Set<string> {
  return new Set((overview?.modules ?? []).filter((m) => m.state === 'active' || m.state === 'trial').map((m) => m.key));
}

/**
 * Purchase flow in a modal. Step 1: pick modules (pre-selected from the
 * caller: one module, a pack, or a cart) and a duration. Step 2: recap and
 * explicit confirmation. Step 3: done. Until the payment API exists,
 * confirming grants the modules immediately and records the operation as
 * offered.
 */
interface PurchaseModalProps {
  initialModules?: string[];
  packKey?: string;
  initialMonths?: number;
  onClose: () => void;
  onDone?: () => void;
}

/** On the website: the full purchase flow. In the desktop app: a short one that pays in the user's browser. */
export function PurchaseModal(props: PurchaseModalProps) {
  const desktop = useDesktopStatus();
  return desktop ? <DesktopBuyModal {...props} /> : <FullPurchaseModal {...props} />;
}

function FullPurchaseModal({ initialModules = [], packKey, initialMonths = 1, onClose, onDone }: PurchaseModalProps) {
  const { accessToken, refreshMe } = useAuth();
  const navigate = useNavigate();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [overview, setOverview] = useState<BillingOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>(initialModules);
  const [extraSites, setExtraSites] = useState(1);
  const [months, setMonths] = useState(initialMonths);
  const [step, setStep] = useState<'select' | 'confirm' | 'done'>('select');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ number: string | null; modules: { key: string; expiresAt: string }[] } | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    Promise.all([billingApi.catalog(), billingApi.overview(accessToken)])
      .then(([c, o]) => {
        setCatalog(c);
        setOverview(o);
        // Dependencies are checked up front, not discovered at the end.
        setSelected((sel) => withDeps(c, sel, paidKeys(o)));
        const sites = o.modules.find((m) => m.key === 'sites');
        if (sites?.siteQuota) setExtraSites(sites.siteQuota);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Impossible de charger le catalogue.'));
  }, [accessToken]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !submitting && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, submitting]);

  // Dependencies are satisfied by PAID modules only (see paidKeys).
  const selectionKey = `${[...selected].sort().join(',')}|${months}|${extraSites}`;
  useEffect(() => {
    if (!accessToken || !catalog || selected.length === 0) {
      setQuote(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      billingApi
        .quote(accessToken, { modules: selected, months, extraSites: selected.includes('sites') ? extraSites : undefined })
        .then((q) => !cancelled && setQuote(q))
        .catch(() => !cancelled && setQuote(null));
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // selectionKey captures selected/months/extraSites
  }, [accessToken, catalog, selectionKey]);

  const usable = useMemo(() => paidKeys(overview), [overview]);
  const stateOf = (key: string) => overview?.modules.find((m) => m.key === key);
  const duration = catalog?.durations.find((d) => d.months === months) ?? { months: 1, billedMonths: 1, label: '1 mois' };
  const keys = catalog ? withDeps(catalog, selected, usable) : [];
  const byKey = new Map((catalog?.modules ?? []).map((m) => [m.key, m]));
  const requiredBy = catalog ? requiredByMap(catalog, keys) : new Map<string, string[]>();
  const monthly = keys.reduce((s, k) => s + (byKey.get(k) ? monthlyOf(byKey.get(k) as CatalogModule, extraSites) : 0), 0);
  // The server computes the real plan (dependencies extended to cover their
  // dependents, free months...): its amount is the one charged. The local
  // figure is only a placeholder while the quote loads.
  const [quote, setQuote] = useState<Quote | null>(null);
  const total = quote?.amount ?? monthly * duration.billedMonths;
  const pack = catalog?.packs.find((p) => p.key === packKey);
  const isPackIntact = !!pack && pack.modules.every((k) => selected.includes(k)) && selected.length === pack.modules.length;

  const toggle = (k: string) => {
    if (!catalog) return;
    setSelected((s) => (s.includes(k) ? (requiredBy.has(k) ? s : s.filter((x) => x !== k)) : withDeps(catalog, [...s, k], usable)));
  };

  async function confirm() {
    if (!accessToken) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await billingApi.purchase(accessToken, { modules: selected, months, packKey: isPackIntact ? packKey : undefined, extraSites: keys.includes('sites') ? extraSites : undefined });
      if (res.checkoutUrl) {
        // Online payment: leave for Chargily's hosted page; the modules are activated once it is paid.
        window.location.assign(res.checkoutUrl);
        return;
      }
      setResult({ number: res.payment.number, modules: res.modules });
      setStep('done');
      await refreshMe().catch(() => undefined);
      onDone?.();
      toast.success(keys.length > 1 ? `${keys.length} modules activés` : 'Module activé');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "L'achat a échoué. Réessayez.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop open" onMouseDown={(e) => e.target === e.currentTarget && !submitting && onClose()}>
      <div className="modal wide bl-modal" role="dialog" aria-modal="true" aria-labelledby="bl-modal-title">
        <div className="modal-header">
          <div className="modal-header-titles">
            <h3 id="bl-modal-title">{step === 'done' ? 'C’est activé !' : pack && isPackIntact ? `Pack ${pack.name}` : 'Acheter des modules'}</h3>
            <p className="modal-sub">
              {step === 'select' && 'Choisissez vos modules et la durée.'}
              {step === 'confirm' && 'Vérifiez votre commande avant de confirmer.'}
              {step === 'done' && 'Vos modules sont disponibles immédiatement.'}
            </p>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Fermer" disabled={submitting}>
            <Icon name="x" size={18} />
          </button>
        </div>

        {step !== 'done' && (
          <ol className="bl-steps" aria-label="Étapes">
            <li className={step === 'select' ? 'is-on' : 'is-done'}>
              <span>1</span> Sélection
            </li>
            <li className={step === 'confirm' ? 'is-on' : ''}>
              <span>2</span> Confirmation
            </li>
          </ol>
        )}

        {error && <div className="error-banner">{error}</div>}
        {!catalog || !overview ? (
          !error && (
            <div className="page-loader" style={{ minHeight: 220 }}>
              <span className="spinner" /> Chargement…
            </div>
          )
        ) : step === 'select' ? (
          <>
            {!overview.canManage && (
              <div className="bl-note is-warn">
                <Icon name="lock" size={16} /> Seul un administrateur du compte peut acheter des modules. Demandez-lui d’activer ce qu’il vous faut.
              </div>
            )}
            {/* Duration first: it drives every price below, so it must not be missed. */}
            <div className="bl-section-label bl-section-first">Durée de l’abonnement</div>
            <DurationPicker durations={catalog.durations} value={months} onChange={setMonths} />
            <div className="bl-section-label">Modules</div>
            <div className="bl-pick-list">
              {catalog.modules.map((m) => (
                <PickRow
                  key={m.key}
                  module={m}
                  checked={keys.includes(m.key)}
                  lockedBy={requiredBy.get(m.key)}
                  state={stateOf(m.key)}
                  onToggle={() => toggle(m.key)}
                  extraSites={extraSites}
                  onExtraSites={setExtraSites}
                  sitesUsed={overview.sitesUsed}
                />
              ))}
            </div>
            <div className="modal-footer bl-footer">
              <div className="bl-total">
                <span>{keys.length ? `${keys.length} module${keys.length > 1 ? 's' : ''} · ${duration.label}` : 'Aucun module sélectionné'}</span>
                <b>{formatDzd(total)}</b>
              </div>
              <button type="button" className="btn-primary" disabled={!keys.length || !overview.canManage} onClick={() => setStep('confirm')}>
                Continuer <Icon name="arrowRight" size={16} />
              </button>
            </div>
          </>
        ) : step === 'confirm' ? (
          <>
            <div className="bl-recap">
              {(quote?.items ?? []).map((it) => {
                const st = stateOf(it.key);
                const extendsRunning = st?.state === 'active' && st.endsAt;
                const periodText = it.note
                  ? it.note
                  : extendsRunning
                    ? `Prolongé de ${duration.label} après le ${formatDate(st.endsAt)}`
                    : st?.state === 'trial' && st.endsAt
                      ? `${duration.label} après la fin de l’essai (${formatDate(st.endsAt)})`
                      : `${duration.label} à partir d’aujourd’hui`;
                return (
                  <div key={it.key} className={`bl-recap-row${it.note ? ' is-cover' : ''}`}>
                    <ModuleChip moduleKey={it.key} size={16} />
                    <div className="bl-recap-text">
                      <b>{it.label}</b>
                      <span>{periodText}</span>
                    </div>
                    <span className="bl-recap-amount">{formatDzd(it.fullTotal)}</span>
                  </div>
                );
              })}
              {!quote && (
                <div className="bl-recap-row">
                  <span className="spinner" /> <span className="bl-recap-text">Calcul en cours…</span>
                </div>
              )}
              {quote && quote.discount > 0 && (
                <div className="bl-recap-row is-discount">
                  <span className="mod-chip sm tone-green">
                    <Icon name="sparkles" size={16} />
                  </span>
                  <div className="bl-recap-text">
                    <b>Mois offerts</b>
                    <span>Engagement {duration.label}</span>
                  </div>
                  <span className="bl-recap-amount">− {formatDzd(quote.discount)}</span>
                </div>
              )}
              <div className="bl-recap-total">
                <span>Total</span>
                <b>{formatDzd(total)}</b>
              </div>
            </div>
            {quote?.items.some((i) => i.note) && (
              <div className="bl-note">
                <Icon name="info" size={16} />
                <span>Un module ne peut pas durer plus longtemps que ceux dont il dépend : la durée du module requis est prolongée pour couvrir la vôtre.</span>
              </div>
            )}

            <div className="bl-note">
              <Icon name="sparkles" size={16} />
              <span>
                {catalog?.onlinePayment
                  ? 'Vous serez redirigé vers la page de paiement sécurisée (EDAHABIA ou CIB). Vos modules sont activés dès que le paiement est confirmé, et la facture est générée.'
                  : 'Le paiement en ligne arrive bientôt : pendant la phase de lancement, l’activation vous est offerte. Une facture est générée.'}
              </span>
            </div>

            <div className="modal-footer bl-footer">
              <button type="button" className="btn-secondary" onClick={() => setStep('select')} disabled={submitting}>
                <Icon name="chevronLeft" size={16} /> Modifier
              </button>
              <button type="button" className="btn-primary" onClick={confirm} disabled={submitting}>
                {submitting ? (catalog?.onlinePayment ? 'Redirection…' : 'Activation…') : catalog?.onlinePayment ? `Payer ${formatDzd(total)}` : `Confirmer l’achat · ${formatDzd(total)}`}
              </button>
            </div>
          </>
        ) : (
          <div className="bl-done">
            <span className="bl-done-icon">
              <Icon name="check" size={28} strokeWidth={2.6} />
            </span>
            <p>
              {result?.modules.length === 1 ? 'Votre module est actif' : `Vos ${result?.modules.length} modules sont actifs`}
              {result?.number && (
                <>
                  {' '}
                  · facture <b>{result.number}</b>
                </>
              )}
              .
            </p>
            <ul className="bl-done-list">
              {result?.modules.map((m) => (
                <li key={m.key}>
                  <ModuleChip moduleKey={m.key} size={16} />
                  <b>{byKey.get(m.key)?.name ?? m.key}</b>
                  <span>jusqu’au {formatDate(m.expiresAt)}</span>
                </li>
              ))}
            </ul>
            <div className="bl-done-actions">
              <button type="button" className="btn-secondary" onClick={onClose}>
                Fermer
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  onClose();
                  navigate('/dashboard');
                }}
              >
                Ouvrir Mon Business <Icon name="arrowRight" size={16} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PickRow({
  module: m,
  checked,
  lockedBy,
  state,
  onToggle,
  extraSites,
  onExtraSites,
  sitesUsed,
}: {
  module: CatalogModule;
  checked: boolean;
  /** Selected modules that need this one: it can't be unchecked while they are. */
  lockedBy?: string[];
  state?: { state: 'active' | 'trial' | 'expired' | 'none'; daysLeft: number | null; endsAt: string | null };
  onToggle: () => void;
  extraSites: number;
  onExtraSites: (n: number) => void;
  sitesUsed: number;
}) {
  const locked = !!lockedBy?.length;
  return (
    <div className={`bl-pick${checked ? ' is-on' : ''}${locked ? ' is-auto' : ''}`}>
      <label className="bl-pick-main">
        <input type="checkbox" checked={checked} disabled={locked} onChange={onToggle} />
        <ModuleChip moduleKey={m.key} size={16} />
        <span className="bl-pick-text">
          <b>{m.name}</b>
          <span>{locked ? `Requis par ${lockedBy?.join(', ')}` : m.tagline}</span>
        </span>
        <span className="bl-pick-side">
          {state && state.state !== 'none' && <StateBadge state={state.state} daysLeft={state.daysLeft} endsAt={state.endsAt} />}
          <span className="bl-pick-price">
            {formatDzd(m.monthlyPrice)}
            <small>/mois{m.unit ? ` par ${m.unit}` : ''}</small>
          </span>
        </span>
      </label>
      {m.unit && checked && (
        <div className="bl-sites">
          <div className="bl-sites-text">
            <b>Combien de sites en plus du premier ?</b>
            <span>
              Le 1er site est gratuit à vie. Vous en avez {sitesUsed} actuellement : avec {extraSites} site{extraSites > 1 ? 's' : ''} en plus, vous pourrez en avoir {1 + extraSites}.
            </span>
          </div>
          <div className="bl-stepper" role="group" aria-label="Sites supplémentaires">
            <button type="button" onClick={() => onExtraSites(Math.max(1, extraSites - 1))} disabled={extraSites <= 1} aria-label="Un site de moins">
              −
            </button>
            <output aria-live="polite" aria-label={`${extraSites} site${extraSites > 1 ? 's' : ''} en plus`}>+{extraSites}</output>
            <button type="button" onClick={() => onExtraSites(Math.min(50, extraSites + 1))} disabled={extraSites >= 50} aria-label="Un site de plus">
              +
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function DurationPicker({ durations, value, onChange }: { durations: Catalog['durations']; value: number; onChange: (m: number) => void }) {
  return (
    <div className="bl-durations" role="radiogroup" aria-label="Durée">
      {durations.map((d) => (
        <button key={d.months} type="button" role="radio" aria-checked={value === d.months} className={`bl-duration${value === d.months ? ' is-on' : ''}`} onClick={() => onChange(d.months)}>
          <span>{d.label}</span>
          {d.badge && <small>{d.badge}</small>}
        </button>
      ))}
    </div>
  );
}

// ───────────────────────── Desktop app: simplified purchase ─────────────────────────

/**
 * Buying from inside the desktop app: pick a duration, pay. The payment page opens in the
 * user's own browser (the app window is not one); this dialog then waits and unlocks the
 * module by itself as soon as the payment is confirmed (the license is renewed online every
 * few seconds meanwhile).
 */
function DesktopBuyModal({ initialModules = [], initialMonths = 1, onClose, onDone }: PurchaseModalProps) {
  const { accessToken, refreshMe } = useAuth();
  const desktop = useDesktopStatus();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [overview, setOverview] = useState<BillingOverview | null>(null);
  const [months, setMonths] = useState(initialMonths);
  // Multi-sites is not a plain subscription: it is a number of extra sites (the first one is free).
  const hasSites = initialModules.includes('sites');
  const [extraSites, setExtraSites] = useState(1);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<'choose' | 'waiting' | 'done'>('choose');
  const [submitting, setSubmitting] = useState(false);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [wanted, setWanted] = useState<string[]>([]);
  const [checking, setChecking] = useState(false);
  const online = desktop?.online !== false;

  useEffect(() => {
    if (!accessToken) return;
    Promise.all([billingApi.catalog(), billingApi.overview(accessToken)])
      .then(([c, o]) => {
        setCatalog(c);
        setOverview(o);
        const sites = o.modules.find((m) => m.key === 'sites');
        if (sites?.siteQuota) setExtraSites(sites.siteQuota);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Impossible de charger les tarifs. Vérifiez votre connexion internet.'));
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken || !catalog) return;
    let cancelled = false;
    billingApi
      .quote(accessToken, { modules: initialModules, months, extraSites: hasSites ? extraSites : undefined })
      .then((q) => !cancelled && setQuote(q))
      .catch(() => !cancelled && setQuote(null));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, catalog, months, extraSites]);

  const check = useCallback(async () => {
    if (!accessToken || wanted.length === 0) return;
    setChecking(true);
    try {
      const { modules } = await localApi.refreshLicense(accessToken);
      if (wanted.every((k) => modules.includes(k))) {
        await refreshMe().catch(() => undefined);
        setStep('done');
        onDone?.();
      }
    } catch {
      /* offline for a moment: try again on the next tick */
    } finally {
      setChecking(false);
    }
  }, [accessToken, wanted, refreshMe, onDone]);

  // While the payment is being made elsewhere, look for it every few seconds (up to 20 minutes).
  useEffect(() => {
    if (step !== 'waiting') return;
    const started = Date.now();
    const t = setInterval(() => {
      if (Date.now() - started > 20 * 60_000) clearInterval(t);
      else void check();
    }, 5000);
    return () => clearInterval(t);
  }, [step, check]);

  const names = (catalog?.modules ?? []).reduce<Record<string, string>>((m, x) => ({ ...m, [x.key]: x.name }), {});
  const mainName = names[initialModules[0]] ?? initialModules[0];
  const duration = catalog?.durations.find((d) => d.months === months);

  async function pay() {
    if (!accessToken || !quote) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await billingApi.purchase(accessToken, { modules: initialModules, months, extraSites: hasSites ? extraSites : undefined });
      setWanted(quote.items.map((i) => i.key));
      if (res.checkoutUrl) {
        setCheckoutUrl(res.checkoutUrl);
        await localApi.openExternal(accessToken, res.checkoutUrl);
        setStep('waiting');
      } else {
        // Offered without payment (no payment provider configured): already active on the server.
        await localApi.refreshLicense(accessToken).catch(() => undefined);
        await refreshMe().catch(() => undefined);
        setStep('done');
        onDone?.();
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "L'achat a échoué. Réessayez.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop open" onMouseDown={(e) => e.target === e.currentTarget && !submitting && onClose()}>
      <div className="modal bl-modal" role="dialog" aria-modal="true" aria-labelledby="bl-desk-title">
        <div className="modal-header">
          <div className="modal-header-titles">
            <h3 id="bl-desk-title">{step === 'done' ? 'C’est activé !' : hasSites ? 'Ajouter des sites' : `Débloquer « ${mainName} »`}</h3>
            <p className="modal-sub">
              {step === 'choose' && (hasSites ? 'Choisissez le nombre de sites et la durée, le paiement se fait dans votre navigateur.' : 'Choisissez la durée, le paiement se fait dans votre navigateur.')}
              {step === 'waiting' && 'En attente de votre paiement…'}
              {step === 'done' && (hasSites ? 'Vos sites supplémentaires sont disponibles.' : 'Le module est disponible dans le menu.')}
            </p>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Fermer" disabled={submitting}>
            <Icon name="x" size={18} />
          </button>
        </div>

        {error && <div className="error-banner">{error}</div>}

        {step === 'choose' &&
          (!catalog || !overview ? (
            !error && (
              <div className="page-loader" style={{ minHeight: 160 }}>
                <span className="spinner" /> Chargement…
              </div>
            )
          ) : (
            <>
              {!online && (
                <div className="bl-note is-warn">
                  <Icon name="lock" size={16} /> L’achat nécessite une connexion internet. Il sera possible dès que cet ordinateur sera reconnecté.
                </div>
              )}
              {!overview.canManage && (
                <div className="bl-note is-warn">
                  <Icon name="lock" size={16} /> Seul un administrateur du compte peut acheter des modules.
                </div>
              )}
              <div className="bl-section-label bl-section-first">Durée de l’abonnement</div>
              <DurationPicker durations={catalog.durations} value={months} onChange={setMonths} />
              <div style={{ height: 14 }} />
              {hasSites && (
                <div className="bl-sites" style={{ marginBottom: 14, border: "1px solid var(--brand-200)", borderRadius: 12 }}>
                  <div className="bl-sites-text">
                    <b>Combien de sites en plus du premier ?</b>
                    <span>
                      Le 1er site est gratuit à vie. Vous en avez {overview.sitesUsed} actuellement : avec {extraSites} site{extraSites > 1 ? 's' : ''} en plus, vous pourrez en avoir {1 + extraSites}.
                      Vous pourrez en ajouter d’autres plus tard.
                    </span>
                  </div>
                  <div className="bl-stepper" role="group" aria-label="Sites supplémentaires">
                    <button type="button" onClick={() => setExtraSites((n) => Math.max(1, n - 1))} disabled={extraSites <= 1} aria-label="Un site de moins">
                      −
                    </button>
                    <output aria-live="polite">+{extraSites}</output>
                    <button type="button" onClick={() => setExtraSites((n) => Math.min(50, n + 1))} disabled={extraSites >= 50} aria-label="Un site de plus">
                      +
                    </button>
                  </div>
                </div>
              )}
              {quote && quote.items.length > 1 && (
                <p className="bl-note">
                  Inclus : {quote.items.map((i) => names[i.key] ?? i.label).join(', ')} (le module en a besoin pour fonctionner).
                </p>
              )}
              <div className="modal-footer bl-footer">
                <div className="bl-total">
                  <span>{hasSites ? `+${extraSites} site${extraSites > 1 ? 's' : ''} · ` : ''}{duration?.label ?? ''}</span>
                  <b>{quote ? formatDzd(quote.amount) : '…'}</b>
                </div>
                <button type="button" className="btn-primary" onClick={pay} disabled={submitting || !quote || !online || !overview.canManage}>
                  {submitting ? 'Ouverture…' : `Payer ${quote ? formatDzd(quote.amount) : ''} dans le navigateur`}
                </button>
              </div>
            </>
          ))}

        {step === 'waiting' && (
          <div className="bl-waiting">
            <span className="spinner" />
            <p>
              La page de paiement s’est ouverte dans votre navigateur. Une fois le paiement confirmé, <b>« {mainName} » s’active ici tout seul</b>, sans rien à faire.
            </p>
            <div className="modal-footer bl-footer">
              {checkoutUrl && (
                <button type="button" className="btn-secondary" onClick={() => accessToken && void localApi.openExternal(accessToken, checkoutUrl)}>
                  Rouvrir la page de paiement
                </button>
              )}
              <button type="button" className="btn-primary" onClick={() => void check()} disabled={checking}>
                {checking ? 'Vérification…' : 'J’ai payé : vérifier'}
              </button>
            </div>
          </div>
        )}

        {step === 'done' && (
          <div className="modal-footer bl-footer">
            <button type="button" className="btn-primary" onClick={onClose}>
              Continuer
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
