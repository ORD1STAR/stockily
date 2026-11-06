import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { DownloadInfo, downloadsApi } from '../lib/api';
import { Icon, IconName } from '../lib/Icon';
import { SiteLayout } from './SiteLayout';

const mb = (n: number) => `${(n / 1_000_000).toFixed(n > 100_000_000 ? 0 : 1).replace('.', ',')} Mo`;

const BENEFITS: { icon: IconName; title: string; text: string }[] = [
  { icon: 'monitor', title: 'Vendez sans internet', text: 'La caisse, les ventes et les factures continuent de fonctionner quand la connexion coupe. Plus de client qui attend.' },
  { icon: 'refresh', title: 'Tout se retrouve ensuite', text: 'Dès que le réseau revient, vos ventes et vos mouvements de stock rejoignent votre compte, sans ressaisie.' },
  { icon: 'lock', title: 'Vos données sur votre poste', text: 'Votre activité est enregistrée sur votre ordinateur et sauvegardée en ligne à chaque connexion.' },
  { icon: 'download', title: 'Simple à installer', text: 'Un fichier à ouvrir, une connexion avec votre compte Stockily, et votre poste est prêt.' },
];

const STEPS: { title: string; text: string }[] = [
  { title: 'Téléchargez', text: 'Choisissez le fichier de votre système ci-dessus.' },
  { title: 'Installez', text: 'Windows : ouvrez le fichier et suivez l’assistant en français. Linux : rendez le fichier .AppImage exécutable (clic droit, Propriétés) puis ouvrez-le.' },
  { title: 'Connectez-vous', text: 'Au premier lancement, entrez les identifiants de votre compte Stockily (internet requis cette seule fois).' },
];

const FAQ: { q: string; a: string }[] = [
  { q: 'Faut-il internet pour travailler ?', a: 'Non. Après la première connexion, vous vendez, facturez et gérez le stock sans connexion. Tout se synchronise dès que le réseau revient. Au bout de 45 jours sans aucune connexion, l’application passe en consultation seule jusqu’à la prochaine synchronisation.' },
  { q: 'Mes données sont-elles en sécurité ?', a: 'Oui. Elles sont stockées sur votre poste et sauvegardées en ligne à chaque synchronisation.' },
  { q: 'Puis-je l’installer sur plusieurs postes ?', a: 'Oui, selon votre licence : chaque poste s’active avec votre compte et se retrouve dans votre espace client.' },
  { q: 'Et sur Mac ou téléphone ?', a: 'L’application est disponible pour Windows 10 et 11 et pour Linux (64 bits). Sur Mac, téléphone et tablette, ouvrez Stockily dans le navigateur.' },
];

const TARGETS: { platform: 'windows' | 'linux'; title: string; req: string; icon: IconName }[] = [
  { platform: 'windows', title: 'Stockily pour Windows', req: 'Windows 10 et 11, 64 bits', icon: 'monitor' },
  { platform: 'linux', title: 'Stockily pour Linux', req: 'Linux 64 bits (AppImage)', icon: 'monitor' },
];

function DownloadCard({ target, info }: { target: (typeof TARGETS)[number]; info: DownloadInfo | null | undefined }) {
  const ready = !!info?.available;
  return (
    <>
      <div className="dl-card">
        <span className="mod-chip tone-violet dl-chip">
          <Icon name={target.icon} size={26} />
        </span>
        <div className="dl-main">
          <h2>{target.title}</h2>
          <p className="dl-meta">
            {info === undefined && 'Chargement…'}
            {info === null && 'Le téléchargement est momentanément indisponible.'}
            {info && !info.available && 'L’installeur sera bientôt disponible.'}
            {ready && (
              <>
                Version {info.version} · {mb(info.size ?? 0)} · {target.req}
              </>
            )}
          </p>
        </div>
        {ready ? (
          <a className="site-btn site-btn-primary site-btn-lg" href={downloadsApi.url(target.platform)} rel="nofollow">
            <Icon name="download" size={18} /> Télécharger
          </a>
        ) : (
          <button type="button" className="site-btn site-btn-primary site-btn-lg" disabled>
            <Icon name="download" size={18} /> Télécharger
          </button>
        )}
      </div>
    </>
  );
}

export function DownloadPage() {
  const [list, setList] = useState<DownloadInfo[] | null | undefined>(undefined);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    downloadsApi
      .list()
      .then(setList)
      .catch(() => setList(null));
  }, []);

  // The visitor's own system first.
  const onLinux = typeof navigator !== 'undefined' && /linux/i.test(navigator.userAgent) && !/android/i.test(navigator.userAgent);
  const targets = onLinux ? [...TARGETS].reverse() : TARGETS;
  return (
    <SiteLayout className="site-download">
      <section className="page-hero page-hero-sm">
        <div className="site-container page-hero-inner">
          <span className="section-eyebrow">Application PC</span>
          <h1>Stockily sur votre ordinateur, même sans internet.</h1>
          <p>Installez l’application pour Windows ou Linux : votre caisse et votre stock restent disponibles quand la connexion coupe, et tout se synchronise au retour du réseau.</p>
        </div>
      </section>

      <section className="site-container dl-wrap">
        {targets.map((t) => (
          <DownloadCard key={t.platform} target={t} info={list === undefined ? undefined : list === null ? null : (list.find((d) => d.platform === t.platform) ?? null)} />
        ))}
        <p className="dl-other">
          Mac, téléphone ou tablette : <Link to="/login">ouvrez Stockily dans le navigateur</Link>, rien à installer.
        </p>
      </section>

      <section className="site-container dl-steps-wrap">
        <div className="section-head">
          <span className="section-eyebrow">Pourquoi l’application</span>
          <h2>Votre commerce ne s’arrête jamais</h2>
        </div>
        <ol className="dl-steps">
          {BENEFITS.map((s) => (
            <li key={s.title}>
              <span className="mod-chip tone-violet">
                <Icon name={s.icon} size={20} />
              </span>
              <b>{s.title}</b>
              <p>{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="site-container dl-install">
        <h2>Installer en 3 étapes</h2>
        <ol>
          {STEPS.map((s, i) => (
            <li key={s.title}>
              <span className="dl-num">{i + 1}</span>
              <div>
                <b>{s.title}</b>
                <p>{s.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="section section-alt">
        <div className="site-container faq-wrap">
          <div className="section-head">
            <span className="section-eyebrow">Questions fréquentes</span>
            <h2>Avant d’installer</h2>
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

export default DownloadPage;
