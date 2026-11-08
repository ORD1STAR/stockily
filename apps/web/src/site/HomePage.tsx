import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { billingApi, Catalog } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { formatDzd, ModuleChip } from '../lib/billing';
import { Icon, IconName } from '../lib/Icon';
import { SiteLayout, useSuggest } from './SiteLayout';

const FEATURES: { key: string; title: string; text: string }[] = [
  { key: 'stock', title: 'Un stock toujours juste', text: 'Vos quantités se mettent à jour à chaque entrée et chaque vente.' },
  { key: 'scan', title: 'Vendez en un scan', text: 'Téléphone ou douchette, caisse et ticket Z inclus.' },
  { key: 'invoicing', title: 'Des factures conformes', text: 'Décret 05-468, TVA et timbre : tout est prévu.' },
  { key: 'sales', title: 'Du devis à la facture', text: 'Devis, commande, livraison et facture en quelques clics.' },
  { key: 'quality', title: 'Zéro périmé oublié', text: 'Lots, alertes de péremption et quarantaine.' },
  { key: 'stats', title: 'Décidez avec des chiffres', text: 'Marges, meilleurs produits, créances et dettes.' },
];

export function HomePage() {
  const { me } = useAuth();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  useEffect(() => {
    billingApi.catalog().then(setCatalog).catch(() => setCatalog(null));
  }, []);

  return (
    <SiteLayout className="site-home">
      {/* ───────── Hero ───────── */}
      <section className="hero">
        <div className="hero-bg" aria-hidden>
          <span className="hero-glow g1" />
          <span className="hero-glow g2" />
          <span className="hero-grid" />
        </div>
        <div className="site-container hero-inner">
          <div className="hero-copy">
            <span className="hero-eyebrow">
              <span className="dot" /> Gestion de stock et facturation · Algérie
            </span>
            <h1>
              Votre commerce, <span className="hero-accent">sous contrôle.</span>
            </h1>
            <p className="hero-lead">Stock, ventes, caisse et factures. Sur ordinateur, sur téléphone, même sans internet.</p>
            <div className="hero-ctas">
              {me ? (
                <>
                  <Link to="/dashboard" className="site-btn site-btn-primary site-btn-lg">
                    Ouvrir Mon Business <Icon name="arrowRight" size={18} />
                  </Link>
                  <Link to="/compte" className="site-btn site-btn-light site-btn-lg">
                    Mon espace client
                  </Link>
                </>
              ) : (
                <>
                  <Link to="/signup" className="site-btn site-btn-primary site-btn-lg">
                    Essayer gratuitement <Icon name="arrowRight" size={18} />
                  </Link>
                  <Link to="/tarifs" className="site-btn site-btn-light site-btn-lg">
                    Voir les tarifs
                  </Link>
                </>
              )}
            </div>
            {!me && (
              <ul className="hero-proof">
                <li>
                  <Icon name="check" size={16} /> 15 jours offerts aux nouveaux comptes
                </li>
                <li>
                  <Icon name="check" size={16} /> Sans carte bancaire
                </li>
              </ul>
            )}
          </div>
          <HeroMockup />
        </div>
      </section>

      {/* ───────── Features ───────── */}
      <section className="section" id="fonctionnalites">
        <div className="site-container">
          <div className="section-head">
            <span className="section-eyebrow">Fonctionnalités</span>
            <h2>Tout pour faire tourner votre commerce</h2>
          </div>
          <div className="features">
            {FEATURES.map((f) => (
              <article key={f.key} className="feature">
                <ModuleChip moduleKey={f.key} size={20} />
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ───────── Split highlights ───────── */}
      <section className="section section-alt">
        <div className="site-container split">
          <div className="split-copy">
            <span className="section-eyebrow">Au comptoir et en entrepôt</span>
            <h2>Un scan, et c’est vendu</h2>
            <p>Avec l’appareil photo du téléphone ou une douchette. Le stock se met à jour sur tous vos postes.</p>
            <ul className="checks">
              <li>
                <Icon name="check" size={16} /> Étiquettes codes-barres prêtes à imprimer
              </li>
              <li>
                <Icon name="check" size={16} /> Caisse et ticket Z
              </li>
            </ul>
          </div>
          <div className="phone-mock" aria-hidden>
            <div className="phone-wrap">
              <div className="scanner-chip">
                <span className="mod-chip sm tone-teal">
                  <Icon name="scan" size={14} />
                </span>
                <div>
                  <b>Douchette USB ou Bluetooth</b>
                  <span>Branchée, prête à scanner</span>
                </div>
              </div>
              <div className="phone">
                <div className="phone-notch" />
                <div className="phone-screen">
                  <div className="phone-scan">
                    <span className="phone-scan-line" />
                    <span className="corner tl" />
                    <span className="corner tr" />
                    <span className="corner bl" />
                    <span className="corner br" />
                  </div>
                  <div className="phone-card">
                    <b>Huile de table 5 L</b>
                    <span>Stock : 42 · Dépôt Central</span>
                    <div className="phone-card-row">
                      <span>1 450 DZD</span>
                      <span className="phone-pill">Ajouter</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="site-container split split-reverse">
          <div className="split-copy">
            <span className="section-eyebrow">Même sans internet</span>
            <h2>Internet coupe ? Vous continuez de vendre.</h2>
            <p>L’application PC fonctionne hors ligne et se synchronise dès que la connexion revient.</p>
            <Link to="/telecharger" className="site-btn site-btn-light">
              <Icon name="download" size={16} /> Télécharger l’application
            </Link>
          </div>
          <div className="sync-mock" aria-hidden>
            <div className="sync-node">
              <Icon name="monitor" size={26} />
              <span>Poste caisse</span>
            </div>
            <div className="sync-link">
              <span />
            </div>
            <div className="sync-node is-cloud">
              <Icon name="refresh" size={26} />
              <span>Stockily en ligne</span>
            </div>
            <div className="sync-link">
              <span />
            </div>
            <div className="sync-node">
              <Icon name="scan" size={26} />
              <span>Téléphone</span>
            </div>
          </div>
        </div>
      </section>

      {/* ───────── Pricing teaser ───────── */}
      <section className="section">
        <div className="site-container">
          <div className="section-head">
            <span className="section-eyebrow">Tarifs</span>
            <h2>Des packs clairs, ou des modules à la carte</h2>
            <p>Le premier site est gratuit à vie.</p>
          </div>
          <div className="teaser-packs">
            {(catalog?.packs ?? []).map((p) => (
              <Link key={p.key} to={`/tarifs#pack-${p.key}`} className={`teaser-pack${p.highlight ? ' is-highlight' : ''}`}>
                {p.highlight && <span className="teaser-ribbon">Recommandé</span>}
                <h3>{p.name}</h3>
                <p>{p.tagline}</p>
                <div className="teaser-price">
                  {formatDzd(p.monthlyPrice)}
                  <small> / mois</small>
                </div>
                <div className="teaser-chips">
                  {p.modules.map((k) => (
                    <ModuleChip key={k} moduleKey={k} size={14} />
                  ))}
                </div>
              </Link>
            ))}
            {!catalog && [0, 1, 2, 3].map((i) => <div key={i} className="teaser-pack is-skeleton" />)}
          </div>
          <div className="center">
            <Link to="/tarifs" className="site-btn site-btn-light">
              Comparer les packs et modules <Icon name="arrowRight" size={16} />
            </Link>
          </div>
        </div>
      </section>

      {/* ───────── Suggestions ───────── */}
      <section className="section section-tight">
        <div className="site-container">
          <SuggestBand />
        </div>
      </section>

      {/* ───────── Final CTA (visitors only: the trial is for new accounts) ───────── */}
      {!me && (
        <section className="cta-band">
          <div className="site-container cta-inner">
            <div>
              <h2>Prêt à essayer ?</h2>
              <p>Nouveau compte : 15 jours d’essai gratuit, sans carte bancaire.</p>
            </div>
            <div className="cta-actions">
              <Link to="/signup" className="site-btn site-btn-white site-btn-lg">
                Créer mon compte
              </Link>
              <Link to="/login" className="site-btn site-btn-outline-white site-btn-lg">
                J’ai déjà un compte
              </Link>
            </div>
          </div>
        </section>
      )}
    </SiteLayout>
  );
}

function SuggestBand() {
  const suggest = useSuggest();
  return (
    <div className="suggest-band">
      <div>
        <h2>Il vous manque une fonction ?</h2>
        <p>Dites-nous ce qui vous ferait gagner du temps.</p>
      </div>
      <button type="button" className="site-btn site-btn-primary site-btn-lg" onClick={suggest}>
        <Icon name="sparkles" size={18} /> Proposer des ajouts
      </button>
    </div>
  );
}

/** Short and clear: what a new account gets, and that buying keeps the trial days. */
export function TrialNote({ loggedIn }: { loggedIn: boolean }) {
  if (loggedIn) return null;
  return (
    <div className="trial-note">
      <Icon name="sparkles" size={18} />
      <span>
        <b>Nouveau compte : 15 jours d’essai gratuit</b> sur Stock, Qualité, Factures et Scan. Vous achetez un module pendant l’essai ? Vos jours restants sont conservés.
      </span>
    </div>
  );
}

/** Product preview drawn in HTML/CSS — crisp at any size, no screenshot to keep in sync. */
function HeroMockup() {
  const bars = [38, 52, 44, 66, 58, 74, 62, 88, 70, 82, 76, 94];
  return (
    <div className="mock" aria-hidden>
      <div className="mock-window">
        <div className="mock-top">
          <span />
          <span />
          <span />
          <div className="mock-url">stockily.ordi-tech.com/dashboard</div>
        </div>
        <div className="mock-body">
          <aside className="mock-side">
            {['home', 'package', 'scan', 'cart', 'trending', 'receipt', 'chart'].map((i, n) => (
              <span key={i} className={n === 0 ? 'is-on' : ''}>
                <Icon name={i as IconName} size={15} />
              </span>
            ))}
          </aside>
          <div className="mock-main">
            <div className="mock-hello">
              <b>Bonjour, Supérette du Centre</b>
              <span>Tableau de bord</span>
            </div>
            <div className="mock-kpis">
              <div>
                <span>Chiffre d’affaires</span>
                <b>1,28 M DZD</b>
                <em className="up">▲ 12 %</em>
              </div>
              <div>
                <span>Commandes clients</span>
                <b>18</b>
                <em>4 devis ouverts</em>
              </div>
              <div>
                <span>Ruptures</span>
                <b className="warn">3</b>
                <em>7 sous le seuil</em>
              </div>
            </div>
            <div className="mock-chart">
              {bars.map((h, i) => (
                <span key={i} style={{ height: `${h}%`, animationDelay: `${i * 40}ms` }} />
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="mock-float f1">
        <span className="mod-chip sm tone-green">
          <Icon name="check" size={14} />
        </span>
        <div>
          <b>Facture FAC-2026-0142</b>
          <span>Payée · 86 400 DZD</span>
        </div>
      </div>
      <div className="mock-float f2">
        <span className="mod-chip sm tone-amber">
          <Icon name="alert" size={14} />
        </span>
        <div>
          <b>Stock bas</b>
          <span>Semoule 25 kg · 6 restants</span>
        </div>
      </div>
    </div>
  );
}

export default HomePage;
