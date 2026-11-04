import { Prisma } from '@prisma/client';

/**
 * Next number for a bon / proforma (BL-2026-000001, RC-…, RF-…, BR-…, PF-…),
 * per org, year and document type — same atomic upsert as the invoice and
 * sales-order counters, so two concurrent bons never get the same number.
 */
export async function nextDocumentNumber(tx: Prisma.TransactionClient, orgId: string, docType: string, prefix: string): Promise<string> {
  const year = new Date().getFullYear();
  const rows = await tx.$queryRaw<{ lastNumber: number }[]>`
    INSERT INTO "document_counters" ("orgId", "year", "docType", "lastNumber")
    VALUES (${orgId}, ${year}, ${docType}, 1)
    ON CONFLICT ("orgId", "year", "docType")
    DO UPDATE SET "lastNumber" = "document_counters"."lastNumber" + 1
    RETURNING "lastNumber"
  `;
  return `${prefix}-${year}-${String(rows[0].lastNumber).padStart(6, '0')}`;
}
