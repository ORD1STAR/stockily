import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { billingApi, Catalog } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { formatDzd, ModuleChip } from '../lib/billing';
import { Icon, IconName } from '../lib/Icon';
import { SiteLayout, useSuggest } from './SiteLayout';

const FEATURES: { key: string; title: string; text: string }[] = [
  { key: 'stock', title: 'Un stock toujours juste', text: 'Chaque entrée et chaque vente met vos quantités à jour. Vous êtes alerté avant la rupture, et vos inventaires se font en quelques minutes.' },
  { key: 'scan', title: 'Vendez en un scan', text: 'Téléphone ou douchette : scannez, encaissez, imprimez vos étiquettes. En fin de journée, le ticket Z tombe juste.' },
  { key: 'invoicing', title: 'Des factures sans stress', text: 'Mentions du Décret 05-468, TVA, timbre et montant en lettres. Vous savez toujours qui vous doit quoi.' },
  { key: 'sales', title: 'Du devis à la facture en quelques clics', text: 'Le devis devient commande, la commande devient bon de livraison puis facture. Le stock est réservé automatiquement.' },
  { key: 'purchasing', title: 'Achetez au meilleur prix', text: 'Comparez les offres de vos fournisseurs, suivez vos commandes et réceptionnez la marchandise sans erreur.' },
  { key: 'quality', title: 'Zéro périmé oublié', text: 'Suivez vos lots, recevez les alertes de péremption et isolez en quarantaine ce qui ne doit pas être vendu.' },
  { key: 'cash', title: 'Une caisse qui tombe juste', text: 'Encaissements et décaissements rattachés à vos factures. Vous savez à tout moment ce qu’il y a en caisse.' },
  { key: 'sites', title: 'Grandissez sans changer d’outil', text: 'Le premier site est gratuit à vie, puis 1 500 DZD par mois et par site en plus. Transferts entre dépôts et vue consolidée.' },
  { key: 'stats', title: 'Décidez avec des chiffres', text: 'Marges, meilleurs produits et clients, créances et dettes. Fini le tableur du dimanche soir.' },
];

const STEPS: { icon: IconName; title: string; text: string }[] = [
  { icon: 'sparkles', title: 'Créez votre compte', text: 'Deux minutes, sans carte bancaire. 15 jours d’essai gratuit sur les modules essentiels.' },
  { icon: 'package', title: 'Ajoutez votre activité', text: 'Produits, dépôts, clients et fournisseurs. Ou scannez simplement vos articles pour les créer.' },
  { icon: 'trending', title: 'Pilotez au quotidien', text: 'Vendez, achetez, facturez : le stock et les soldes se mettent à jour tout seuls.' },
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
              Plus de ruptures surprises, plus d’impayés oubliés. <span className="hero-accent">Votre commerce sous contrôle.</span>
            </h1>
            <p className="hero-lead">
              Stockily suit votre stock, vos ventes, vos achats et votre caisse en temps réel, et édite des factures conformes au Décret 05-468. Sur ordinateur, sur téléphone, et même sans internet.
            </p>
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
                    Essayer gratuitement 15 jours <Icon name="arrowRight" size={18} />
                  </Link>
                  <Link to="/tarifs" className="site-btn site-btn-light site-btn-lg">
                    Voir les tarifs
                  </Link>
                </>
              )}
            </div>
            <ul className="hero-proof">
              <li>
                <Icon name="check" size={16} /> 15 jours d’essai offerts
              </li>
              <li>
                <Icon name="check" size={16} /> Sans carte bancaire
              </li>
              <li>
                <Icon name="check" size={16} /> Prix clairs, en dinars
              </li>
            </ul>
          </div>
          <HeroMockup />
        </div>
      </section>

      {/* ───────── Proof strip ───────── */}
      <section className="strip">
        <div className="site-container strip-inner">
          <div>
            <b>9 modules</b>
            <span>à la carte, sans forfait imposé</span>
          </div>
          <div>
            <b>Décret 05-468</b>
            <span>factures conformes</span>
          </div>
          <div>
            <b>Web, mobile et PC</b>
            <span>même hors connexion</span>
          </div>
          <div>
            <b>1er site gratuit</b>
            <span>à vie</span>
          </div>
        </div>
      </section>

      {/* ───────── Features ───────── */}
      <section className="section" id="fonctionnalites">
        <div className="site-container">
          <div className="section-head">
            <span className="section-eyebrow">Fonctionnalités</span>
            <h2>Tout ce qu’il faut pour faire tourner votre commerce</h2>
            <p>Commencez avec ce dont vous avez besoin aujourd’hui. Ajoutez un module quand votre activité grandit, sans rien ressaisir.</p>
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
            <p>Utilisez l’appareil photo de votre téléphone, ou branchez une douchette (le lecteur de codes-barres USB ou Bluetooth). Vente, réception de marchandise, vérification d’un prix : tout se fait en un scan, et le stock se met à jour sur tous vos postes.</p>
            <ul className="checks">
              <li>
                <Icon name="check" size={16} /> Téléphone ou douchette, au choix
              </li>
              <li>
                <Icon name="check" size={16} /> Étiquettes codes-barres et QR prêtes à imprimer
              </li>
              <li>
                <Icon name="check" size={16} /> Comptoirs, sessions de caisse et ticket Z
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
            <p>L’application PC garde vos postes opérationnels hors ligne et se synchronise dès que la connexion revient. Vos données sont sauvegardées en ligne.</p>
            <ul className="checks">
              <li>
                <Icon name="check" size={16} /> Synchronisation automatique et sécurisée
              </li>
              <li>
                <Icon name="check" size={16} /> Accès à distance depuis n’importe quel navigateur
              </li>
              <li>
                <Icon name="check" size={16} /> Utilisateurs et droits par module et par dépôt
              </li>
            </ul>
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

      {/* ───────── Steps ───────── */}
      <section className="section">
        <div className="site-container">
          <div className="section-head">
            <span className="section-eyebrow">Démarrage</span>
            <h2>Prêt à vendre en une après-midi</h2>
          </div>
          <ol className="steps">
            {STEPS.map((s, i) => (
              <li key={s.title} className="step">
                <span className="step-n">{i + 1}</span>
                <span className="step-icon">
                  <Icon name={s.icon} size={22} />
                </span>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ───────── Pricing teaser ───────── */}
      <section className="section section-alt">
        <div className="site-container">
          <div className="section-head">
            <span className="section-eyebrow">Tarifs</span>
            <h2>Des packs clairs, ou des modules à la carte</h2>
            <p>Un pack coûte exactement la somme de ses modules. Vous ne payez que ce que vous utilisez.</p>
          </div>
          <TrialNote loggedIn={!!me} />
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

      {/* ───────── Final CTA ───────── */}
      <section className="cta-band">
        <div className="site-container cta-inner">
          <div>
            <h2>Prêt à reprendre la main sur votre commerce ?</h2>
            <p>Créez votre compte en deux minutes. 15 jours gratuits, sans carte bancaire, sans engagement.</p>
          </div>
          <div className="cta-actions">
            {me ? (
              <Link to="/dashboard" className="site-btn site-btn-white site-btn-lg">
                Ouvrir Mon Business <Icon name="arrowRight" size={18} />
              </Link>
            ) : (
              <>
                <Link to="/signup" className="site-btn site-btn-white site-btn-lg">
                  Essayer gratuitement
                </Link>
                <Link to="/login" className="site-btn site-btn-outline-white site-btn-lg">
                  J’ai déjà un compte
                </Link>
              </>
            )}
          </div>
        </div>
      </section>
    </SiteLayout>
  );
}

function SuggestBand() {
  const suggest = useSuggest();
  return (
    <div className="suggest-band">
      <div>
        <h2>Il vous manque une fonction ?</h2>
        <p>Dites-nous ce qui vous ferait gagner du temps. Chaque proposition est lue, et les plus utiles passent en priorité.</p>
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
