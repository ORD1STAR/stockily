// Single source of truth for the built product module list — used by
// AppShell's desktop sidebar and the mobile "Applications" launcher
// (MobileHome / AppsListPage) alike, so the two never quietly drift apart.
// Was PHASE1_MODULES until Milestone 9 added the first Phase 2 entry
// (purchasing) — renamed since it's no longer just Phase 1.
export interface ModuleNavEntry {
  key: string;
  to: string;
  label: string;
  hint: string;
}

export const PRODUCT_MODULES: ModuleNavEntry[] = [
  { key: 'stock', to: '/stock', label: 'Gestion de Stock', hint: 'Produits, mouvements, seuils' },
  { key: 'quality', to: '/quality', label: 'Qualité', hint: 'Lots, péremption, non-conformités' },
  { key: 'invoicing', to: '/invoicing', label: 'Factures', hint: 'Clients, TVA, paiements' },
  { key: 'sites', to: '/sites', label: 'Transferts Multi-Sites', hint: 'Entrepôts et transferts' },
  { key: 'scan', to: '/scan', label: 'Scan / QR', hint: 'Scanner, vente rapide, étiquettes' },
  { key: 'purchasing', to: '/purchasing', label: 'Achats', hint: 'Bons de commande, réceptions fournisseurs' },
];
