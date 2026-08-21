import { ReactNode, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from './auth-context';
import { OrganizationSettingsModal } from './OrganizationSettingsModal';
import './AppShell.css';

// The real sidebar, matching docs/Wireframes.html's pattern: a persistent
// dark sidebar, module list, locked Phase 2/3 modules greyed out. Unlike
// the wireframe (a static mockup), active/inactive here reflects `me`'s
// actual entitlements from GET /me, not a hardcoded demo state.
export function AppShell({ children }: { children: ReactNode }) {
  const { me, logout } = useAuth();
  const entitledKeys = new Set((me?.entitlements ?? []).map((e) => e.module));
  const [showSettings, setShowSettings] = useState(false);

  return (
    <div className="shell">
      <aside className="shell-sidebar">
        <div className="shell-wordmark">
          Stock<span className="ily">ily</span>
        </div>
        <div className="shell-group-label">Phase 1</div>
        <NavItem to="/stock" label="Gestion de Stock" enabled={entitledKeys.has('stock')} />
        <NavItem to="/quality" label="Qualité" enabled={entitledKeys.has('quality')} />
        <NavItem to="/invoicing" label="Factures" enabled={entitledKeys.has('invoicing')} />
        <NavItem to="/sites" label="Transferts Multi-Sites" enabled={entitledKeys.has('sites')} />
        <NavItem to="/scan" label="Scan / QR" enabled={entitledKeys.has('scan')} />
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
        {entitledKeys.has('invoicing') && (
          <button className="shell-nav-item shell-settings" onClick={() => setShowSettings(true)}>
            ⚙ Paramètres du Business
          </button>
        )}
        <button className="shell-nav-item shell-settings shell-logout" onClick={() => logout()}>
          Se déconnecter
        </button>
      </aside>
      <main className="shell-content">{children}</main>
      {showSettings && <OrganizationSettingsModal onClose={() => setShowSettings(false)} />}
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
