import { UpdateRow } from './UpdateRow';
import { ReactNode, useEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from './auth-context';
import { LocalStatus } from './api';
import { useDesktopStatus } from './desktop';
import { PurchaseModal } from './billing';
import { Icon } from './Icon';
import { entitledModuleKeys, MODULE_GROUP_LABEL, ModuleGroup, PRODUCT_MODULES, UPCOMING_MODULES } from './modules';
import { OrganizationSettingsModal } from './OrganizationSettingsModal';
import { PartnersModal } from './PartnersModal';
import { useIsMobile } from './useIsMobile';
import './AppShell.css';

// Persistent sidebar on desktop; below the shared MOBILE_BREAKPOINT it
// becomes an off-canvas drawer opened from a slim top bar (a permanent
// column would cover over half of a phone screen). Active/locked state
// reflects `me`'s real entitlements from GET /me.
export function AppShell({ children }: { children: ReactNode }) {
  const { me, logout, refreshMe } = useAuth();
  const entitledKeys = entitledModuleKeys(me?.entitlements ?? [], me?.permissions ?? []);
  const [showSettings, setShowSettings] = useState(false);
  const [showPartners, setShowPartners] = useState(false);
  const [buying, setBuying] = useState<string | null>(null);
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const closeSidebar = () => setSidebarOpen(false);

  // Close the drawer on navigation and lock body scroll while it's open.
  useEffect(() => setSidebarOpen(false), [location.pathname]);
  useEffect(() => {
    if (!isMobile) return;
    document.body.style.overflow = sidebarOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [sidebarOpen, isMobile]);

  const groups = (['operations', 'commerce', 'control'] as ModuleGroup[]).map((g) => ({
    key: g,
    label: MODULE_GROUP_LABEL[g],
    items: PRODUCT_MODULES.filter((m) => m.group === g),
  }));
  const canManageBusiness = entitledKeys.has('invoicing');
  const canSeeBusiness = entitledModuleKeys(me?.entitlements ?? []).has('invoicing') && !!me?.permissions?.includes('invoicing.profile.read');
  const canManageDevices = !!me?.roles.some((r) => r.role === 'Super Admin' || r.role === 'Gestionnaire');
  const canManageMembers = !!me?.permissions?.includes('members.user.manage');
  const orgEntitled = entitledModuleKeys(me?.entitlements ?? []);
  const desktop = useDesktopStatus();
  // Desktop app: when the signed license gains (or loses) a module, e.g. one just bought online,
  // reload the profile so the menus follow without a restart.
  const licensedModules = desktop?.modules?.join(',');
  const seenModules = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (licensedModules === undefined) return;
    if (seenModules.current !== undefined && seenModules.current !== licensedModules) void refreshMe().catch(() => undefined);
    seenModules.current = licensedModules;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [licensedModules]);
  // Sub-users may have a username instead of an email.
  const email = me?.user.email ?? (me?.user.username ? `@${me.user.username}` : '');
  const orgName = me?.organization.name ?? '';

  return (
    <div className={`shell${isMobile ? ' shell-mobile' : ''}`}>
      {isMobile && (
        <header className="shell-topbar">
          <button className="shell-icon-btn" onClick={() => setSidebarOpen(true)} aria-label="Ouvrir le menu">
            <Icon name="menu" size={20} />
          </button>
          <NavLink to="/dashboard" className="shell-brand">
            <BrandMark />
            <span className="shell-wordmark-text">
              Stock<span className="ily">ily</span>
            </span>
          </NavLink>
          <div className="shell-topbar-spacer" />
          <span className="shell-avatar sm" title={orgName}>
            {initials(orgName)}
          </span>
        </header>
      )}
      {isMobile && <div className={`shell-backdrop${sidebarOpen ? ' open' : ''}`} onClick={closeSidebar} />}

      <aside className={`shell-sidebar${isMobile ? ' shell-sidebar-mobile' : ''}${sidebarOpen ? ' open' : ''}`}>
        <div className="shell-sidebar-head">
          <NavLink to="/dashboard" className="shell-brand">
            <BrandMark />
            <span className="shell-wordmark-text">
              Stock<span className="ily">ily</span>
            </span>
          </NavLink>
          {isMobile && (
            <button className="shell-icon-btn" onClick={closeSidebar} aria-label="Fermer le menu">
              <Icon name="x" size={18} />
            </button>
          )}
        </div>

        <nav className="shell-nav" aria-label="Navigation principale">
          <NavLink to="/dashboard" className={({ isActive }) => 'shell-nav-item' + (isActive ? ' active' : '')}>
            <Icon name="home" />
            <span>Accueil</span>
          </NavLink>

          {groups.map((g) => (
            <div className="shell-nav-group" key={g.key}>
              <div className="shell-group-label">{g.label}</div>
              {g.items.map((m) =>
                entitledKeys.has(m.key) ? (
                  <NavLink key={m.to} to={m.to} className={({ isActive }) => 'shell-nav-item' + (isActive ? ' active' : '')}>
                    <Icon name={m.icon} />
                    <span>{m.label}</span>
                  </NavLink>
                ) : !canManageMembers ? null : orgEntitled.has(m.key) ? (
                  <div key={m.to} className="shell-nav-item shell-locked" title="Vous n’avez pas accès à ce module">
                    <Icon name={m.icon} />
                    <span>{m.label}</span>
                    <Icon name="lock" size={14} className="shell-lock" />
                  </div>
                ) : (
                  <button key={m.to} type="button" className="shell-nav-item shell-locked shell-buy" title={`Débloquer ${m.label}`} onClick={() => { closeSidebar(); setBuying(m.key); }}>
                    <Icon name={m.icon} />
                    <span>{m.label}</span>
                    <span className="shell-unlock">
                      <Icon name="lock" size={11} /> Débloquer
                    </span>
                  </button>
                ),
              )}
            </div>
          ))}

          <div className="shell-nav-group">
            <div className="shell-group-label">À venir</div>
            {UPCOMING_MODULES.map((m) => (
              <div key={m.label} className="shell-nav-item shell-locked" title="Pas encore disponible">
                <Icon name={m.icon} />
                <span>{m.label}</span>
                <span className="shell-tag">{m.tag}</span>
              </div>
            ))}
          </div>
        </nav>

        <div className="shell-spacer" />

        <div className="shell-footer">
          {desktop && <SyncIndicator status={desktop} />}
          {!desktop && (
            <NavLink to="/compte" className="shell-nav-item">
              <Icon name="building" />
              <span>Espace client</span>
            </NavLink>
          )}
          {canManageMembers && (
            <NavLink to="/members" className="shell-nav-item">
              <Icon name="users" />
              <span>Utilisateurs</span>
            </NavLink>
          )}
          {canManageDevices && (
            <NavLink to="/devices" className="shell-nav-item">
              <Icon name="monitor" />
              <span>Appareils</span>
            </NavLink>
          )}
          {canManageBusiness && (
            <button className="shell-nav-item" onClick={() => { closeSidebar(); setShowPartners(true); }}>
              <Icon name="users" />
              <span>Fournisseurs & clients</span>
            </button>
          )}
          {canSeeBusiness && (
            <button className="shell-nav-item" onClick={() => { closeSidebar(); setShowSettings(true); }}>
              <Icon name="settings" />
              <span>Paramètres</span>
            </button>
          )}
          {desktop && <UpdateRow onNavigate={closeSidebar} />}
          <div className="shell-account">
            <span className="shell-avatar">{initials(orgName)}</span>
            <div className="shell-account-text">
              <div className="shell-account-org">{orgName}</div>
              <div className="shell-account-email">{email}</div>
            </div>
            <button className="shell-icon-btn" onClick={() => logout()} title="Se déconnecter" aria-label="Se déconnecter">
              <Icon name="logout" size={17} />
            </button>
          </div>
        </div>
      </aside>

      <main className="shell-content">
        {desktop?.readOnly && (
          <div className="shell-readonly-banner" role="alert">
            <Icon name="lock" size={16} />
            <span>
              {desktop.revoked
                ? 'Cet appareil a été désactivé : consultation et impression uniquement. Reconnectez-vous pour le réactiver.'
                : 'Licence expirée (plus de 45 jours sans connexion) : consultation et impression uniquement. Connectez cet ordinateur à internet quelques instants pour la renouveler.'}
            </span>
          </div>
        )}
        <div className="shell-content-inner">{children}</div>
      </main>
      {showSettings && <OrganizationSettingsModal onClose={() => setShowSettings(false)} />}
      {showPartners && <PartnersModal onClose={() => setShowPartners(false)} />}
      {buying && <PurchaseModal initialModules={[buying]} onClose={() => setBuying(null)} />}
    </div>
  );
}

// Desktop app only: one-glance sync state, opens the Synchronisation page.
function SyncIndicator({ status }: { status: LocalStatus }) {
  const state = status.failed > 0 ? 'bad' : !status.online ? 'offline' : status.pending > 0 || status.syncing ? 'busy' : 'ok';
  const text =
    state === 'bad'
      ? `${status.failed} saisie${status.failed > 1 ? 's' : ''} refusée${status.failed > 1 ? 's' : ''}`
      : state === 'offline'
        ? status.pending > 0
          ? `Hors ligne · ${status.pending} en attente`
          : 'Hors ligne'
        : state === 'busy'
          ? 'Synchronisation…'
          : 'Synchronisé';
  return (
    <NavLink to="/sync" className={`shell-nav-item shell-sync shell-sync-${state}`} title="Voir la synchronisation de ce poste">
      <Icon name={status.online ? 'refresh' : 'wifiOff'} />
      <span>{text}</span>
    </NavLink>
  );
}

export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="bm-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7a5cf0" />
          <stop offset="1" stopColor="#4a2fab" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#bm-g)" />
      <path d="M9 12.5 16 9l7 3.5-7 3.5z" fill="#fff" opacity=".95" />
      <path d="M9 16.5l7 3.5 7-3.5" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" opacity=".75" />
      <path d="M9 20.5l7 3.5 7-3.5" fill="none" stroke="#22c5a6" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function initials(name: string): string {
  const words = name
    .replace(/\(.*?\)/g, '')
    .split(/[\s\-—]+/)
    .filter((w) => /[A-Za-zÀ-ÿ]/.test(w));
  return ((words[0]?.[0] ?? '') + (words[1]?.[0] ?? '')).toUpperCase() || 'S';
}
