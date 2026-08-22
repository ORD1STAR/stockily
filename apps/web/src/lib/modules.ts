// Single source of truth for the Phase 1 module list — used by AppShell's
// desktop sidebar and the mobile "Applications" launcher (MobileHome /
// AppsListPage) alike, so the two never quietly drift apart.
export interface ModuleNavEntry {
  key: string;
  to: string;
  label: string;
  hint: string;
}

export const PHASE1_MODULES: ModuleNavEntry[] = [
  { key: 'stock', to: '/stock', label: 'Gestion de Stock', hint: 'Produits, mouvements, seuils' },
  { key: 'quality', to: '/quality', label: 'Qualité', hint: 'Lots, péremption, non-conformités' },
  { key: 'invoicing', to: '/invoicing', label: 'Factures', hint: 'Clients, TVA, paiements' },
  { key: 'sites', to: '/sites', label: 'Transferts Multi-Sites', hint: 'Entrepôts et transferts' },
  { key: 'scan', to: '/scan', label: 'Scan / QR', hint: 'Scanner, vente rapide, étiquettes' },
];
