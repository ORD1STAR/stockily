import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { GenerateLabelDto } from './dto/generate-label.dto';

// Scan is an input-method concern, not a distinct domain (Action Plan
// §1/§3/§7 milestone 5) — it has no @org/domain-scan package. The actual
// stock movement / batch creation / quality check that a scan triggers go
// straight through Stock's and Quality's own existing endpoints
// (POST /stock/movements with relatedEntityType: 'scan', POST
// /quality/batches, POST /quality/checks) from the frontend — this
// service's only job is label generation/lookup and resolving a scanned
// code back to a product, both of which are genuinely Scan's own concern
// and don't belong in Stock or Quality.
@Injectable()
export class ScanService {
  constructor(private readonly prisma: PrismaService) {}

  async generateLabel(orgId: string, dto: GenerateLabelDto) {
    let codeValue: string;
    if (dto.productId) {
      const product = await this.prisma.product.findFirst({ where: { id: dto.productId, orgId } });
      if (!product) throw new NotFoundException(`Unknown product: ${dto.productId}`);
      codeValue = product.sku;
    } else {
      const batch = await this.prisma.batch.findFirst({ where: { id: dto.batchId, orgId } });
      if (!batch) throw new NotFoundException(`Unknown batch: ${dto.batchId}`);
      codeValue = batch.lotNumber;
    }

    const existing = await this.prisma.barcodeLabel.findUnique({ where: { orgId_codeValue: { orgId, codeValue } } });
    if (existing) return existing; // a product/batch's code is stable — regenerating just returns the same label, not a duplicate

    return this.prisma.barcodeLabel.create({
      data: {
        orgId,
        productId: dto.productId ?? null,
        batchId: dto.batchId ?? null,
        codeValue,
        symbology: dto.symbology ?? 'QR',
      },
    });
  }

  listLabels(orgId: string, productId?: string) {
    return this.prisma.barcodeLabel.findMany({
      where: { orgId, ...(productId ? { productId } : {}) },
      include: { product: { select: { sku: true, name: true } }, batch: { select: { lotNumber: true } } },
      orderBy: { codeValue: 'asc' },
    });
  }

  async recordPrint(orgId: string, id: string) {
    const label = await this.prisma.barcodeLabel.findFirst({ where: { id, orgId } });
    if (!label) throw new NotFoundException(`Unknown label: ${id}`);
    return this.prisma.barcodeLabel.update({ where: { id }, data: { printedCount: { increment: 1 } } });
  }

  /**
   * Resolves a scanned/typed code to a product, the way it would arrive
   * from a real device: a camera read, a USB/Bluetooth keyboard-wedge
   * scanner (which just types the code into a text field), or a person
   * typing it manually — all three end up here as a plain string,
   * indistinguishable from one another (Action Plan §4's scan-scope note).
   * Three fallbacks, in order, since a label may not have been formally
   * "generated" yet even though the code printed on the box (a SKU or a
   * lot number) is already meaningful:
   *  1. An existing BarcodeLabel for this exact code.
   *  2. The code IS a product's SKU.
   *  3. The code IS a batch's lot number (resolves to that batch's product).
   */
  async resolveCode(orgId: string, code: string) {
    const label = await this.prisma.barcodeLabel.findUnique({
      where: { orgId_codeValue: { orgId, codeValue: code } },
      include: { product: true, batch: true },
    });
    if (label?.product) return this.buildResolution(orgId, label.product, label.batch ?? undefined);

    const bySku = await this.prisma.product.findUnique({ where: { orgId_sku: { orgId, sku: code } } });
    if (bySku) return this.buildResolution(orgId, bySku);

    const byLot = await this.prisma.batch.findFirst({ where: { orgId, lotNumber: code }, include: { product: true } });
    if (byLot) return this.buildResolution(orgId, byLot.product, byLot);

    throw new NotFoundException({
      statusCode: 404,
      error: 'code_not_recognized',
      message: `Code non reconnu : ${code}. Recherchez le produit manuellement.`,
    });
  }

  private async buildResolution(orgId: string, product: { id: string; sku: string; name: string; isLotTracked: boolean }, matchedBatch?: { id: string; lotNumber: string; expiryDate: Date | null }) {
    // FEFO suggestion for an OUT/TRANSFER flow: the earliest-expiring batch
    // still in active status. A UI suggestion only, not authoritative —
    // Stock's own negative-stock check is what actually protects the
    // ledger regardless of which batch ends up chosen (Action Plan §5's
    // "scan just calls the existing stock-movement endpoint" principle).
    const suggestedBatch = product.isLotTracked
      ? await this.prisma.batch.findFirst({
          where: { orgId, productId: product.id, status: 'active' },
          orderBy: [{ expiryDate: { sort: 'asc', nulls: 'last' } }],
          select: { id: true, lotNumber: true, expiryDate: true },
        })
      : null;

    return {
      product: { id: product.id, sku: product.sku, name: product.name, isLotTracked: product.isLotTracked },
      matchedBatch: matchedBatch ? { id: matchedBatch.id, lotNumber: matchedBatch.lotNumber, expiryDate: matchedBatch.expiryDate } : null,
      suggestedBatch,
    };
  }
}
