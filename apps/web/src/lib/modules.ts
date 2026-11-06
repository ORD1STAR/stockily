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
// Read permissions that are granted to every sub-user only so pages can load
// their reference data (site pickers, product lookups…). They don't make the
// owning module visible in the menu.
const IMPLIED_READS = new Set(['sites.site.read', 'stock.product.read', 'invoicing.partner.read']);

/**
 * Modules the user can actually open: entitled by the org AND — when the
 * caller's permissions are given — at least one real (non-implied) permission
 * on that module. This keeps menus in sync with what the API will allow.
 */
type EntitlementLike = { module: string; status: string; trialEndsAt: string | null; expiresAt?: string | null };

/** Usable right now: an active paid period not past its end (none = no end), or an unexpired trial. */
export function isEntitlementUsable(e: Omit<EntitlementLike, 'module'>): boolean {
  if (e.status === 'active') return !e.expiresAt || new Date(e.expiresAt).getTime() > Date.now();
  return e.status === 'trial' && !!e.trialEndsAt && new Date(e.trialEndsAt).getTime() > Date.now();
}

export function entitledModuleKeys(entitlements: EntitlementLike[], permissions?: string[]): Set<string> {
  const entitled = entitlements.filter(isEntitlementUsable).map((e) => e.module);
  if (!permissions) return new Set(entitled);
  return new Set(entitled.filter((k) => permissions.some((a) => a.startsWith(`${k}.`) && !IMPLIED_READS.has(a))));
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
