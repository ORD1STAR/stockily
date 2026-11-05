import { Prisma, PrismaClient } from '@prisma/client';
import { snapshotModels } from '../modules/sync/snapshot-models';

export interface Snapshot {
  generatedAt: string;
  orgId: string;
  deviceActivationId: string;
  models: Record<string, Record<string, unknown>[]>;
  numberBlocks: { id: string; orgId: string; deviceActivationId: string; counterKey: string; year: number; start: number; end: number; lastUsed: number; createdAt: string; releasedAt: string | null }[];
}

type CreateMany = { createMany: (args: { data: unknown[] }) => Promise<unknown> };

const jsonFields = new Map(
  Prisma.dmmf.datamodel.models.map((m) => [m.name, m.fields.filter((f) => f.kind === 'scalar' && f.type === 'Json').map((f) => f.name)]),
);

/** JSON null in a nullable Json column has to be spelled Prisma.DbNull for createMany. */
function prepare(model: string, row: Record<string, unknown>): Record<string, unknown> {
  const fields = jsonFields.get(model) ?? [];
  if (fields.length === 0) return row;
  const out = { ...row };
  for (const f of fields) if (out[f] === null) out[f] = Prisma.DbNull;
  return out;
}

/**
 * Replaces the device's copy of the org data with the server's, in one
 * transaction (a crash mid-load leaves the previous copy intact).
 * `session_replication_role = replica` turns off FK triggers for the load,
 * so tables can be emptied and refilled in any order — and rows outside the
 * snapshot that point at them (local refresh tokens -> users, audit rows,
 * the device's number blocks and outbox) survive untouched; ids are the
 * server's, so they still match afterwards. Needs the superuser connection.
 *
 * Number blocks are merged, not replaced: the device's own lastUsed is the
 * truth for numbers it consumed but hasn't replayed yet.
 */
export async function loadSnapshot(admin: PrismaClient, snapshot: Snapshot): Promise<void> {
  const models = snapshotModels();
  await admin.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = replica`);
      for (const m of models) await tx.$executeRawUnsafe(`DELETE FROM "${m.table}"`);
      for (const m of models) {
        const rows = snapshot.models[m.name] ?? [];
        const delegate = (tx as unknown as Record<string, CreateMany>)[m.delegate];
        for (let i = 0; i < rows.length; i += 500) {
          await delegate.createMany({ data: rows.slice(i, i + 500).map((r) => prepare(m.name, r)) });
        }
      }
      for (const b of snapshot.numberBlocks) {
        const local = await tx.numberBlock.findUnique({ where: { id: b.id } });
        if (!local) {
          await tx.numberBlock.create({ data: { ...b, createdAt: new Date(b.createdAt), releasedAt: b.releasedAt ? new Date(b.releasedAt) : null } });
        } else {
          await tx.numberBlock.update({
            where: { id: b.id },
            data: { lastUsed: Math.max(local.lastUsed, b.lastUsed), releasedAt: b.releasedAt ? new Date(b.releasedAt) : local.releasedAt },
          });
        }
      }
      // Blocks the server released (device deactivated meanwhile) stop being used.
      const live = new Set(snapshot.numberBlocks.map((b) => b.id));
      await tx.numberBlock.updateMany({ where: { releasedAt: null, id: { notIn: [...live] } }, data: { releasedAt: new Date() } });
    },
    { timeout: 300_000, maxWait: 30_000 },
  );
}
