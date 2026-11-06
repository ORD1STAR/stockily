import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { billingApi, BillingOverview, Catalog, CatalogModule, CatalogPack } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { DurationPicker, formatDzd, ModuleChip, PurchaseModal, requiredByMap, StateBadge, usableKeys, withDeps } from '../lib/billing';
import { Icon } from '../lib/Icon';

// Packs + modules à la carte, with a selection cart. Logged out, every buy
// action leads to account creation (and back here). Logged in, it shows
// what the organization already owns (and for how long) and opens the
// purchase flow. Used by the public Tarifs page and the Espace client.
/** Short names so a module fits on one line in the comparison rows of a pack. */
const PACK_SHORT: Record<string, string> = { stock: 'Stock', scan: 'Scan', stats: 'Statistiques', sites: 'Multi-sites' };

export function PricingSection({ overview: overviewProp, onPurchased, compact = false }: { overview?: BillingOverview | null; onPurchased?: () => void; compact?: boolean }) {
  const { me, accessToken } = useAuth();
  const navigate = useNavigate();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [ownOverview, setOwnOverview] = useState<BillingOverview | null>(null);
  const [months, setMonths] = useState(1);
  const [cart, setCart] = useState<string[]>([]);
  const [buying, setBuying] = useState<{ modules: string[]; packKey?: string } | null>(null);
  const [error, setError] = useState(false);

  const overview = overviewProp !== undefined ? overviewProp : ownOverview;
  const loadOverview = useCallback(() => {
    if (overviewProp !== undefined || !me || !accessToken) return;
    billingApi.overview(accessToken).then(setOwnOverview).catch(() => setOwnOverview(null));
  }, [overviewProp, me, accessToken]);

  useEffect(() => {
    billingApi
      .catalog()
      .then(setCatalog)
      .catch(() => setError(true));
  }, []);
  useEffect(loadOverview, [loadOverview]);

  const usable = useMemo(() => usableKeys(overview), [overview]);
  // Modules really bought (not just on trial): only those can be "prolonged".
  const paid = useMemo(() => new Set((overview?.modules ?? []).filter((m) => m.state === 'active').map((m) => m.key)), [overview]);
  const stateOf = (k: string) => overview?.modules.find((m) => m.key === k);
  const duration = catalog?.durations.find((d) => d.months === months) ?? { months: 1, billedMonths: 1, label: '1 mois' };
  const byKey = new Map((catalog?.modules ?? []).map((m) => [m.key, m]));
  const cartKeys = catalog ? withDeps(catalog, cart, paid) : cart;
  const cartRequired = catalog ? requiredByMap(catalog, cartKeys) : new Map<string, string[]>();
  // Multi-sites counts for one extra site here; the quantity is chosen in the purchase window.
  const cartMonthly = cartKeys.reduce((s, k) => s + (byKey.get(k)?.monthlyPrice ?? 0), 0);

  const buy = (modules: string[], packKey?: string) => {
    if (!me) {
      navigate('/signup?next=/tarifs');
      return;
    }
    setBuying({ modules, packKey });
  };
  // Picking a module checks its dependencies right away; a dependency stays
  // checked while a selected module needs it.
  const toggleCart = (k: string) => {
    if (!catalog) return;
    setCart((c) => {
      const all = withDeps(catalog, c, paid);
      if (all.includes(k)) return cartRequired.has(k) ? all : all.filter((x) => x !== k);
      return withDeps(catalog, [...all, k], paid);
    });
  };

  if (error) return <div className="error-banner">Les tarifs sont momentanément indisponibles. Réessayez dans un instant.</div>;
  if (!catalog)
    return (
      <div className="page-loader" style={{ minHeight: 320 }}>
        <span className="spinner" /> Chargement des tarifs…
      </div>
    );

  return (
    <div className={`pricing${compact ? ' is-compact' : ''}`}>
      <div className="pricing-toolbar">
        <div>
          <div className="pricing-toolbar-label">Durée d’abonnement</div>
          <div className="pricing-toolbar-hint">Plus vous vous engagez, moins vous payez : 6 mois = 1 mois offert, 12 mois = 2 mois offerts.</div>
        </div>
        <DurationPicker durations={catalog.durations} value={months} onChange={setMonths} />
      </div>

      {me && overview && (
        <div className="pricing-owned-note">
          <Icon name="info" size={16} />
          <span>
            Connecté en tant que <b>{overview.organization.name}</b> : vos modules actifs sont signalés ci-dessous. Acheter un module déjà actif prolonge sa durée.
          </span>
          {!compact && (
            <Link to="/compte?tab=modules" className="pricing-owned-link">
              Mes modules <Icon name="chevronRight" size={14} />
            </Link>
          )}
        </div>
      )}

      <h2 className="pricing-h2">Packs</h2>
      <div className="packs">
        {catalog.packs.map((p) => (
          <PackCard key={p.key} pack={p} byKey={byKey} months={duration} usable={usable} paid={paid} loggedIn={!!me} onBuy={() => buy(p.modules, p.key)} />
        ))}
      </div>

      <h2 className="pricing-h2">
        Modules à la carte <span>Cochez plusieurs modules pour les acheter ensemble</span>
      </h2>
      <div className="modules-grid">
        {catalog.modules.map((m) => (
          <ModuleCard
            key={m.key}
            module={m}
            byKey={byKey}
            duration={duration}
            state={stateOf(m.key)}
            inCart={cartKeys.includes(m.key)}
            lockedBy={cartRequired.get(m.key)}
            onToggle={() => toggleCart(m.key)}
            onBuy={() => buy([m.key])}
            loggedIn={!!me}
          />
        ))}
        {catalog.upcoming.map((u) => (
          <div key={u} className="module-card is-upcoming">
            <div className="module-card-head">
              <span className="mod-chip tone-slate">
                <Icon name="clock" size={18} />
              </span>
              <div>
                <h3>{u}</h3>
                <span className="module-soon">Bientôt disponible</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {cartKeys.length > 0 && (
        <div className="cart-bar" role="region" aria-label="Sélection">
          <div className="cart-bar-chips">
            {cartKeys.map((k) => (
              <ModuleChip key={k} moduleKey={k} size={14} />
            ))}
          </div>
          <div className="cart-bar-text">
            <b>
              {cartKeys.length} module{cartKeys.length > 1 ? 's' : ''} sélectionné{cartKeys.length > 1 ? 's' : ''}
            </b>
            <span>
              {formatDzd(cartMonthly)} / mois{duration.months > 1 ? ` · ${formatDzd(cartMonthly * duration.billedMonths)} pour ${duration.label}` : ''}
            </span>
          </div>
          <button type="button" className="site-btn site-btn-ghost" onClick={() => setCart([])}>
            Vider
          </button>
          <button type="button" className="site-btn site-btn-primary" onClick={() => buy(cartKeys)}>
            {me ? 'Acheter la sélection' : 'Créer un compte pour acheter'} <Icon name="arrowRight" size={16} />
          </button>
        </div>
      )}

      {buying && (
        <PurchaseModal
          initialModules={buying.modules}
          packKey={buying.packKey}
          initialMonths={months}
          onClose={() => setBuying(null)}
          onDone={() => {
            setCart([]);
            loadOverview();
            onPurchased?.();
          }}
        />
      )}
    </div>
  );
}

function PackCard({
  pack: p,
  byKey,
  months,
  usable,
  paid,
  loggedIn,
  onBuy,
}: {
  pack: CatalogPack;
  byKey: Map<string, CatalogModule>;
  months: { months: number; billedMonths: number; label: string };
  usable: Set<string>;
  paid: Set<string>;
  loggedIn: boolean;
  onBuy: () => void;
}) {
  const owned = p.modules.filter((k) => usable.has(k)).length;
  const all = owned === p.modules.length;
  const allPaid = p.modules.every((k) => paid.has(k));
  return (
    <article id={`pack-${p.key}`} className={`pack${p.highlight ? ' is-highlight' : ''}`}>
      {p.highlight && <span className="pack-ribbon">Recommandé</span>}
      <h3>{p.name}</h3>
      <p className="pack-tagline">{p.tagline}</p>
      <div className="pack-price">
        <b>{formatDzd(p.monthlyPrice)}</b>
        <span>/ mois</span>
      </div>
      <div className="pack-period">{months.months > 1 ? `${formatDzd(p.monthlyPrice * months.billedMonths)} pour ${months.label}${months.billedMonths < months.months ? `, dont ${months.months - months.billedMonths} mois offert${months.months - months.billedMonths > 1 ? 's' : ''}` : ''}` : 'Sans engagement, mois par mois'}</div>
      {loggedIn && owned > 0 && (
        <div className={`pack-owned${all ? ' is-all' : ''}`}>
          <Icon name="check" size={14} /> {all ? 'Tous ces modules sont déjà actifs chez vous' : `${owned} module${owned > 1 ? 's' : ''} sur ${p.modules.length} déjà actif${owned > 1 ? 's' : ''} chez vous`}
        </div>
      )}
      {/* Same modules on the same rows in every pack, so packs compare at a glance. */}
      <ul className="pack-list">
        {[...byKey.keys()].map((k) => {
          const included = p.modules.includes(k);
          const m = byKey.get(k) as CatalogModule;
          const owned = included && loggedIn && usable.has(k);
          return (
            <li key={k} className={`${included ? '' : 'is-out'}${owned ? ' is-owned' : ''}`} title={included ? undefined : 'Non inclus dans ce pack'}>
              <ModuleChip moduleKey={k} size={14} muted={!included} />
              <span className="pack-mod-name">{PACK_SHORT[k] ?? m.name}</span>
              {owned && <Icon name="check" size={14} className="pack-owned-check" />}
              <small>{included ? `${formatDzd(m.monthlyPrice)}${m.unit ? '/site' : ''}` : 'Non inclus'}</small>
            </li>
          );
        })}
      </ul>
      <button type="button" className={`site-btn ${p.highlight ? 'site-btn-primary' : 'site-btn-light'} site-btn-block`} onClick={onBuy}>
        {!loggedIn ? 'Commencer avec ce pack' : allPaid ? 'Prolonger ce pack' : 'Choisir ce pack'}
      </button>
    </article>
  );
}

function ModuleCard({
  module: m,
  byKey,
  duration,
  state,
  inCart,
  lockedBy,
  onToggle,
  onBuy,
  loggedIn,
}: {
  module: CatalogModule;
  byKey: Map<string, CatalogModule>;
  duration: { months: number; billedMonths: number; label: string };
  state?: { state: 'active' | 'trial' | 'expired' | 'none'; daysLeft: number | null; endsAt: string | null };
  inCart: boolean;
  lockedBy?: string[];
  onToggle: () => void;
  onBuy: () => void;
  loggedIn: boolean;
}) {
  // "Prolonger" only makes sense for a module actually bought; a trial or a
  // never-owned module is simply "Acheter".
  const bought = state?.state === 'active';
  const active = bought || state?.state === 'trial';
  return (
    <article className={`module-card${inCart ? ' is-selected' : ''}${active ? ' is-owned' : ''}`}>
      <div className="module-card-head">
        <ModuleChip moduleKey={m.key} size={18} />
        <div className="module-card-title">
          <h3>{m.name}</h3>
          {loggedIn && state && state.state !== 'none' ? <StateBadge state={state.state} daysLeft={state.daysLeft} endsAt={state.endsAt} /> : <span className="module-tagline">{m.tagline}</span>}
        </div>
        <label className="module-check" title="Ajouter à la sélection">
          <input type="checkbox" checked={inCart} disabled={!!lockedBy?.length} onChange={onToggle} aria-label={`Sélectionner ${m.name}`} title={lockedBy?.length ? `Requis par ${lockedBy.join(', ')}` : undefined} />
        </label>
      </div>
      {loggedIn && state && state.state !== 'none' && <p className="module-tagline">{m.tagline}</p>}
      <ul className="module-features">
        {m.features.map((f) => (
          <li key={f}>
            <Icon name="check" size={14} /> {f}
          </li>
        ))}
      </ul>
      {m.dependencies.length > 0 && <div className="module-deps">Nécessite : {m.dependencies.map((d) => byKey.get(d)?.name ?? d).join(', ')} (ajouté automatiquement)</div>}
      {state?.state === 'trial' && <div className="module-deps is-trial">Essai en cours : vos jours d’essai restants sont conservés si vous achetez.</div>}
      <div className="module-card-foot">
        <div className="module-price">
          <b>{formatDzd(m.monthlyPrice)}</b>
          <span>{m.unit ? `/ mois par ${m.unit}` : '/ mois'}</span>
        </div>
        <button type="button" className="site-btn site-btn-light site-btn-sm" onClick={onBuy}>
          {bought ? 'Prolonger' : state?.state === 'expired' ? 'Réactiver' : 'Acheter'}
        </button>
      </div>
    </article>
  );
}
