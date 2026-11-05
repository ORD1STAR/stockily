import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Every numbered series in the app: "invoice" (FA), "purchase_order" (BC),
 * "sales:<quote|order>" (DEV/CMD), "doc:<docType>" (BL, RC, RF, BR, PF, Z,
 * INV — the shared document_counters table).
 */
export type CounterKey = 'invoice' | 'purchase_order' | `sales:${string}` | `doc:${string}`;

export interface AllocatedNumber {
  key: CounterKey;
  year: number;
  value: number;
}

/**
 * How numbers are allocated for the current request:
 *  - no store (normal web/API request): the org's atomic counter.
 *  - "local": a desktop device running offline — numbers come from blocks
 *    the device reserved while online, and are recorded in `allocated` so
 *    the outbox can replay them.
 *  - "replay": the server replaying a device's outbox entry — it must reuse
 *    the exact numbers the device already printed (`preassigned`), each
 *    checked against that device's reserved blocks.
 */
export interface NumberingStore {
  mode: 'local' | 'replay';
  orgId?: string;
  deviceActivationId: string;
  preassigned: AllocatedNumber[];
  allocated: AllocatedNumber[];
}

const storage = new AsyncLocalStorage<NumberingStore>();

export function runWithNumbering<T>(store: NumberingStore, fn: () => T): T {
  return storage.run(store, fn);
}

export function getNumberingStore(): NumberingStore | undefined {
  return storage.getStore();
}

// Table/column per series — constants from code, never request input.
function counterTable(key: CounterKey): { table: string; docType: string | null } {
  if (key === 'invoice') return { table: 'invoice_counters', docType: null };
  if (key === 'purchase_order') return { table: 'purchase_order_counters', docType: null };
  if (key.startsWith('sales:')) return { table: 'sales_order_counters', docType: key.slice('sales:'.length) };
  return { table: 'document_counters', docType: key.slice('doc:'.length) };
}

/** Atomically adds `by` to the org's counter for (key, year) and returns the new last number. */
async function bumpCounter(tx: Prisma.TransactionClient, orgId: string, key: CounterKey, year: number, by: number): Promise<number> {
  const { table, docType } = counterTable(key);
  const t = Prisma.raw(`"${table}"`);
  // Single INSERT ... ON CONFLICT DO UPDATE ... RETURNING: concurrent
  // callers serialize on Postgres's row lock, never a read-then-write race.
  const rows =
    docType === null
      ? await tx.$queryRaw<{ lastNumber: number }[]>`
          INSERT INTO ${t} ("orgId", "year", "lastNumber") VALUES (${orgId}, ${year}, ${by})
          ON CONFLICT ("orgId", "year") DO UPDATE SET "lastNumber" = ${t}."lastNumber" + ${by}
          RETURNING "lastNumber"`
      : await tx.$queryRaw<{ lastNumber: number }[]>`
          INSERT INTO ${t} ("orgId", "year", "docType", "lastNumber") VALUES (${orgId}, ${year}, ${docType}, ${by})
          ON CONFLICT ("orgId", "year", "docType") DO UPDATE SET "lastNumber" = ${t}."lastNumber" + ${by}
          RETURNING "lastNumber"`;
  return Number(rows[0].lastNumber);
}

/** Next number in a series, honouring the request's numbering mode (see NumberingStore). */
export async function allocateNumber(tx: Prisma.TransactionClient, orgId: string, key: CounterKey): Promise<{ year: number; value: number }> {
  const store = storage.getStore();
  const year = new Date().getFullYear();

  if (store?.mode === 'replay') {
    const i = store.preassigned.findIndex((n) => n.key === key);
    if (i === -1) throw new ConflictException({ statusCode: 409, error: 'replay_number_missing', message: `Numéro attendu manquant pour ${key}.` });
    const [n] = store.preassigned.splice(i, 1);
    const block = await tx.numberBlock.findFirst({
      where: { orgId, deviceActivationId: store.deviceActivationId, counterKey: key, year: n.year, start: { lte: n.value }, end: { gte: n.value } },
    });
    if (!block) throw new ConflictException({ statusCode: 409, error: 'number_out_of_block', message: `Le numéro ${n.value} (${key}) n'appartient à aucune plage réservée par cet appareil.` });
    if (n.value > block.lastUsed) await tx.numberBlock.update({ where: { id: block.id }, data: { lastUsed: n.value } });
    return { year: n.year, value: n.value };
  }

  if (store?.mode === 'local') {
    const rows = await tx.$queryRaw<{ lastUsed: number }[]>`
      UPDATE "number_blocks" SET "lastUsed" = "lastUsed" + 1
      WHERE id = (
        SELECT id FROM "number_blocks"
        WHERE "orgId" = ${orgId} AND "counterKey" = ${key} AND "year" = ${year}
          AND "releasedAt" IS NULL AND "lastUsed" < "end"
        ORDER BY "start" LIMIT 1 FOR UPDATE
      )
      RETURNING "lastUsed"`;
    if (rows.length === 0) {
      throw new ServiceUnavailableException({
        statusCode: 503,
        error: 'numbers_exhausted',
        message: 'Plus de numéros disponibles hors ligne pour ce type de document. Connectez cet ordinateur à internet quelques instants pour en recevoir de nouveaux.',
      });
    }
    const allocated = { key, year, value: Number(rows[0].lastUsed) };
    store.allocated.push(allocated);
    return { year, value: allocated.value };
  }

  return { year, value: await bumpCounter(tx, orgId, key, year, 1) };
}

/** Reserves `size` consecutive numbers of a series for one device (server side). */
export async function reserveNumberBlock(tx: Prisma.TransactionClient, orgId: string, deviceActivationId: string, key: CounterKey, size: number) {
  const year = new Date().getFullYear();
  const end = await bumpCounter(tx, orgId, key, year, size);
  const start = end - size + 1;
  return tx.numberBlock.create({ data: { orgId, deviceActivationId, counterKey: key, year, start, end, lastUsed: start - 1 } });
}

export function formatNumber(prefix: string, n: { year: number; value: number }): string {
  return `${prefix}-${n.year}-${String(n.value).padStart(6, '0')}`;
}

/**
 * Next number for a bon / proforma (BL-2026-000001, RC-…, RF-…, BR-…, PF-…),
 * per org, year and document type.
 */
export async function nextDocumentNumber(tx: Prisma.TransactionClient, orgId: string, docType: string, prefix: string): Promise<string> {
  return formatNumber(prefix, await allocateNumber(tx, orgId, `doc:${docType}`));
}
