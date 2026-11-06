import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth-context';
import { Icon, IconName } from '../lib/Icon';
import { SiteLayout } from './SiteLayout';

const VALUES: { icon: IconName; title: string; text: string }[] = [
  { icon: 'sparkles', title: 'La simplicité d’abord', text: 'Un écran doit se comprendre sans formation. Chaque fonction est pensée pour le comptoir, l’entrepôt et le bureau.' },
  { icon: 'receipt', title: 'Conforme à la réglementation', text: 'Factures au Décret exécutif 05-468, TVA, droit de timbre, montants en dinars : la conformité est intégrée, pas en option.' },
  { icon: 'shield', title: 'Vos données protégées', text: 'Chaque entreprise est cloisonnée au niveau de la base de données, les accès sont contrôlés par module et par dépôt, et les opérations sensibles sont journalisées.' },
  { icon: 'handshake', title: 'Un prix juste et lisible', text: 'Vous payez module par module, sans frais cachés. Un pack coûte exactement la somme de ses modules, et le premier site est gratuit à vie.' },
];

const TIMELINE: { title: string; text: string }[] = [
  { title: 'Le constat', text: 'Beaucoup de commerces jonglent entre un cahier, un tableur et un logiciel de facturation qui ne se parlent pas. Résultat : des ruptures, des erreurs et des heures perdues.' },
  { title: 'Le pari', text: 'Une seule application, modulaire, où une vente au comptoir met à jour en même temps le stock, la caisse, la facture et les statistiques.' },
  { title: 'Aujourd’hui', text: 'Stock, qualité, scan, ventes, achats, factures, caisse, multi-sites et statistiques. En ligne, sur mobile et sur PC, même hors connexion.' },
];

export function AboutPage() {
  const { me } = useAuth();
  return (
    <SiteLayout className="site-about">
      <section className="page-hero">
        <div className="site-container page-hero-inner">
          <span className="section-eyebrow">Qui sommes-nous</span>
          <h1>Un logiciel de gestion fait pour le commerce algérien.</h1>
          <p>
            Stockily est conçu et développé par <b>Ordi-Tech</b>. Notre objectif : donner aux commerçants, distributeurs et grossistes algériens un outil simple, moderne et conforme, pour qu’ils passent moins de temps sur la paperasse et plus de temps à vendre.
          </p>
        </div>
      </section>

      <section className="section">
        <div className="site-container about-grid">
          <div className="about-story">
            <h2>Notre histoire</h2>
            <ol className="timeline">
              {TIMELINE.map((t) => (
                <li key={t.title}>
                  <span className="timeline-dot" />
                  <div>
                    <h3>{t.title}</h3>
                    <p>{t.text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <aside className="about-card">
            <h3>Stockily en bref</h3>
            <dl>
              <div>
                <dt>Pour qui</dt>
                <dd>Commerces de détail, supérettes, distributeurs et grossistes</dd>
              </div>
              <div>
                <dt>Où</dt>
                <dd>Navigateur, téléphone et application PC hors ligne</dd>
              </div>
              <div>
                <dt>Modules</dt>
                <dd>9 modules à la carte, en packs ou un par un</dd>
              </div>
              <div>
                <dt>Monnaie</dt>
                <dd>Dinar algérien (DZD), factures conformes 05-468</dd>
              </div>
              <div>
                <dt>Essai</dt>
                <dd>15 jours gratuits, sans carte bancaire</dd>
              </div>
            </dl>
          </aside>
        </div>
      </section>

      <section className="section section-alt" id="valeurs">
        <div className="site-container">
          <div className="section-head">
            <span className="section-eyebrow">Nos engagements</span>
            <h2>Ce qui guide chacune de nos décisions</h2>
          </div>
          <div className="values">
            {VALUES.map((v) => (
              <article key={v.title} className="value">
                <span className="value-icon">
                  <Icon name={v.icon} size={22} />
                </span>
                <h3>{v.title}</h3>
                <p>{v.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="cta-band">
        <div className="site-container cta-inner">
          <div>
            <h2>Envie de voir Stockily dans votre commerce ?</h2>
            <p>15 jours gratuits, puis vous gardez seulement les modules qui vous servent.</p>
          </div>
          <div className="cta-actions">
            {me ? (
              <Link to="/tarifs" className="site-btn site-btn-white site-btn-lg">
                Voir les packs <Icon name="arrowRight" size={18} />
              </Link>
            ) : (
              <>
                <Link to="/signup" className="site-btn site-btn-white site-btn-lg">
                  Essayer gratuitement
                </Link>
                <Link to="/tarifs" className="site-btn site-btn-outline-white site-btn-lg">
                  Voir les tarifs
                </Link>
              </>
            )}
          </div>
        </div>
      </section>
    </SiteLayout>
  );
}

export default AboutPage;
