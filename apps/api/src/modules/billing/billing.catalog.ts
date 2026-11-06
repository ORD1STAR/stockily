// Self-service catalogue: the product modules a customer can buy from the
// public Tarifs page / Espace client, the ready-made packs, and the billing
// durations. Prices themselves live in `module_prices` (editable by the
// platform admin); this file only carries the marketing copy and the pack
// composition. A pack's price is always the sum of its modules' individual
// prices (no hidden discount).

export interface CatalogModuleInfo {
  key: string;
  name: string;
  tagline: string;
  features: string[];
  /** Set when the price is per unit rather than flat (Multi-sites: per extra site). */
  unit?: string;
}

/** Purchasable product modules, in display order. Infra keys (licensing, members) are never sold. */
export const CATALOG_MODULES: CatalogModuleInfo[] = [
  { key: 'stock', name: 'Stock & Inventaire', tagline: 'Sachez exactement ce que vous avez, où, et quand recommander.', features: ['Quantités en temps réel, par dépôt', 'Alertes avant la rupture', 'Inventaires guidés, écarts corrigés en un clic'] },
  { key: 'quality', name: 'Qualité', tagline: 'Plus aucun produit périmé oublié sur l’étagère.', features: ['Suivi lot par lot', 'Alertes de péremption automatiques', 'Quarantaine et non-conformités'] },
  { key: 'scan', name: 'Scan & Comptoirs', tagline: 'Vendez et réceptionnez en un seul scan.', features: ['Téléphone ou douchette USB / Bluetooth', 'Étiquettes codes-barres et QR', 'Caisses de comptoir et ticket Z'] },
  { key: 'invoicing', name: 'Factures', tagline: 'Des factures conformes, sans y penser.', features: ['Mentions du Décret 05-468 incluses', 'TVA, timbre et montant en lettres', 'Suivi des paiements et des impayés'] },
  { key: 'sales', name: 'Ventes', tagline: 'Du devis à la facture en quelques clics.', features: ['Devis et commandes clients', 'Stock réservé automatiquement', 'Bons de livraison imprimables'] },
  { key: 'purchasing', name: 'Achats', tagline: 'Commandez au meilleur prix, réceptionnez sans erreur.', features: ['Demandes de prix comparées', 'Bons de commande fournisseurs', 'Réceptions qui alimentent le stock'] },
  { key: 'cash', name: 'Caisse', tagline: 'Sachez à tout moment combien il y a en caisse.', features: ['Journal de caisse clair', 'Encaissements rattachés aux factures', 'Décaissements fournisseurs'] },
  { key: 'sites', name: 'Multi-sites', tagline: 'Grandissez sans changer d’outil.', unit: 'site supplémentaire', features: ['1er site gratuit à vie', '1 500 DZD / mois par site en plus', 'Transferts entre sites et vue consolidée'] },
  { key: 'stats', name: 'Statistiques', tagline: 'Pilotez avec des chiffres, pas au feeling.', features: ['Chiffre d’affaires, marges, panier moyen', 'Meilleurs produits et clients', 'Créances et dettes en un coup d’œil'] },
];

export const CATALOG_KEYS = CATALOG_MODULES.map((m) => m.key);

export interface CatalogPack {
  key: string;
  name: string;
  tagline: string;
  modules: string[];
  highlight?: boolean;
}

export const CATALOG_PACKS: CatalogPack[] = [
  { key: 'starter', name: 'Starter', tagline: 'Gardez votre stock sous contrôle dès aujourd’hui.', modules: ['stock', 'quality'] },
  { key: 'commerce', name: 'Commerce', tagline: 'Vendez au comptoir, facturez, encaissez.', modules: ['stock', 'scan', 'invoicing', 'sales', 'cash'] },
  { key: 'pro', name: 'Pro', tagline: 'La chaîne complète, de l’achat à l’encaissement.', modules: ['stock', 'quality', 'scan', 'invoicing', 'purchasing', 'sales', 'cash'], highlight: true },
  { key: 'business', name: 'Business', tagline: 'Tout Stockily, sans compromis.', modules: [...CATALOG_KEYS] },
];

/**
 * Billing periods. `billedMonths` < `months` is the commercial gesture:
 * 6 months are billed 5 (1 month offered), 12 months are billed 10 (2 months
 * offered). One month is the plain price.
 */
export const DURATIONS = [
  { months: 1, billedMonths: 1, label: '1 mois' },
  { months: 3, billedMonths: 3, label: '3 mois' },
  { months: 6, billedMonths: 5, label: '6 mois', badge: '1 mois offert' },
  { months: 12, billedMonths: 10, label: '12 mois', badge: '2 mois offerts' },
];

/** Modules announced but not built yet, shown greyed on the Tarifs page. */
export const UPCOMING = ['CRM', 'Comptabilité générale', 'Livraisons & transport', 'Retours / SAV'];
