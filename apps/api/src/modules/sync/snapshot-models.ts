import { Prisma } from '@prisma/client';

// Tables that never travel in a snapshot: sessions, server-side history the
// device doesn't need, and the sync machinery's own bookkeeping
// (NumberBlock is exchanged separately — only the device's own blocks).
const EXCLUDED = new Set([
  'RefreshToken',
  'AuditLog',
  'DeviceActivation',
  'SyncReplayLog',
  'LocalOutboxEntry',
  'LocalIdMap',
  'NumberBlock',
  // Platform-admin tables — not tenant-scoped, never shipped to a device.
  'AdminUser',
  'AdminRefreshToken',
  'AdminAuditLog',
  'ModulePrice',
  'PlatformPayment',
]);

export interface SnapshotModel {
  name: string;
  /** Prisma client delegate, e.g. "invoiceLine". */
  delegate: string;
  /** Postgres table, e.g. "invoice_lines". */
  table: string;
  where: (orgId: string) => object;
}

type DmmfModel = (typeof Prisma.dmmf.datamodel.models)[number];

// Derived from the Prisma schema itself rather than a hand-kept list, so a
// table added later is included automatically: rows with an orgId are
// filtered by it, child tables without one (InvoiceLine, StockLevel, …)
// through their first required parent relation, recursively.
export function snapshotModels(): SnapshotModel[] {
  const byName = new Map(Prisma.dmmf.datamodel.models.map((m) => [m.name, m]));

  const whereFor = (m: DmmfModel, orgId: string): object => {
    if (m.name === 'Organization') return { id: orgId };
    if (m.name === 'Module') return {};
    if (m.name === 'Role') return { OR: [{ orgId }, { orgId: null }] };
    if (m.fields.some((f) => f.name === 'orgId')) return { orgId };
    const parent = m.fields.find((f) => f.kind === 'object' && f.isRequired && (f.relationFromFields?.length ?? 0) > 0);
    if (!parent) throw new Error(`Snapshot: no way to scope model ${m.name} to an organization`);
    const parentModel = byName.get(parent.type);
    if (!parentModel) throw new Error(`Snapshot: unknown parent model ${parent.type}`);
    return { [parent.name]: whereFor(parentModel, orgId) };
  };

  return Prisma.dmmf.datamodel.models
    .filter((m) => !EXCLUDED.has(m.name))
    .map((m) => ({
      name: m.name,
      delegate: m.name.charAt(0).toLowerCase() + m.name.slice(1),
      table: m.dbName ?? m.name,
      where: (orgId: string) => whereFor(m, orgId),
    }));
}

/**
 * Series a desktop device keeps a reserved block of numbers for — every
 * numbered document it can create offline. Inventaire ("doc:inventory")
 * is deliberately absent: inventory counts are online-only.
 */
export const DEVICE_COUNTER_KEYS = [
  'invoice',
  'purchase_order',
  'sales:quote',
  'sales:order',
  'doc:proforma',
  'doc:delivery_note',
  'doc:customer_return',
  'doc:supplier_return',
  'doc:receipt',
  'doc:counter_session',
] as const;
