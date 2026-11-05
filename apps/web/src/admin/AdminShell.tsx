import { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { Icon } from '../lib/Icon';
import { useAdminAuth } from './admin-auth-context';
import './admin.css';

const NAV: { to: string; label: string; icon: Parameters<typeof Icon>[0]['name'] }[] = [
  { to: '/admin', label: 'Tableau de bord', icon: 'grid' },
  { to: '/admin/organizations', label: 'Organisations', icon: 'building' },
  { to: '/admin/pricing', label: 'Tarifs', icon: 'wallet' },
  { to: '/admin/payments', label: 'Paiements', icon: 'receipt' },
  { to: '/admin/logs', label: 'Journaux', icon: 'clock' },
  { to: '/admin/sql', label: 'Console SQL', icon: 'calculator' },
];

export function AdminShell({
  title,
  subtitle,
  actions,
  flush,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** Body with no padding and no scroll — the page fills the space itself (e.g. the SQL console). */
  flush?: boolean;
  children: ReactNode;
}) {
  const { admin, logout } = useAdminAuth();
  return (
    <div className="admin">
      <aside className="admin-sidebar">
        <div className="admin-brand">
          Stockily <span className="tag">ADMIN</span>
        </div>
        <nav className="admin-nav">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/admin'} className={({ isActive }) => (isActive ? 'active' : '')}>
              <Icon name={n.icon} size={16} />
              <span>{n.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="admin-sidebar-foot">
          <div className="admin-foot-email">{admin?.email || 'Administrateur'}</div>
          <button type="button" className="admin-foot-logout" onClick={() => logout()}>
            <Icon name="logout" size={15} /> Se déconnecter
          </button>
        </div>
      </aside>
      <main className="admin-main">
        <header className="admin-page-head">
          <div className="admin-page-titles">
            <h2>{title}</h2>
            {subtitle && <div className="sub">{subtitle}</div>}
          </div>
          {actions && <div className="admin-head-actions">{actions}</div>}
        </header>
        <div className={`admin-page-body${flush ? ' flush' : ''}`}>{children}</div>
      </main>
    </div>
  );
}
