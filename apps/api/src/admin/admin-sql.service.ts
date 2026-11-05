import { BadRequestException, Injectable } from '@nestjs/common';
import { AdminPrismaService } from './admin-prisma.service';

const ROW_CAP = 1000;
const STATEMENT_TIMEOUT = '10s';

export interface SqlResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
  write: boolean;
  message?: string;
}

// The admin SQL console. Read-only by default: a SELECT runs inside a
// READ ONLY transaction with a statement timeout and a row cap, so it can
// never change data and can't hang the database. A write requires an
// explicit opt-in (write=true) AND a typed confirmation, and the caller
// (controller) logs the full statement to the admin audit trail.
@Injectable()
export class AdminSqlService {
  constructor(private readonly prisma: AdminPrismaService) {}

  private normalize(sql: string): string {
    const trimmed = sql.trim().replace(/;\s*$/, '');
    if (trimmed.length === 0) throw new BadRequestException('Requête vide.');
    // Reject multi-statement batches (a naive but effective guard — a lone
    // trailing ';' was already stripped). Semicolons inside string literals
    // are rare in an admin console and not worth a full SQL parser here.
    if (trimmed.includes(';')) throw new BadRequestException('Une seule instruction à la fois (pas de « ; » multiples).');
    return trimmed;
  }

  async run(sql: string, write: boolean): Promise<SqlResult> {
    const statement = this.normalize(sql);

    if (!write) {
      // READ ONLY transaction: any attempt to write throws "cannot execute
      // ... in a read-only transaction", so a careless UPDATE is caught by
      // Postgres itself, not by us trying to parse the SQL.
      return this.prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
        await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT}'`);
        const rows = (await tx.$queryRawUnsafe<Record<string, unknown>[]>(statement)) ?? [];
        return this.shape(rows, false);
      });
    }

    // Write mode: run (and auto-commit) the statement. For a statement that
    // returns rows (e.g. UPDATE ... RETURNING) use queryRaw; otherwise
    // executeRaw gives the affected-row count.
    const returnsRows = /\breturning\b/i.test(statement) || /^\s*(select|with|table|show|explain)\b/i.test(statement);
    if (returnsRows) {
      const rows = (await this.prisma.$queryRawUnsafe<Record<string, unknown>[]>(statement)) ?? [];
      return this.shape(rows, true);
    }
    const affected = await this.prisma.$executeRawUnsafe(statement);
    return { columns: [], rows: [], rowCount: affected, truncated: false, write: true, message: `${affected} ligne(s) affectée(s).` };
  }

  private shape(rows: Record<string, unknown>[], write: boolean): SqlResult {
    const truncated = rows.length > ROW_CAP;
    const capped = truncated ? rows.slice(0, ROW_CAP) : rows;
    // BigInt (e.g. COUNT(*)) and Date aren't JSON-serializable as-is.
    const safe = capped.map((r) =>
      Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v])),
    );
    return { columns: safe.length ? Object.keys(safe[0]) : [], rows: safe, rowCount: safe.length, truncated, write };
  }
}
