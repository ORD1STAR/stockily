import { FormEvent, ReactNode, useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  accountApi,
  AccountProfile,
  ApiError,
  billingApi,
  BillingOverview,
  PlatformPaymentView,
} from '../lib/api';
import { useAuth } from '../lib/auth-context';
import {
  formatDate,
  formatDuration,
  formatDzd,
  ModuleChip,
  PurchaseModal,
  StateBadge,
} from '../lib/billing';
import { Icon, IconName } from '../lib/Icon';
import { toast } from '../lib/toast';
import { PricingSection } from './PricingSection';
import { SiteLayout, useSuggest } from './SiteLayout';

type Tab = 'overview' | 'modules' | 'buy' | 'payments' | 'profile';
const TABS: { key: Tab; label: string; icon: IconName }[] = [
  { key: 'overview', label: 'Vue d’ensemble', icon: 'home' },
  { key: 'modules', label: 'Mes modules', icon: 'grid' },
  { key: 'buy', label: 'Acheter des modules', icon: 'cart' },
  { key: 'payments', label: 'Paiements & factures', icon: 'receipt' },
  { key: 'profile', label: 'Mon compte', icon: 'settings' },
];

const KIND_LABEL: Record<string, string> = {
  purchase: 'Achat',
  topup: 'Ancien rechargement',
  renewal: 'Ancien renouvellement',
};

// Espace client: the organization's subscription (modules owned and for how
// long, purchases and invoices) and the user's own
// account settings — distinct from "Mon Business" (the application itself).
// Rendered inside SiteLayout, which provides the "Proposer des ajouts" form.
function SuggestButton() {
  const suggest = useSuggest();
  return (
    <button type="button" className="site-btn site-btn-light" onClick={suggest}>
      <Icon name="sparkles" size={16} /> Proposer des ajouts
    </button>
  );
}

export function AccountPage() {
  const { me, accessToken, refreshMe } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = (
    TABS.some((t) => t.key === params.get('tab'))
      ? params.get('tab')
      : 'overview'
  ) as Tab;
  const setTab = (t: Tab) => setParams(t === 'overview' ? {} : { tab: t });
  const [overview, setOverview] = useState<BillingOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accessToken) return;
    try {
      setOverview(await billingApi.overview(accessToken));
      setError(null);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Impossible de charger votre abonnement.',
      );
    }
  }, [accessToken]);
  useEffect(() => {
    load();
  }, [load]);

  // Back from Chargily Pay (?pay=<payment id>): ask the server for the real outcome.
  const payId = params.get('pay');
  const payFailed = params.get('failed') === '1';
  useEffect(() => {
    if (!payId || !accessToken) return;
    let cancelled = false;
    (async () => {
      try {
        let res = await billingApi.syncPayment(accessToken, payId);
        // The confirmation can lag by a few seconds: look again before giving up.
        for (
          let i = 0;
          i < 3 && !cancelled && res.payment.status === 'pending' && !payFailed;
          i++
        ) {
          await new Promise((r) => setTimeout(r, 2500));
          res = await billingApi.syncPayment(accessToken, payId);
        }
        if (cancelled) return;
        if (res.payment.status === 'paid') {
          toast.success('Paiement confirmé : vos modules sont activés');
          await refreshMe().catch(() => undefined);
        } else if (res.payment.status === 'pending' && !payFailed)
          toast.success(
            'Paiement en cours de confirmation. Il apparaîtra ici dès qu’il sera validé.',
          );
        else
          toast.error(
            'Le paiement n’a pas abouti. Aucun montant n’a été débité pour cette commande.',
          );
        await load();
      } catch {
        if (!cancelled)
          toast.error('Impossible de vérifier le paiement pour le moment.');
      } finally {
        if (!cancelled) setParams({ tab: 'payments' }, { replace: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [payId, payFailed, accessToken, refreshMe, load, setParams]);

  if (!me) return null;
  const who =
    me.user.displayName ??
    me.user.email ??
    (me.user.username ? `@${me.user.username}` : '');

  return (
    <SiteLayout className="site-account">
      <div className="site-container acct">
        <div className="acct-head">
          <div>
            <span className="section-eyebrow">Espace client</span>
            <h1>{overview?.organization.name ?? me.organization.name}</h1>
            <p>
              Connecté en tant que <b>{who}</b> · abonnement, factures et
              paramètres de votre compte.
            </p>
          </div>
          <div className="acct-head-actions">
            <SuggestButton />
            <Link to="/dashboard" className="site-btn site-btn-primary">
              Ouvrir Mon Business <Icon name="arrowRight" size={16} />
            </Link>
          </div>
        </div>

        <div className="acct-layout">
          <nav className="acct-nav" aria-label="Espace client">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                className={`acct-nav-item${tab === t.key ? ' is-active' : ''}`}
                onClick={() => setTab(t.key)}
                aria-current={tab === t.key ? 'page' : undefined}
              >
                <Icon name={t.icon} size={17} />
                <span>{t.label}</span>
              </button>
            ))}
          </nav>

          <div className="acct-panel">
            {error && <div className="error-banner">{error}</div>}
            {tab === 'profile' ? (
              <ProfileTab />
            ) : !overview ? (
              !error && (
                <div className="page-loader" style={{ minHeight: 300 }}>
                  <span className="spinner" /> Chargement…
                </div>
              )
            ) : (
              <>
                {!overview.canManage && tab !== 'payments' && (
                  <div className="bl-note is-warn">
                    <Icon name="lock" size={16} /> Vous pouvez consulter
                    l’abonnement, mais seul un administrateur du compte peut
                    acheter des modules ou modifier le renouvellement.
                  </div>
                )}
                {tab === 'overview' && (
                  <OverviewTab overview={overview} goTo={setTab} />
                )}
                {tab === 'modules' && (
                  <ModulesTab overview={overview} reload={load} />
                )}
                {tab === 'buy' && (
                  <div>
                    <PanelTitle
                      title="Acheter des modules"
                      sub="Choisissez un pack ou composez votre sélection. Acheter un module actif prolonge sa durée."
                    />
                    <PricingSection
                      overview={overview}
                      onPurchased={load}
                      compact
                    />
                  </div>
                )}
                {tab === 'payments' && (
                  <PaymentsTab payments={overview.payments} />
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </SiteLayout>
  );
}

function PanelTitle({
  title,
  sub,
  right,
}: {
  title: string;
  sub?: string;
  right?: ReactNode;
}) {
  return (
    <div className="acct-panel-head">
      <div>
        <h2>{title}</h2>
        {sub && <p>{sub}</p>}
      </div>
      {right}
    </div>
  );
}

// ───────────────────────── Vue d’ensemble ─────────────────────────

function OverviewTab({
  overview,
  goTo,
}: {
  overview: BillingOverview;
  goTo: (t: Tab) => void;
}) {
  const running = overview.modules.filter(
    (m) => m.state === 'active' || m.state === 'trial',
  );
  const next = running
    .filter((m) => m.endsAt)
    .sort(
      (a, b) =>
        new Date(a.endsAt as string).getTime() -
        new Date(b.endsAt as string).getTime(),
    )[0];
  const last = overview.payments[0];
  return (
    <div>
      <PanelTitle
        title="Vue d’ensemble"
        sub="L’essentiel de votre abonnement en un coup d’œil."
      />
      <div className="acct-stats">
        <button
          type="button"
          className="acct-stat"
          onClick={() => goTo('modules')}
        >
          <span className="acct-stat-label">Modules actifs</span>
          <b>
            {running.length} <small>/ {overview.modules.length}</small>
          </b>
          <span className="acct-stat-hint">
            {running.filter((m) => m.state === 'trial').length
              ? `dont ${running.filter((m) => m.state === 'trial').length} en essai`
              : 'Voir le détail'}
          </span>
        </button>
        <button
          type="button"
          className="acct-stat"
          onClick={() => goTo('modules')}
        >
          <span className="acct-stat-label">Prochaine échéance</span>
          <b>{next?.endsAt ? formatDuration(new Date(next.endsAt)) : '—'}</b>
          <span className="acct-stat-hint">
            {next
              ? `${next.name} · ${formatDate(next.endsAt)}`
              : 'Aucune échéance'}
          </span>
        </button>
        <button
          type="button"
          className="acct-stat"
          onClick={() => goTo('payments')}
        >
          <span className="acct-stat-label">Dernier paiement</span>
          <b>{last ? formatDzd(last.amount) : '—'}</b>
          <span className="acct-stat-hint">
            {last
              ? `${KIND_LABEL[last.kind] ?? last.kind} · ${formatDate(last.paidAt ?? last.createdAt)}`
              : 'Aucun paiement'}
          </span>
        </button>
      </div>

      <div className="acct-card">
        <div className="acct-card-head">
          <h3>Vos modules</h3>
          <button
            type="button"
            className="btn-link"
            onClick={() => goTo('modules')}
          >
            Tout gérer →
          </button>
        </div>
        <div className="acct-mini-modules">
          {overview.modules.map((m) => (
            <div
              key={m.key}
              className={`acct-mini${m.state === 'active' || m.state === 'trial' ? '' : ' is-off'}`}
            >
              <ModuleChip
                moduleKey={m.key}
                size={15}
                muted={!(m.state === 'active' || m.state === 'trial')}
              />
              <span className="acct-mini-name">{m.name}</span>
              <StateBadge
                state={m.state}
                daysLeft={m.daysLeft}
                endsAt={m.endsAt}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="acct-quick">
        <button
          type="button"
          className="acct-quick-item"
          onClick={() => goTo('buy')}
        >
          <span className="mod-chip tone-violet">
            <Icon name="cart" size={18} />
          </span>
          <span>
            <b>Acheter des modules</b>
            <small>Packs ou modules à la carte</small>
          </span>
        </button>
        <button
          type="button"
          className="acct-quick-item"
          onClick={() => goTo('profile')}
        >
          <span className="mod-chip tone-blue">
            <Icon name="settings" size={18} />
          </span>
          <span>
            <b>Mon compte</b>
            <small>Email, téléphone, mot de passe</small>
          </span>
        </button>
      </div>
    </div>
  );
}

// ───────────────────────── Mes modules ─────────────────────────

function ModulesTab({
  overview,
  reload,
}: {
  overview: BillingOverview;
  reload: () => Promise<void>;
}) {
  const [buying, setBuying] = useState<string[] | null>(null);
  const owned = overview.modules.filter((m) => m.state !== 'none');
  const others = overview.modules.filter((m) => m.state === 'none');

  const progress = (m: BillingOverview['modules'][number]) => {
    if (m.daysLeft == null) return null;
    const span = m.state === 'trial' ? 15 : 31;
    return Math.max(4, Math.min(100, (m.daysLeft / span) * 100));
  };

  return (
    <div>
      <PanelTitle
        title="Mes modules"
        sub="Durée restante de chaque module. Pour prolonger, achetez simplement des mois en plus : ils s’ajoutent à la fin de la période en cours."
      />
      <div className="acct-modules">
        {owned.map((m) => {
          const p = progress(m);
          return (
            <div
              key={m.key}
              className={`acct-module${m.state === 'expired' ? ' is-expired' : ''}`}
            >
              <ModuleChip
                moduleKey={m.key}
                size={18}
                muted={m.state === 'expired'}
              />
              <div className="acct-module-main">
                <div className="acct-module-top">
                  <b>{m.name}</b>
                  <StateBadge
                    state={m.state}
                    daysLeft={m.daysLeft}
                    endsAt={m.endsAt}
                  />
                </div>
                <div className="acct-module-sub">
                  {m.state === 'expired'
                    ? `Expiré${m.endsAt ? ` le ${formatDate(m.endsAt)}` : ''}, vos données sont conservées`
                    : m.endsAt
                      ? `${m.state === 'trial' ? 'Essai jusqu’au' : 'Actif jusqu’au'} ${formatDate(m.endsAt)}`
                      : 'Actif sans échéance'}
                  {' · '}
                  {m.key === 'sites'
                    ? `1er site gratuit, ${formatDzd(m.monthlyPrice)}/mois par site en plus${m.siteQuota ? ` (${m.siteQuota} payé${m.siteQuota > 1 ? 's' : ''}, ${overview.sitesUsed} site${overview.sitesUsed > 1 ? 's' : ''} utilisé${overview.sitesUsed > 1 ? 's' : ''})` : ''}`
                    : `${formatDzd(m.monthlyPrice)}/mois`}
                </div>
                {p != null && (
                  <div
                    className={`acct-progress${(m.daysLeft ?? 99) <= 7 ? ' is-low' : ''}`}
                  >
                    <span style={{ width: `${p}%` }} />
                  </div>
                )}
              </div>
              <div className="acct-module-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={!overview.canManage}
                  onClick={() => setBuying([m.key])}
                >
                  {m.state === 'expired'
                    ? 'Réactiver'
                    : m.state === 'trial'
                      ? 'Acheter'
                      : 'Prolonger'}
                </button>
              </div>
            </div>
          );
        })}
        {owned.length === 0 && (
          <div className="acct-empty">Vous n’avez encore aucun module.</div>
        )}
      </div>

      {others.length > 0 && (
        <>
          <h3 className="acct-subtitle">Modules disponibles</h3>
          <div className="acct-available">
            {others.map((m) => (
              <button
                key={m.key}
                type="button"
                className="acct-avail"
                disabled={!overview.canManage}
                onClick={() => setBuying([m.key])}
              >
                <ModuleChip moduleKey={m.key} size={16} muted />
                <span>
                  <b>{m.name}</b>
                  <small>{formatDzd(m.monthlyPrice)}/mois</small>
                </span>
                <span className="acct-avail-cta">
                  <Icon name="plus" size={14} /> Ajouter
                </span>
              </button>
            ))}
          </div>
        </>
      )}
      {buying && (
        <PurchaseModal
          initialModules={buying}
          onClose={() => setBuying(null)}
          onDone={reload}
        />
      )}
    </div>
  );
}

// ───────────────────────── Paiements ─────────────────────────

function PaymentsTab({ payments }: { payments: PlatformPaymentView[] }) {
  const { accessToken } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);

  async function download(p: PlatformPaymentView, open = false) {
    if (!accessToken) return;
    setBusy(p.id);
    try {
      const blob = await billingApi.fetchPaymentPdf(accessToken, p.id);
      const url = URL.createObjectURL(blob);
      if (open) window.open(url, '_blank');
      else {
        const a = document.createElement('a');
        a.href = url;
        a.download = `facture-${p.number ?? p.id}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Téléchargement impossible.',
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <PanelTitle
        title="Paiements & factures"
        sub="Historique de vos achats. Chaque opération a sa facture PDF."
      />
      {payments.length === 0 ? (
        <div className="acct-empty">
          <Icon name="receipt" size={22} />
          Aucun paiement pour le moment.
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data acct-table">
            <thead>
              <tr>
                <th>N°</th>
                <th>Date</th>
                <th>Opération</th>
                <th>Détail</th>
                <th className="num">Montant</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <td className="mono acct-nowrap">{p.number ?? '—'}</td>
                  <td className="acct-nowrap">
                    {new Date(p.paidAt ?? p.createdAt).toLocaleDateString(
                      'fr-FR',
                    )}
                  </td>
                  <td>
                    <span className={`acct-kind is-${p.kind}`}>
                      {KIND_LABEL[p.kind] ?? p.kind}
                    </span>
                  </td>
                  <td className="acct-detail">
                    {p.items
                      .map((i) =>
                        i.months ? `${i.label} (${i.months} mois)` : i.label,
                      )
                      .join(', ')}
                    <span className="acct-method">{p.method ?? ''}</span>
                  </td>
                  <td className="num acct-nowrap">
                    <b>{formatDzd(p.amount)}</b>
                  </td>
                  <td className="acct-actions-cell">
                    {p.status !== 'paid' ? (
                      <>
                        <span className={`acct-kind is-${p.status}`}>
                          {p.status === 'pending'
                            ? 'En attente'
                            : p.status === 'canceled'
                              ? 'Annulé'
                              : 'Échoué'}
                        </span>
                        {p.status === 'pending' && p.checkoutUrl && (
                          <a className="btn-link" href={p.checkoutUrl}>
                            Payer
                          </a>
                        )}
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="btn-link"
                          disabled={busy === p.id}
                          onClick={() => download(p, true)}
                        >
                          Voir
                        </button>
                        <button
                          type="button"
                          className="btn-secondary acct-dl"
                          disabled={busy === p.id}
                          onClick={() => download(p)}
                          title="Télécharger la facture PDF"
                        >
                          <Icon name="receipt" size={14} /> PDF
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ───────────────────────── Mon compte ─────────────────────────

function ProfileTab() {
  const { accessToken, refreshMe } = useAuth();
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [form, setForm] = useState({
    displayName: '',
    email: '',
    username: '',
    phone: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSaving, setPwSaving] = useState(false);
  const [tfBusy, setTfBusy] = useState(false);
  const [tfAsking, setTfAsking] = useState(false);
  const [tfPassword, setTfPassword] = useState('');
  const [tfError, setTfError] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    accountApi
      .get(accessToken)
      .then((p) => {
        setProfile(p);
        setForm({
          displayName: p.displayName ?? '',
          email: p.email ?? '',
          username: p.username ?? '',
          phone: p.phone ?? '',
        });
      })
      .catch((err) =>
        setError(
          err instanceof ApiError ? err.message : 'Chargement impossible.',
        ),
      );
  }, [accessToken]);

  const dirty =
    !!profile &&
    (form.displayName !== (profile.displayName ?? '') ||
      form.email !== (profile.email ?? '') ||
      form.username !== (profile.username ?? '') ||
      form.phone !== (profile.phone ?? ''));

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!accessToken || !profile) return;
    setSaving(true);
    setError(null);
    const patch: Record<string, string> = {};
    if (form.displayName !== (profile.displayName ?? ''))
      patch.displayName = form.displayName;
    if (form.phone !== (profile.phone ?? '')) patch.phone = form.phone;
    if (form.email !== (profile.email ?? '') && form.email.trim())
      patch.email = form.email.trim();
    if (form.username !== (profile.username ?? '') && form.username.trim())
      patch.username = form.username.trim();
    try {
      const p = await accountApi.update(accessToken, patch);
      setProfile(p);
      setForm({
        displayName: p.displayName ?? '',
        email: p.email ?? '',
        username: p.username ?? '',
        phone: p.phone ?? '',
      });
      await refreshMe().catch(() => undefined);
      toast.success('Informations enregistrées');
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Enregistrement impossible.',
      );
    } finally {
      setSaving(false);
    }
  }

  async function setTwoFactor(enabled: boolean, password?: string) {
    if (!accessToken) return;
    setTfBusy(true);
    setTfError(null);
    try {
      const p = await accountApi.setTwoFactor(accessToken, enabled, password);
      setProfile(p);
      setTfAsking(false);
      setTfPassword('');
      toast.success(enabled ? 'Double authentification activée' : 'Double authentification désactivée');
    } catch (err) {
      setTfError(err instanceof ApiError ? err.message : 'Modification impossible.');
    } finally {
      setTfBusy(false);
    }
  }

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    if (!accessToken) return;
    setPwError(null);
    if (pw.next.length < 8)
      return setPwError(
        'Le nouveau mot de passe doit contenir au moins 8 caractères.',
      );
    if (pw.next !== pw.confirm)
      return setPwError('Les deux mots de passe ne correspondent pas.');
    setPwSaving(true);
    try {
      await accountApi.changePassword(accessToken, pw.current, pw.next);
      setPw({ current: '', next: '', confirm: '' });
      toast.success('Mot de passe modifié');
    } catch (err) {
      setPwError(
        err instanceof ApiError ? err.message : 'Modification impossible.',
      );
    } finally {
      setPwSaving(false);
    }
  }

  return (
    <div>
      <PanelTitle
        title="Mon compte"
        sub="Vos informations de connexion et de contact."
      />
      {!profile ? (
        error ? (
          <div className="error-banner">{error}</div>
        ) : (
          <div className="page-loader" style={{ minHeight: 200 }}>
            <span className="spinner" /> Chargement…
          </div>
        )
      ) : (
        <div className="acct-forms">
          <form className="acct-card" onSubmit={save}>
            <h3>Informations personnelles</h3>
            {error && <div className="error-banner">{error}</div>}
            <div className="acct-form-grid">
              <div className="field-row">
                <label htmlFor="displayName">Nom affiché</label>
                <input
                  id="displayName"
                  value={form.displayName}
                  maxLength={120}
                  placeholder="Ex. Karim Benali"
                  onChange={(e) =>
                    setForm({ ...form, displayName: e.target.value })
                  }
                />
              </div>
              <div className="field-row">
                <label htmlFor="phone">Téléphone</label>
                <input
                  id="phone"
                  type="tel"
                  inputMode="tel"
                  value={form.phone}
                  placeholder="Ex. 0555 12 34 56"
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </div>
              <div className="field-row">
                <label htmlFor="email">Adresse email</label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={form.email}
                  placeholder="vous@entreprise.dz"
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </div>
              <div className="field-row">
                <label htmlFor="username">Nom d’utilisateur</label>
                <input
                  id="username"
                  autoComplete="username"
                  value={form.username}
                  placeholder="Ex. karim.b"
                  onChange={(e) =>
                    setForm({ ...form, username: e.target.value })
                  }
                />
              </div>
            </div>
            <p className="form-hint">
              Vous pouvez vous connecter avec votre email ou votre nom
              d’utilisateur. Si vous changez d’adresse, un code de confirmation
              vous sera demandé à la prochaine connexion.
            </p>
            <div className="acct-form-actions">
              <button
                type="submit"
                className="btn-primary"
                disabled={!dirty || saving}
              >
                {saving ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
          </form>

          <form className="acct-card" onSubmit={changePassword}>
            <h3>Mot de passe</h3>
            {pwError && <div className="error-banner">{pwError}</div>}
            <div className="field-row">
              <label htmlFor="pw-current">Mot de passe actuel</label>
              <input
                id="pw-current"
                type="password"
                autoComplete="current-password"
                required
                value={pw.current}
                onChange={(e) => setPw({ ...pw, current: e.target.value })}
              />
            </div>
            <div className="acct-form-grid">
              <div className="field-row">
                <label htmlFor="pw-next">Nouveau mot de passe</label>
                <input
                  id="pw-next"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={pw.next}
                  onChange={(e) => setPw({ ...pw, next: e.target.value })}
                />
              </div>
              <div className="field-row">
                <label htmlFor="pw-confirm">Confirmer</label>
                <input
                  id="pw-confirm"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={pw.confirm}
                  onChange={(e) => setPw({ ...pw, confirm: e.target.value })}
                />
              </div>
            </div>
            <p className="form-hint">8 caractères minimum.</p>
            <div className="acct-form-actions">
              <button
                type="submit"
                className="btn-primary"
                disabled={pwSaving || !pw.current || !pw.next}
              >
                {pwSaving ? 'Modification…' : 'Changer le mot de passe'}
              </button>
            </div>
          </form>

          {profile.email && (
            <div className="acct-card">
              <h3>Sécurité</h3>
              {tfError && <div className="error-banner">{tfError}</div>}
              <div className="acct-sec-row">
                <div>
                  <b>Double authentification par e-mail</b>{' '}
                  <span className={`acct-sec-state ${profile.twoFactorEnabled ? 'is-on' : 'is-off'}`}>{profile.twoFactorEnabled ? 'Activée' : 'Désactivée'}</span>
                  <p>
                    {profile.twoFactorEnabled
                      ? `À chaque connexion, un code à 6 chiffres est envoyé à ${profile.email}.`
                      : 'Activez-la pour qu’un code envoyé par e-mail soit demandé à chaque connexion : votre compte reste protégé même si votre mot de passe est découvert.'}
                  </p>
                </div>
                {!tfAsking && (
                  <button
                    type="button"
                    className={profile.twoFactorEnabled ? 'btn-secondary' : 'btn-primary'}
                    disabled={tfBusy}
                    onClick={() => (profile.twoFactorEnabled ? setTfAsking(true) : void setTwoFactor(true))}
                  >
                    {profile.twoFactorEnabled ? 'Désactiver' : 'Activer'}
                  </button>
                )}
              </div>
              {tfAsking && (
                <form
                  className="acct-sec-confirm"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void setTwoFactor(false, tfPassword);
                  }}
                >
                  <div className="field-row">
                    <label htmlFor="tf-password">Confirmez avec votre mot de passe</label>
                    <input id="tf-password" type="password" autoComplete="current-password" required autoFocus value={tfPassword} onChange={(e) => setTfPassword(e.target.value)} />
                  </div>
                  <div className="acct-form-actions">
                    <button type="button" className="btn-secondary" onClick={() => { setTfAsking(false); setTfPassword(''); setTfError(null); }}>
                      Annuler
                    </button>
                    <button type="submit" className="btn-primary" disabled={tfBusy || !tfPassword}>
                      {tfBusy ? 'Désactivation…' : 'Désactiver'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default AccountPage;
