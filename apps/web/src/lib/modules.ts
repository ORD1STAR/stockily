import type { IconName } from './Icon';

// Single source of truth for the built product module list — used by
// AppShell's desktop sidebar, the dashboard's module grid and the mobile
// "Applications" launcher (MobileHome / AppsListPage) alike, so they never
// quietly drift apart. Order and `group` drive how the sidebar is sectioned:
// day-to-day operations first, then the commercial flow, then control.
export type ModuleGroup = 'operations' | 'commerce' | 'control';

export interface ModuleNavEntry {
  key: string;
  to: string;
  label: string;
  hint: string;
  icon: IconName;
  group: ModuleGroup;
  /** Accent hue for the module's tile/icon chip — one of the `--mod-*` tokens in styles.css. */
  tone: 'violet' | 'teal' | 'amber' | 'blue' | 'rose' | 'green' | 'slate';
}

export const MODULE_GROUP_LABEL: Record<ModuleGroup, string> = {
  operations: 'Opérations',
  commerce: 'Commerce',
  control: 'Contrôle',
};

// Mirrors ModuleEntitlementGuard's own isActive/isValidTrial check
// (apps/api/.../module-entitlement.guard.ts) — an entitlement ROW existing
// is not the same as the module being usable: a lapsed trial or a
// suspended/cancelled module still has a row (status just isn't 'active'
// or an unexpired 'trial'), and every nav tile's visibility needs to agree
// with what the API will actually let the user do, not just whether the
// org has ever had this module at all.
export function entitledModuleKeys(entitlements: { module: string; status: string; trialEndsAt: string | null }[]): Set<string> {
  return new Set(
    entitlements
      .filter((e) => e.status === 'active' || (e.status === 'trial' && !!e.trialEndsAt && new Date(e.trialEndsAt).getTime() > Date.now()))
      .map((e) => e.module),
  );
}

export const PRODUCT_MODULES: ModuleNavEntry[] = [
  { key: 'stock', to: '/stock', label: 'Stock', hint: 'Produits, mouvements, seuils', icon: 'package', group: 'operations', tone: 'violet' },
  { key: 'scan', to: '/scan', label: 'Scan & étiquettes', hint: 'Scanner, vente rapide, étiquettes', icon: 'scan', group: 'operations', tone: 'teal' },
  { key: 'stock', to: '/inventory', label: 'Inventaire', hint: 'Comptage et ajustement du stock', icon: 'clipboard', group: 'operations', tone: 'violet' },
  { key: 'sites', to: '/sites', label: 'Multi-sites', hint: 'Entrepôts et transferts', icon: 'warehouse', group: 'operations', tone: 'slate' },
  { key: 'scan', to: '/counters', label: 'Comptoirs', hint: 'Caisses, ventes au scan, ticket Z', icon: 'calculator', group: 'commerce', tone: 'teal' },
  { key: 'purchasing', to: '/purchasing', label: 'Achats', hint: 'Bons de commande, réceptions', icon: 'cart', group: 'commerce', tone: 'amber' },
  { key: 'sales', to: '/sales', label: 'Ventes', hint: 'Devis, commandes clients', icon: 'trending', group: 'commerce', tone: 'green' },
  { key: 'invoicing', to: '/invoicing', label: 'Factures', hint: 'Facturation, TVA, paiements', icon: 'receipt', group: 'commerce', tone: 'blue' },
  { key: 'cash', to: '/cash', label: 'Caisse', hint: 'Encaissements, décaissements, solde', icon: 'wallet', group: 'commerce', tone: 'green' },
  { key: 'stats', to: '/stats', label: 'Statistiques', hint: 'Ventes, achats, soldes, stock', icon: 'chart', group: 'control', tone: 'violet' },
  { key: 'quality', to: '/quality', label: 'Qualité', hint: 'Lots, péremption, non-conformités', icon: 'shield', group: 'control', tone: 'rose' },
];

/** Not built yet — shown greyed out so customers see what's coming. */
export const UPCOMING_MODULES: { label: string; tag: string; icon: IconName }[] = [
  { label: 'CRM', tag: 'Bientôt', icon: 'handshake' },
  { label: 'Comptabilité', tag: 'Bientôt', icon: 'calculator' },
];
