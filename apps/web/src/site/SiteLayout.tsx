import { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { BrandMark } from '../lib/AppShell';
import { useAuth } from '../lib/auth-context';
import { Icon } from '../lib/Icon';
import { SuggestionModal } from './SuggestionModal';
import './site.css';

/** Lets any page of the public site open the "Proposer des ajouts" form. */
const SuggestContext = createContext<() => void>(() => undefined);
export const useSuggest = () => useContext(SuggestContext);

const NAV = [
  { to: '/', label: 'Accueil', end: true },
  { to: '/a-propos', label: 'Qui sommes-nous' },
  { to: '/tarifs', label: 'Tarifs' },
  { to: '/telecharger', label: 'Télécharger' },
];

export function Wordmark({ size = 30 }: { size?: number }) {
  return (
    <Link to="/" className="site-brand" aria-label="Stockily, accueil">
      <BrandMark size={size} />
      <span className="site-wordmark">
        Stock<span className="ily">ily</span>
      </span>
    </Link>
  );
}

/**
 * Account actions in the header. Logged out: "Se connecter" + "Créer un
 * compte". Logged in: the two destinations, each with a one-line caption so
 * where it leads is unambiguous — the Espace client (subscription,
 * invoices, account) vs Mon Business (the actual application).
 */
export function HeaderActions({ stacked = false }: { stacked?: boolean }) {
  const { me, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="site-actions-placeholder" aria-hidden />;
  if (!me) {
    const next = location.pathname === '/tarifs' ? '?next=/tarifs' : '';
    return (
      <div className={`site-actions${stacked ? ' is-stacked' : ''}`}>
        <Link to={`/login${next}`} className="site-btn site-btn-ghost">
          Se connecter
        </Link>
        <Link to={`/signup${next}`} className="site-btn site-btn-primary">
          Créer un compte <span className="site-btn-tag">15 j gratuits</span>
        </Link>
      </div>
    );
  }
  const onAccount = location.pathname.startsWith('/compte');
  return (
    <div className={`site-actions${stacked ? ' is-stacked' : ''}`}>
      <Link to="/compte" className={`site-dest site-dest-account${onAccount ? ' is-current' : ''}`} title="Abonnement, modules, factures et paramètres du compte">
        <span className="site-dest-icon">
          <Icon name="building" size={17} />
        </span>
        <span className="site-dest-text">
          <b>Espace client</b>
          <small>Abonnement & compte</small>
        </span>
      </Link>
      <Link to="/dashboard" className="site-dest site-dest-app" title="Ouvrir l’application Stockily (stock, ventes, factures…)">
        <span className="site-dest-icon">
          <Icon name="grid" size={17} />
        </span>
        <span className="site-dest-text">
          <b>Mon Business</b>
          <small>Ouvrir l’application</small>
        </span>
        <Icon name="arrowRight" size={16} className="site-dest-arrow" />
      </Link>
    </div>
  );
}

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname, location.search]);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <header className={`site-header${scrolled ? ' is-scrolled' : ''}${open ? ' is-open' : ''}`}>
      <div className="site-container site-header-inner">
        <Wordmark />
        <nav className="site-nav" aria-label="Navigation du site">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `site-nav-link${isActive ? ' is-active' : ''}`}>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="site-header-actions">
          <HeaderActions />
        </div>
        <button type="button" className="site-burger" onClick={() => setOpen((o) => !o)} aria-label={open ? 'Fermer le menu' : 'Ouvrir le menu'} aria-expanded={open}>
          <Icon name={open ? 'x' : 'menu'} size={22} />
        </button>
      </div>
      {open && (
        <div className="site-mobile-panel">
          <nav className="site-mobile-nav" aria-label="Navigation du site">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `site-mobile-link${isActive ? ' is-active' : ''}`}>
                {n.label}
                <Icon name="chevronRight" size={18} />
              </NavLink>
            ))}
          </nav>
          <HeaderActions stacked />
        </div>
      )}
    </header>
  );
}

export function SiteFooter() {
  const { me } = useAuth();
  const suggest = useSuggest();
  const year = new Date().getFullYear();
  return (
    <footer className="site-footer">
      <div className="site-container site-footer-inner">
        <div className="site-footer-brand">
          <Wordmark size={28} />
          <p>Stock, ventes, achats et factures conformes dans une seule application, pensée pour les commerces et grossistes en Algérie.</p>
        </div>
        <div className="site-footer-cols">
          <div>
            <h4>Produit</h4>
            <Link to="/#fonctionnalites">Fonctionnalités</Link>
            <Link to="/tarifs">Tarifs & packs</Link>
            <Link to="/telecharger">Application Windows et Linux</Link>
            {!me && <Link to="/signup">Essai gratuit</Link>}
            <button type="button" className="site-footer-link" onClick={suggest}>
              Proposer des ajouts
            </button>
          </div>
          <div>
            <h4>Société</h4>
            <Link to="/a-propos">Qui sommes-nous</Link>
            <Link to="/a-propos#valeurs">Nos engagements</Link>
          </div>
          <div>
            <h4>Compte</h4>
            <Link to="/login">Se connecter</Link>
            <Link to="/compte">Espace client</Link>
            <Link to="/dashboard">Mon Business</Link>
          </div>
        </div>
      </div>
      <div className="site-container site-footer-bottom">
        <span>© {year} Stockily · Ordi-Tech</span>
        <span>Prix en dinars algériens (DZD) · Factures conformes au Décret exécutif 05-468</span>
      </div>
    </footer>
  );
}

export function SiteLayout({ children, className }: { children: ReactNode; className?: string }) {
  const location = useLocation();
  const [suggestOpen, setSuggestOpen] = useState(false);
  // Anchor links (/#fonctionnalites) scroll to their section; plain page
  // changes start at the top.
  useEffect(() => {
    if (location.hash) {
      const el = document.getElementById(location.hash.slice(1));
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
    }
    window.scrollTo({ top: 0 });
  }, [location.pathname, location.hash]);
  return (
    <SuggestContext.Provider value={() => setSuggestOpen(true)}>
      <div className={`site${className ? ` ${className}` : ''}`}>
        <SiteHeader />
        <main className="site-main">{children}</main>
        <SiteFooter />
        {suggestOpen && <SuggestionModal onClose={() => setSuggestOpen(false)} />}
      </div>
    </SuggestContext.Provider>
  );
}
