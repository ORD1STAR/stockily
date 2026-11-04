import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth-context';
import { AppShell, initials } from '../lib/AppShell';
import { MobileHeader, ModuleTiles } from '../lib/MobileChrome';
import { inventoryApi, invoicingApi, purchasingApi, qualityApi, salesApi, stockApi, StockRow } from '../lib/api';
import { Icon, IconName } from '../lib/Icon';
import { entitledModuleKeys, PRODUCT_MODULES } from '../lib/modules';
import { OrganizationSettingsModal } from '../lib/OrganizationSettingsModal';
import { PartnersModal } from '../lib/PartnersModal';
import { useIsMobile } from '../lib/useIsMobile';
import './DashboardPage.css';

const money = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const formatDzd = (n: number) => `${money.format(n)} DZD`;

interface Overview {
  stockOut: StockRow[];
  stockLow: StockRow[];
  unpaidBalance: number | null;
  unpaidCount: number | null;
  openNc: number | null;
  expiryAlerts: number | null;
  purchasing: { openOrdersCount: number; openOrdersValue: number; overdueCount: number; expectedSoonCount: number } | null;
  inventory: { isDue: boolean; frequencyLabel: string; lastInventoryAt: string | null } | null;
  sales: { openQuotesCount: number; openOrdersCount: number; openOrdersValue: number; overdueCount: number } | null;
}

// Every module's numbers are fetched independently and only when the org is
// entitled to it — one failing endpoint never blanks the whole home page.
function useOverview(): { data: Overview | null; loading: boolean } {
  const { me, accessToken } = useAuth();
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!me || !accessToken) return;
    const has = entitledModuleKeys(me.entitlements);
    let cancelled = false;
    const opt = <T,>(cond: boolean, p: () => Promise<T>) => (cond ? p().catch(() => null) : Promise.resolve(null));

    Promise.all([
      opt(has.has('stock'), () => stockApi.listProducts(accessToken, 'all')),
      opt(has.has('invoicing'), () => invoicingApi.listInvoices(accessToken)),
      opt(has.has('quality'), () => qualityApi.listNonConformities(accessToken, 'open')),
      opt(has.has('quality'), () => qualityApi.listExpiryAlerts(accessToken)),
      opt(has.has('purchasing'), () => purchasingApi.getDashboard(accessToken)),
      opt(has.has('sales'), () => salesApi.getDashboard(accessToken)),
      opt(has.has('stock'), () => inventoryApi.reminder(accessToken)),
    ]).then(([stock, invoices, ncs, expiry, purchasing, sales, inventory]) => {
      if (cancelled) return;
      const unpaid = invoices?.filter((i) => i.status === 'unpaid' || i.status === 'partially_paid') ?? null;
      setData({
        stockOut: stock?.filter((r) => r.status === 'out') ?? [],
        stockLow: stock?.filter((r) => r.status === 'low') ?? [],
        unpaidBalance: unpaid ? unpaid.reduce((s, i) => s + i.balance, 0) : null,
        unpaidCount: unpaid ? unpaid.length : null,
        openNc: ncs ? ncs.length : null,
        expiryAlerts: expiry ? expiry.length : null,
        purchasing,
        sales,
        inventory,
      });
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [me, accessToken]);

  return { data, loading };
}

function greeting(): string {
  const h = new Date().getHours();
  return h < 5 ? 'Bonsoir' : h < 18 ? 'Bonjour' : 'Bonsoir';
}

export function DashboardPage() {
  const { me } = useAuth();
  const isMobile = useIsMobile();
  if (!me) return null; // ProtectedRoute guarantees this doesn't happen
  return isMobile ? <MobileHome /> : <DesktopDashboard />;
}

function DesktopDashboard() {
  const { me, logoutEverywhere } = useAuth();
  const { data, loading } = useOverview();
  if (!me) return null;
  const has = entitledModuleKeys(me.entitlements);
  const today = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  const todos = buildTodos(data, has);

  return (
    <AppShell>
      <div className="panel-head">
        <div>
          <div className="dash-date">{today}</div>
          <h2>
            {greeting()}, {me.organization.name.replace(/\s*\(.*?\)\s*/g, '')}
          </h2>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {has.has('scan') && (
            <Link to="/scan" className="btn-secondary">
              <Icon name="scan" size={16} /> Scanner
            </Link>
          )}
          {has.has('stock') && (
            <Link to="/stock" className="btn-primary">
              <Icon name="package" size={16} /> Gérer le stock
            </Link>
          )}
        </div>
      </div>

      <div className="dash-kpis">
        {has.has('stock') && (
          <Kpi
            to="/stock"
            icon="package"
            tone="rose"
            label="Ruptures de stock"
            loading={loading}
            value={data ? String(data.stockOut.length) : '—'}
            hint={data ? `${new Set(data.stockOut.map((r) => r.productId)).size} article(s) sur ${new Set(data.stockOut.map((r) => r.site.id)).size} site(s) · ${data.stockLow.length} sous le seuil` : undefined}
          />
        )}
        {has.has('invoicing') && (
          <Kpi to="/invoicing" icon="wallet" tone="amber" label="Solde impayé" loading={loading} value={data?.unpaidBalance != null ? formatDzd(data.unpaidBalance) : '—'} hint={data?.unpaidCount != null ? `${data.unpaidCount} facture(s) en attente` : undefined} />
        )}
        {has.has('sales') && (
          <Kpi to="/sales" icon="trending" tone="green" label="Commandes clients" loading={loading} value={data?.sales ? String(data.sales.openOrdersCount) : '—'} hint={data?.sales ? `${data.sales.openQuotesCount} devis ouvert(s)` : undefined} />
        )}
        {has.has('purchasing') && (
          <Kpi to="/purchasing" icon="cart" tone="blue" label="Achats en cours" loading={loading} value={data?.purchasing ? formatDzd(data.purchasing.openOrdersValue) : '—'} hint={data?.purchasing ? `${data.purchasing.openOrdersCount} bon(s) de commande` : undefined} />
        )}
      </div>

      <div className="dash-grid">
        <section className="dash-card">
          <div className="dash-card-head">
            <h3>À traiter</h3>
            {!loading && todos.length > 0 && <span className="dash-count">{todos.length}</span>}
          </div>
          {loading ? (
            <div className="dash-skeleton-list">
              <span />
              <span />
              <span />
            </div>
          ) : todos.length === 0 ? (
            <div className="dash-allgood">
              <span className="dash-allgood-icon">
                <Icon name="check" size={20} />
              </span>
              <div>
                <div className="dash-allgood-title">Tout est en ordre</div>
                <div className="dash-allgood-sub">Aucune alerte de stock, de qualité ou de paiement.</div>
              </div>
            </div>
          ) : (
            <ul className="dash-todos">
              {todos.map((t) => (
                <li key={t.key}>
                  <Link to={t.to} className="dash-todo">
                    <span className={`dash-todo-icon tone-${t.tone}`}>
                      <Icon name={t.icon} size={16} />
                    </span>
                    <span className="dash-todo-text">
                      <span className="dash-todo-title">{t.title}</span>
                      {t.sub && <span className="dash-todo-sub">{t.sub}</span>}
                    </span>
                    <Icon name="chevronRight" size={16} className="dash-todo-chevron" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="dash-card">
          <div className="dash-card-head">
            <h3>Applications</h3>
          </div>
          <div className="dash-modules">
            {PRODUCT_MODULES.filter((m) => has.has(m.key)).map((m) => (
              <Link key={m.to} to={m.to} className="dash-module">
                <span className={`mod-chip tone-${m.tone}`}>
                  <Icon name={m.icon} size={18} />
                </span>
                <span className="dash-module-text">
                  <span className="dash-module-label">{m.label}</span>
                  <span className="dash-module-hint">{m.hint}</span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      </div>

      <section className="dash-card dash-account">
        <div className="dash-account-id">
          <span className="shell-avatar">{initials(me.organization.name)}</span>
          <div>
            <div className="dash-account-org">{me.organization.name}</div>
            <div className="dash-account-email">
              {me.user.email} · {me.roles.map((r) => `${r.role}${r.site ? ` (${r.site})` : ''}`).join(', ')}
            </div>
          </div>
        </div>
        <div className="dash-account-modules">
          {me.entitlements.map((e) => {
            const mod = PRODUCT_MODULES.find((m) => m.key === e.module);
            return (
              <span key={e.module} className={`pill ${e.status === 'active' ? 'success' : e.status === 'trial' ? 'info' : 'warning'}`} title={e.trialEndsAt ? `Essai jusqu'au ${new Date(e.trialEndsAt).toLocaleDateString('fr-FR')}` : undefined}>
                {mod?.label ?? e.module}
                {e.status === 'trial' ? ' · essai' : ''}
              </span>
            );
          })}
        </div>
        <button className="btn-secondary" onClick={() => logoutEverywhere()}>
          <Icon name="logout" size={15} /> Déconnecter tous les appareils
        </button>
      </section>
    </AppShell>
  );
}

function Kpi({ to, icon, tone, label, value, hint, loading }: { to: string; icon: IconName; tone: string; label: string; value: string; hint?: string; loading: boolean }) {
  return (
    <Link to={to} className="dash-kpi">
      <div className="dash-kpi-top">
        <span className={`mod-chip sm tone-${tone}`}>
          <Icon name={icon} size={16} />
        </span>
        <span className="dash-kpi-label">{label}</span>
      </div>
      {loading ? <span className="dash-skeleton" /> : <div className="dash-kpi-value">{value}</div>}
      {!loading && hint && <div className="dash-kpi-hint">{hint}</div>}
    </Link>
  );
}

interface Todo {
  key: string;
  to: string;
  icon: IconName;
  tone: string;
  title: string;
  sub?: string;
}

function buildTodos(data: Overview | null, has: Set<string>): Todo[] {
  if (!data) return [];
  const todos: Todo[] = [];
  const names = (rows: StockRow[]) => {
    const unique = [...new Set(rows.map((r) => r.name))];
    return unique.slice(0, 3).join(', ') + (unique.length > 3 ? ` +${unique.length - 3}` : '');
  };
  if (has.has('stock') && data.stockOut.length) {
    todos.push({ key: 'out', to: '/stock', icon: 'alert', tone: 'rose', title: `${new Set(data.stockOut.map((r) => r.productId)).size} article(s) en rupture sur au moins un site`, sub: names(data.stockOut) });
  }
  if (has.has('stock') && data.stockLow.length) {
    todos.push({ key: 'low', to: '/stock', icon: 'package', tone: 'amber', title: `${data.stockLow.length} article(s) sous le seuil minimum`, sub: names(data.stockLow) });
  }
  if (data.openNc) {
    todos.push({ key: 'nc', to: '/quality', icon: 'shield', tone: 'rose', title: `${data.openNc} non-conformité(s) ouverte(s)`, sub: 'À résoudre dans Qualité' });
  }
  if (data.expiryAlerts) {
    todos.push({ key: 'exp', to: '/quality', icon: 'clock', tone: 'amber', title: `${data.expiryAlerts} lot(s) proche(s) de la péremption`, sub: 'Vérifier les dates dans Qualité' });
  }
  if (data.unpaidCount) {
    todos.push({ key: 'unpaid', to: '/invoicing', icon: 'wallet', tone: 'amber', title: `${data.unpaidCount} facture(s) impayée(s)`, sub: data.unpaidBalance != null ? `${formatDzd(data.unpaidBalance)} restant à encaisser` : undefined });
  }
  if (data.inventory?.isDue) {
    todos.unshift({
      key: 'inventory',
      to: '/inventory',
      icon: 'clipboard',
      tone: 'violet',
      title: 'Inventaire à faire',
      sub: data.inventory.lastInventoryAt
        ? `Dernier inventaire le ${new Date(data.inventory.lastInventoryAt).toLocaleDateString('fr-FR')} · ${data.inventory.frequencyLabel.toLowerCase()}`
        : `Aucun inventaire validé · ${data.inventory.frequencyLabel.toLowerCase()}`,
    });
  }
  if (data.purchasing?.overdueCount) {
    todos.push({ key: 'po', to: '/purchasing', icon: 'truck', tone: 'blue', title: `${data.purchasing.overdueCount} réception(s) fournisseur en retard` });
  }
  if (data.sales?.overdueCount) {
    todos.push({ key: 'so', to: '/sales', icon: 'trending', tone: 'green', title: `${data.sales.overdueCount} commande(s) client en retard` });
  }
  return todos;
}

// Phone home screen — Scan is the primary on-the-floor action, so it gets
// the hero slot; every module sits one tap away below it.
function MobileHome() {
  const { me, logout } = useAuth();
  const navigate = useNavigate();
  const { data, loading } = useOverview();
  const [showPartners, setShowPartners] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  if (!me) return null;
  const has = entitledModuleKeys(me.entitlements);

  return (
    <div className="mobile-home">
      <MobileHeader
        right={
          <button className="shell-icon-btn" onClick={() => logout()} aria-label="Se déconnecter">
            <Icon name="logout" size={19} />
          </button>
        }
      />

      <div>
        <div className="dash-date">{greeting()}</div>
        <h2 className="mobile-home-title">{me.organization.name.replace(/\s*\(.*?\)\s*/g, '')}</h2>
      </div>

      {has.has('scan') && (
        <button className="mobile-scan-hero" onClick={() => navigate('/scan')}>
          <span className="mobile-scan-hero-icon">
            <Icon name="scan" size={26} />
          </span>
          <span className="mobile-scan-hero-text">
            <span className="mobile-scan-hero-title">Scanner un article</span>
            <span className="mobile-scan-hero-sub">Vente rapide, réception, étiquettes</span>
          </span>
          <Icon name="arrowRight" size={20} />
        </button>
      )}

      {(has.has('stock') || has.has('invoicing')) && (
        <div className="mobile-kpis">
          {has.has('stock') && (
            <Link to="/stock" className="mobile-kpi">
              <span className="mobile-kpi-label">En rupture</span>
              {loading ? <span className="dash-skeleton" /> : <span className="mobile-kpi-value bad">{data?.stockOut.length ?? 0}</span>}
            </Link>
          )}
          {has.has('stock') && (
            <Link to="/stock" className="mobile-kpi">
              <span className="mobile-kpi-label">Seuil bas</span>
              {loading ? <span className="dash-skeleton" /> : <span className="mobile-kpi-value warn">{data?.stockLow.length ?? 0}</span>}
            </Link>
          )}
          {has.has('invoicing') && (
            <Link to="/invoicing" className="mobile-kpi wide">
              <span className="mobile-kpi-label">Solde impayé</span>
              {loading ? <span className="dash-skeleton" /> : <span className="mobile-kpi-value">{data?.unpaidBalance != null ? formatDzd(data.unpaidBalance) : '—'}</span>}
            </Link>
          )}
        </div>
      )}

      <ModuleTiles has={has} />

      {has.has('invoicing') && (
        <div className="mobile-section">
          <div className="mobile-section-label">Gestion</div>
          <div className="mobile-list">
            <button className="mobile-list-item" onClick={() => setShowPartners(true)}>
              <span className="mod-chip sm tone-slate">
                <Icon name="users" size={16} />
              </span>
              <span className="mobile-list-text">Fournisseurs & clients</span>
              <Icon name="chevronRight" size={16} />
            </button>
            <button className="mobile-list-item" onClick={() => setShowSettings(true)}>
              <span className="mod-chip sm tone-slate">
                <Icon name="settings" size={16} />
              </span>
              <span className="mobile-list-text">Paramètres du business</span>
              <Icon name="chevronRight" size={16} />
            </button>
          </div>
        </div>
      )}
      {showPartners && <PartnersModal onClose={() => setShowPartners(false)} />}
      {showSettings && <OrganizationSettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  );
}

export default DashboardPage;
