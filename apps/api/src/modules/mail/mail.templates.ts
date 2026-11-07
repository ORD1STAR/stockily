// Transactional emails sent by Stockily itself (not the invoice reminders that
// organisations send to their own customers). French, plain and short: one
// message, one action. Every dynamic value is escaped before going in the HTML.

export interface MailContent {
  subject: string;
  text: string;
  html: string;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export const appUrl = () => (process.env.PUBLIC_APP_URL ?? 'https://stockily.ordi-tech.com').replace(/\/$/, '');

const money = (n: number) => `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n).replace(/[  ]/g, ' ')} DZD`;

function layout(title: string, bodyHtml: string, cta?: { label: string; url: string }): string {
  const button = cta
    ? `<p style="margin:28px 0 8px"><a href="${esc(cta.url)}" style="background:#5b3fd6;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600;display:inline-block">${esc(cta.label)}</a></p>`
    : '';
  return `<!doctype html><html lang="fr"><body style="margin:0;background:#f4f3f9;font-family:Arial,Helvetica,sans-serif;color:#1d1b2e">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:16px;padding:32px">
<tr><td>
<div style="font-size:22px;font-weight:700;margin-bottom:20px">Stock<span style="color:#17a589">ily</span></div>
<h1 style="font-size:20px;margin:0 0 14px">${esc(title)}</h1>
<div style="font-size:15px;line-height:1.6">${bodyHtml}</div>
${button}
<p style="font-size:12px;color:#7a7790;margin:28px 0 0;border-top:1px solid #ecebf3;padding-top:14px">Cet e-mail a été envoyé automatiquement, merci de ne pas y répondre. Besoin d’aide ? Écrivez-nous depuis votre espace client.</p>
</td></tr></table></td></tr></table></body></html>`;
}

export function welcomeMail(p: { organizationName: string; trialDays: number }): MailContent {
  const url = `${appUrl()}/dashboard`;
  const org = esc(p.organizationName);
  return {
    subject: 'Bienvenue sur Stockily',
    text: [
      'Bonjour,',
      '',
      `Votre compte « ${p.organizationName} » est créé. Vous profitez de ${p.trialDays} jours d’essai gratuit, sans engagement ni carte bancaire.`,
      '',
      'Pour bien démarrer :',
      '- ajoutez vos premiers articles,',
      '- enregistrez une vente ou un achat,',
      '- invitez vos collaborateurs si vous travaillez à plusieurs.',
      '',
      `Ouvrir Stockily : ${url}`,
      '',
      'Vous travaillez parfois sans internet ? L’application pour Windows et Linux garde votre caisse et votre stock disponibles hors connexion.',
      `Télécharger : ${appUrl()}/telecharger`,
      '',
      'L’équipe Stockily',
    ].join('\n'),
    html: layout(
      'Bienvenue sur Stockily',
      `<p>Bonjour,</p>
<p>Votre compte <b>${org}</b> est créé. Vous profitez de <b>${p.trialDays} jours d’essai gratuit</b>, sans engagement ni carte bancaire.</p>
<p style="margin-bottom:6px">Pour bien démarrer :</p>
<ul style="margin:0 0 14px;padding-left:20px">
<li>ajoutez vos premiers articles,</li>
<li>enregistrez une vente ou un achat,</li>
<li>invitez vos collaborateurs si vous travaillez à plusieurs.</li>
</ul>
<p>Vous travaillez parfois sans internet ? <a href="${esc(appUrl())}/telecharger" style="color:#5b3fd6">L’application pour Windows et Linux</a> garde votre caisse et votre stock disponibles hors connexion.</p>
<p>L’équipe Stockily</p>`,
      { label: 'Ouvrir Stockily', url },
    ),
  };
}

export function paymentConfirmedMail(p: {
  organizationName: string;
  number: string | null;
  amount: number;
  items: { label: string; months: number; total: number }[];
}): MailContent {
  const url = `${appUrl()}/compte?tab=payments`;
  const lines = p.items.map((i) => `${i.label} (${i.months} mois)`);
  return {
    subject: p.number ? `Paiement reçu, facture ${p.number}` : 'Paiement reçu',
    text: [
      'Bonjour,',
      '',
      `Nous avons bien reçu votre paiement de ${money(p.amount)} pour « ${p.organizationName} ». Vos modules sont activés.`,
      '',
      ...(p.number ? [`Facture : ${p.number}`] : []),
      ...lines.map((l) => `- ${l}`),
      '',
      p.number ? `Votre facture ${p.number} est jointe à cet e-mail (PDF).` : 'Votre facture est jointe à cet e-mail (PDF).',
      `Vous la retrouvez aussi à tout moment dans votre espace client : ${url}`,
      '',
      'Merci de votre confiance,',
      'L’équipe Stockily',
    ].join('\n'),
    html: layout(
      'Paiement reçu',
      `<p>Bonjour,</p>
<p>Nous avons bien reçu votre paiement de <b>${esc(money(p.amount))}</b> pour <b>${esc(p.organizationName)}</b>. Vos modules sont activés.</p>
${p.number ? `<p style="margin-bottom:6px">Facture : <b>${esc(p.number)}</b></p>` : ''}
<ul style="margin:0 0 14px;padding-left:20px">${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
<p>Votre facture${p.number ? ` <b>${esc(p.number)}</b>` : ''} est <b>jointe à cet e-mail</b> (PDF). Vous la retrouvez aussi à tout moment dans votre espace client.</p>
<p>Merci de votre confiance,<br/>L’équipe Stockily</p>`,
      { label: 'Voir mes factures', url },
    ),
  };
}

export function otpMail(p: { code: string; purpose: 'verify_email' | 'login'; minutes: number }): MailContent {
  const verify = p.purpose === 'verify_email';
  const title = verify ? 'Confirmez votre adresse e-mail' : 'Votre code de connexion';
  const intro = verify ? 'Voici le code pour confirmer votre adresse e-mail et activer votre compte Stockily :' : 'Voici votre code de connexion à Stockily :';
  const digits = p.code.split('').join(' ');
  return {
    subject: `${p.code} est votre code Stockily`,
    text: [
      'Bonjour,',
      '',
      intro,
      '',
      `    ${p.code}`,
      '',
      `Ce code est valable ${p.minutes} minutes et ne peut servir qu’une fois.`,
      'Si vous n’êtes pas à l’origine de cette demande, ignorez ce message et ne communiquez ce code à personne : l’équipe Stockily ne vous le demandera jamais.',
    ].join('\n'),
    html: layout(
      title,
      `<p>Bonjour,</p>
<p>${esc(intro)}</p>
<p style="margin:22px 0;text-align:center"><span style="display:inline-block;font-family:'Courier New',monospace;font-size:34px;letter-spacing:6px;font-weight:700;background:#f4f3f9;border-radius:12px;padding:14px 22px">${esc(digits.replace(/ /g, ''))}</span></p>
<p>Ce code est valable <b>${p.minutes} minutes</b> et ne peut servir qu’une fois.</p>
<p style="color:#7a7790;font-size:13px">Si vous n’êtes pas à l’origine de cette demande, ignorez ce message et ne communiquez ce code à personne : l’équipe Stockily ne vous le demandera jamais.</p>`,
    ),
  };
}
