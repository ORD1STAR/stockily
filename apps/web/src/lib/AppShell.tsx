import { ReactNode, useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from './auth-context';
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
  const { me, logout } = useAuth();
  const entitledKeys = entitledModuleKeys(me?.entitlements ?? []);
  const [showSettings, setShowSettings] = useState(false);
  const [showPartners, setShowPartners] = useState(false);
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
  const email = me?.user.email ?? '';
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
                ) : (
                  <div key={m.to} className="shell-nav-item shell-locked" title="Module non activé pour votre organisation">
                    <Icon name={m.icon} />
                    <span>{m.label}</span>
                    <Icon name="lock" size={14} className="shell-lock" />
                  </div>
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
          {canManageBusiness && (
            <>
              <button className="shell-nav-item" onClick={() => { closeSidebar(); setShowPartners(true); }}>
                <Icon name="users" />
                <span>Fournisseurs & clients</span>
              </button>
              <button className="shell-nav-item" onClick={() => { closeSidebar(); setShowSettings(true); }}>
                <Icon name="settings" />
                <span>Paramètres</span>
              </button>
            </>
          )}
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
        <div className="shell-content-inner">{children}</div>
      </main>
      {showSettings && <OrganizationSettingsModal onClose={() => setShowSettings(false)} />}
      {showPartners && <PartnersModal onClose={() => setShowPartners(false)} />}
    </div>
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
