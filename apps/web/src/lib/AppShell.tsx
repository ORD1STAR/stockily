import { ReactNode, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from './auth-context';
import { PHASE1_MODULES } from './modules';
import { OrganizationSettingsModal } from './OrganizationSettingsModal';
import { PartnersModal } from './PartnersModal';
import { useIsMobile } from './useIsMobile';
import './AppShell.css';

// The real sidebar, matching docs/Wireframes.html's pattern: a persistent
// dark sidebar, module list, locked Phase 2/3 modules greyed out. Unlike
// the wireframe (a static mockup), active/inactive here reflects `me`'s
// actual entitlements from GET /me, not a hardcoded demo state.
//
// This is the one AppShell instance every non-Scan page still renders on a
// phone (Stock/Quality/Factures/Sites — Scan and Dashboard already drop
// AppShell entirely for their own dedicated mobile screens, see their own
// header comments). The 232px column was previously unconditional — on a
// 375-430px phone that's over half the viewport, permanently covering the
// actual page. Below the shared MOBILE_BREAKPOINT it now becomes an
// off-canvas drawer: closed by default, opened via a hamburger in a thin
// top bar, closes again on any tap inside it (a link navigating away, or a
// modal-opening button — either way the drawer shouldn't still be covering
// the screen afterwards).
export function AppShell({ children }: { children: ReactNode }) {
  const { me, logout } = useAuth();
  const entitledKeys = new Set((me?.entitlements ?? []).map((e) => e.module));
  const [showSettings, setShowSettings] = useState(false);
  const [showPartners, setShowPartners] = useState(false);
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const closeSidebar = () => setSidebarOpen(false);

  return (
    <div className={`shell${isMobile ? ' shell-mobile' : ''}`}>
      {isMobile && (
        <div className="shell-topbar">
          <button className="shell-hamburger" onClick={() => setSidebarOpen(true)} aria-label="Ouvrir le menu">
            <span />
            <span />
            <span />
          </button>
          <div className="shell-topbar-wordmark">
            Stock<span className="ily">ily</span>
          </div>
        </div>
      )}
      {isMobile && sidebarOpen && <div className="shell-backdrop" onClick={closeSidebar} />}
      <aside
        className={`shell-sidebar${isMobile ? ' shell-sidebar-mobile' : ''}${sidebarOpen ? ' open' : ''}`}
        onClick={() => isMobile && closeSidebar()}
      >
        <div className="shell-wordmark">
          Stock<span className="ily">ily</span>
        </div>
        {/* Mobile-only — the desktop sidebar is already the "main menu",
            nothing to go back to. On a phone this drawer is reached from
            inside a specific module (Stock, Quality…), and since
            "Fournisseurs & clients"/"Paramètres du Business" no longer
            live in this drawer (moved to their own tiles on the
            Applications launcher — see AppsListPage), this is how you get
            back there to reach them, or any other module, without first
            returning to the phone's home screen. */}
        {isMobile && (
          <NavLink to="/apps" className="shell-nav-item shell-back-link">
            ← Toutes les applications
          </NavLink>
        )}
        <div className="shell-group-label">Phase 1</div>
        {PHASE1_MODULES.map((m) => (
          <NavItem key={m.key} to={m.to} label={m.label} enabled={entitledKeys.has(m.key)} />
        ))}
        <div className="shell-group-label">Verrouillés</div>
        <div className="shell-nav-item shell-locked">
          Achats <span className="shell-tag">Phase 2</span>
        </div>
        <div className="shell-nav-item shell-locked">
          CRM <span className="shell-tag">Phase 2</span>
        </div>
        <div className="shell-nav-item shell-locked">
          Comptabilité <span className="shell-tag">Phase 3</span>
        </div>
        <div className="shell-spacer" />
        <NavLink to="/dashboard" className="shell-nav-item shell-settings">
          {me?.organization.name}
        </NavLink>
        {/* Mobile-only redundant here now — AppsListPage (the "Applications"
            launcher reachable from the phone's own home screen) has its own
            dedicated tiles for both, under "Gestion". On desktop this
            drawer never renders (only the persistent sidebar does, still
            with both buttons below), so `!isMobile` only strips them from
            the mobile off-canvas copy. */}
        {entitledKeys.has('invoicing') && !isMobile && (
          <button className="shell-nav-item shell-settings" onClick={() => setShowSettings(true)}>
            ⚙ Paramètres du Business
          </button>
        )}
        {entitledKeys.has('invoicing') && !isMobile && (
          <button className="shell-nav-item shell-settings" onClick={() => setShowPartners(true)}>
            👥 Fournisseurs & clients
          </button>
        )}
        <button className="shell-nav-item shell-settings shell-logout" onClick={() => logout()}>
          Se déconnecter
        </button>
      </aside>
      <main className="shell-content">{children}</main>
      {showSettings && <OrganizationSettingsModal onClose={() => setShowSettings(false)} />}
      {showPartners && <PartnersModal onClose={() => setShowPartners(false)} />}
    </div>
  );
}

function NavItem({ to, label, enabled, tag }: { to: string; label: string; enabled: boolean; tag?: string }) {
  if (!enabled) {
    return (
      <div className="shell-nav-item shell-locked" title={tag ? `Pas encore construit (${tag})` : "Module non activé pour votre organisation"}>
        {label} {tag && <span className="shell-tag">{tag}</span>}
      </div>
    );
  }
  return (
    <NavLink to={to} className={({ isActive }) => 'shell-nav-item' + (isActive ? ' active' : '')}>
      {label}
    </NavLink>
  );
}
