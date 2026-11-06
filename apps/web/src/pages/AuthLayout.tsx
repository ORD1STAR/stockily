import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { BrandMark } from '../lib/AppShell';
import { Icon, IconName } from '../lib/Icon';
import './auth-pages.css';

const HIGHLIGHTS: { icon: IconName; title: string; text: string }[] = [
  { icon: 'package', title: 'Stock en temps réel', text: 'Multi-sites, seuils et alertes de rupture.' },
  { icon: 'receipt', title: 'Factures conformes', text: 'Décret 05-468, TVA, montants en lettres FR/AR.' },
  { icon: 'scan', title: 'Scan sur mobile', text: 'Vente et réception rapides depuis le téléphone.' },
];

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="auth-shell">
      <aside className="auth-aside">
        <div className="auth-aside-brand">
          <BrandMark size={32} />
          <span className="auth-aside-wordmark">
            Stock<span className="ily">ily</span>
          </span>
        </div>
        <div className="auth-aside-body">
          <h1>Votre stock, vos ventes et vos factures, au même endroit.</h1>
          <ul className="auth-highlights">
            {HIGHLIGHTS.map((h) => (
              <li key={h.title}>
                <span className="auth-highlight-icon">
                  <Icon name={h.icon} size={18} />
                </span>
                <span>
                  <strong>{h.title}</strong>
                  <span>{h.text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="auth-aside-foot">Conçu pour les commerces et grossistes en Algérie.</div>
      </aside>

      <main className="auth-main">
        <Link to="/" className="auth-back">
          <Icon name="chevronLeft" size={16} /> Retour au site
        </Link>
        <div className="auth-card">
          <div className="auth-mobile-brand">
            <BrandMark size={34} />
          </div>
          <div className="auth-head">
            <h2>{title}</h2>
            {subtitle && <p className="auth-subtitle">{subtitle}</p>}
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
