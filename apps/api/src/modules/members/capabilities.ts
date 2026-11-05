// Advanced ("détaillé") permissions shown in the sub-user editor. Each
// capability is a human-labelled bundle of real actions. Consultation (every
// `.read` action of the module) is always included — capabilities add on top.
// An action may belong to another module (e.g. scanning moves stock): its
// RolePermission row is attached to the module named by its prefix.
export interface Capability {
  id: string;
  label: string;
  hint?: string;
  actions: string[];
}

export const CAPABILITIES: Record<string, Capability[]> = {
  stock: [
    { id: 'product-write', label: 'Créer / modifier des produits', actions: ['stock.product.write'] },
    { id: 'product-delete', label: 'Supprimer des produits', actions: ['stock.product.delete'] },
    { id: 'movement', label: 'Enregistrer des mouvements', hint: 'Entrées, sorties, transferts', actions: ['stock.movement.create'] },
    { id: 'adjust', label: "Ajuster l'inventaire", actions: ['stock.inventory.adjust'] },
  ],
  scan: [
    { id: 'sell', label: 'Vente rapide', hint: 'Scanner et encaisser au comptoir', actions: ['scan.counter.sell', 'scan.counter.session'] },
    { id: 'scan-move', label: 'Scanner & mouvements de stock', hint: 'Entrée, sortie, transfert par scan', actions: ['stock.movement.create'] },
    { id: 'receiving', label: 'Réception de marchandise', hint: 'Réceptionner un bon de commande', actions: ['purchasing.receipt.create'] },
    { id: 'labels', label: 'Étiquettes', hint: 'Générer et imprimer', actions: ['scan.label.generate', 'scan.label.print'] },
    { id: 'counter-create', label: 'Créer / modifier des comptoirs', actions: ['scan.counter.create'] },
    { id: 'counter-cash', label: 'Mouvements de caisse du comptoir', hint: 'Fond de caisse, retraits', actions: ['scan.counter.cash'] },
    { id: 'tickets', label: 'Tickets & ticket Z', actions: ['scan.counter.ticket'] },
  ],
  cash: [
    { id: 'collect', label: 'Encaisser', actions: ['cash.entry.collect'] },
    { id: 'disburse', label: 'Décaisser', actions: ['cash.entry.disburse'] },
    { id: 'cancel', label: 'Annuler un mouvement', actions: ['cash.entry.cancel'] },
  ],
  invoicing: [
    { id: 'create', label: 'Créer des factures', actions: ['invoicing.invoice.create'] },
    { id: 'finalize', label: 'Finaliser / valider', actions: ['invoicing.invoice.finalize'] },
    { id: 'void', label: 'Annuler des factures', actions: ['invoicing.invoice.void'] },
    { id: 'delete', label: 'Supprimer des brouillons', actions: ['invoicing.invoice.delete'] },
    { id: 'payment', label: 'Enregistrer des paiements', actions: ['invoicing.payment.create'] },
    { id: 'partners', label: 'Gérer les clients / fournisseurs', actions: ['invoicing.partner.write', 'invoicing.partner.delete'] },
    { id: 'tax', label: 'Gérer les taxes', actions: ['invoicing.taxrate.write'] },
    { id: 'reminders', label: 'Lancer les relances', actions: ['invoicing.reminder.run'] },
  ],
  sales: [
    { id: 'create', label: 'Créer devis & commandes', actions: ['sales.order.create'] },
    { id: 'update', label: 'Modifier', actions: ['sales.order.update'] },
    { id: 'cancel', label: 'Annuler', actions: ['sales.order.cancel'] },
    { id: 'delete', label: 'Supprimer', actions: ['sales.order.delete', 'sales.orderline.delete'] },
    { id: 'invoice', label: 'Facturer', actions: ['sales.invoice.create'] },
    { id: 'pricing', label: 'Gérer les tarifs clients', actions: ['sales.pricing.write'] },
  ],
  purchasing: [
    { id: 'create', label: 'Créer des commandes', actions: ['purchasing.order.create'] },
    { id: 'update', label: 'Modifier', actions: ['purchasing.order.update'] },
    { id: 'cancel', label: 'Annuler', actions: ['purchasing.order.cancel'] },
    { id: 'delete', label: 'Supprimer', actions: ['purchasing.order.delete', 'purchasing.orderline.delete'] },
    { id: 'receipt', label: 'Réceptionner', actions: ['purchasing.receipt.create'] },
    { id: 'rfq', label: "Appels d'offres", actions: ['purchasing.rfq.create', 'purchasing.rfq.award'] },
    { id: 'invoice', label: 'Facture fournisseur', actions: ['purchasing.invoice.create'] },
  ],
  quality: [
    { id: 'batch', label: 'Gérer les lots', actions: ['quality.batch.write'] },
    { id: 'check', label: 'Enregistrer des contrôles', actions: ['quality.check.create'] },
    { id: 'nc', label: 'Résoudre les non-conformités', actions: ['quality.nonconformity.resolve'] },
  ],
  sites: [
    { id: 'site', label: 'Créer / modifier des sites', actions: ['sites.site.write'] },
    { id: 'transfer', label: 'Créer des transferts', actions: ['sites.transfer.create'] },
    { id: 'transfer-update', label: 'Traiter les transferts', actions: ['sites.transfer.update'] },
  ],
};
