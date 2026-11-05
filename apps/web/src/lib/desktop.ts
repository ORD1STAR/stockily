import { useEffect, useSyncExternalStore } from 'react';
import { LocalStatus, localApi } from './api';
import { useAuth } from './auth-context';

// One shared poller for the desktop app's sync status (AppShell's indicator
// and the Synchronisation page read the same snapshot). `null` = running on
// the web (no local API) — polling stops for good after the first 404.
let current: LocalStatus | null | undefined;
let timer: ReturnType<typeof setInterval> | null = null;
let pollToken: string | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export async function refreshDesktopStatus(): Promise<void> {
  if (!pollToken || current === null) return;
  try {
    current = await localApi.status(pollToken);
  } catch {
    // transient (e.g. token refresh in flight): keep the last known status
  }
  if (current === null && timer) {
    clearInterval(timer);
    timer = null;
  }
  emit();
}

function ensurePolling(token: string) {
  pollToken = token;
  if (timer || current === null) return;
  void refreshDesktopStatus();
  timer = setInterval(() => void refreshDesktopStatus(), 5000);
}

/** The device's sync status inside the desktop app; `null` on the web, `undefined` while unknown. */
export function useDesktopStatus(): LocalStatus | null | undefined {
  const { accessToken } = useAuth();
  useEffect(() => {
    if (accessToken) ensurePolling(accessToken);
  }, [accessToken]);
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}

const RESOURCE: [RegExp, string][] = [
  [/^\/api\/invoicing\/invoices\/[^/]+\/finalize/, 'Finalisation de facture'],
  [/^\/api\/invoicing\/invoices\/[^/]+\/void/, 'Annulation de facture'],
  [/^\/api\/invoicing\/invoices\/[^/]+\/convert/, 'Conversion de proforma'],
  [/^\/api\/invoicing\/invoices\/[^/]+\/payments/, 'Règlement de facture'],
  [/^\/api\/invoicing\/invoices/, 'Facture'],
  [/^\/api\/invoicing\/partners/, 'Fournisseur / client'],
  [/^\/api\/invoicing\/organization-profile/, 'Paramètres de l’entreprise'],
  [/^\/api\/invoicing\/tax-rates/, 'Taux de TVA'],
  [/^\/api\/stock\/movements/, 'Mouvement de stock'],
  [/^\/api\/stock\/products/, 'Article'],
  [/^\/api\/stock\/categories/, 'Catégorie'],
  [/^\/api\/trade\/payments/, 'Versement'],
  [/^\/api\/trade\/documents/, 'Bon (livraison / retour)'],
  [/^\/api\/cash/, 'Mouvement de caisse'],
  [/^\/api\/counters\/sessions\/[^/]+\/sales/, 'Vente comptoir'],
  [/^\/api\/counters/, 'Comptoir'],
  [/^\/api\/purchasing\/receipts/, 'Réception d’achat'],
  [/^\/api\/purchasing/, 'Commande fournisseur'],
  [/^\/api\/sales/, 'Vente (devis / commande)'],
  [/^\/api\/sites\/transfers/, 'Transfert inter-site'],
  [/^\/api\/sites/, 'Site'],
  [/^\/api\/quality/, 'Contrôle qualité'],
  [/^\/api\/scan/, 'Étiquette'],
];

const VERB: Record<string, string> = { POST: 'Création', PUT: 'Mise à jour', PATCH: 'Modification', DELETE: 'Suppression' };

/** "POST /api/invoicing/invoices" -> "Facture — Création" for people, not developers. */
export function describeEntry(method: string, path: string): string {
  const what = RESOURCE.find(([re]) => re.test(path))?.[1] ?? path.replace(/^\/api\//, '');
  const isAction = /\/(finalize|void|convert|payments|sales|cancel|close|open|movements|validate|award|invoice)(\/|$|\?)/.test(path);
  return isAction && what !== 'Mouvement de stock' ? what : `${what} — ${VERB[method] ?? method}`;
}
