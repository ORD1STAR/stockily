import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth-context';
import { Icon } from '../lib/Icon';
import { TrialNote } from './HomePage';
import { PricingSection } from './PricingSection';
import { SiteLayout } from './SiteLayout';

const FAQ: { q: string; a: string }[] = [
  { q: 'Comment fonctionne l’essai gratuit ?', a: 'Chaque nouveau compte profite de 15 jours gratuits sur Stock, Qualité, Factures et Scan, sans carte bancaire. Si vous achetez un module pendant l’essai, vos jours restants sont conservés : ils s’ajoutent à votre abonnement.' },
  { q: 'Comment fonctionne Multi-sites ?', a: 'Votre premier site est gratuit à vie et sans essai à activer. Chaque site supplémentaire coûte 1 500 DZD par mois (Multi-sites n’est pas inclus dans les 15 jours d’essai). Au moment de l’achat, vous choisissez combien de sites en plus vous voulez, et vous pouvez en ajouter plus tard.' },
  { q: 'Quelles réductions pour un abonnement long ?', a: 'Le mois seul est au prix normal. Avec 6 mois, 1 mois est offert. Avec 12 mois, 2 mois sont offerts. La réduction s’applique à tous vos modules.' },
  { q: 'Puis-je acheter un seul module ?', a: 'Oui. Chaque module s’achète seul, en sélection ou dans un pack. Si un module en demande un autre (Qualité demande Stock, par exemple), il est coché automatiquement pour vous.' },
  { q: 'Un pack coûte-t-il plus cher que les modules séparés ?', a: 'Non. Le prix d’un pack est exactement la somme des modules qu’il contient. Le pack sert à choisir plus vite.' },
  { q: 'Comment prolonger un module ?', a: 'Dans votre Espace client, achetez des mois en plus : ils s’ajoutent à la fin de la période en cours, sans rien perdre. Rien n’est prélevé automatiquement.' },
  { q: 'Comment payer ?', a: 'Le paiement en ligne arrive très bientôt. En attendant, l’activation de vos modules vous est offerte pendant la phase de lancement.' },
  { q: 'Que se passe-t-il à l’échéance ?', a: 'Si vous ne prolongez pas, le module se met en pause. Vos données sont conservées et redeviennent accessibles dès que vous le réactivez.' },
];

export function PricingPage() {
  const { me } = useAuth();
  const [open, setOpen] = useState<number | null>(0);
  return (
    <SiteLayout className="site-pricing">
      <section className="page-hero page-hero-sm">
        <div className="site-container page-hero-inner">
          <span className="section-eyebrow">Tarifs</span>
          <h1>Payez uniquement ce que vous utilisez.</h1>
          <p>Un pack prêt à l’emploi ou vos modules à la carte. Prix en dinars, sans frais cachés, sans engagement.</p>
          {!me && (
            <div className="page-hero-ctas">
              <Link to="/signup?next=/tarifs" className="site-btn site-btn-primary">
                Essayer gratuitement 15 jours <Icon name="arrowRight" size={16} />
              </Link>
              <Link to="/login?next=/tarifs" className="site-btn site-btn-ghost">
                J’ai déjà un compte
              </Link>
            </div>
          )}
        </div>
      </section>

      <section className="section section-tight">
        <div className="site-container">
          <TrialNote loggedIn={!!me} />
          <PricingSection />
        </div>
      </section>

      <section className="section section-alt">
        <div className="site-container faq-wrap">
          <div className="section-head">
            <span className="section-eyebrow">Questions fréquentes</span>
            <h2>Tout savoir sur l’abonnement</h2>
          </div>
          <div className="faq">
            {FAQ.map((f, i) => (
              <div key={f.q} className={`faq-item${open === i ? ' is-open' : ''}`}>
                <button type="button" className="faq-q" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>
                  {f.q}
                  <Icon name="chevronDown" size={18} />
                </button>
                {open === i && <p className="faq-a">{f.a}</p>}
              </div>
            ))}
          </div>
        </div>
      </section>
    </SiteLayout>
  );
}

export default PricingPage;
