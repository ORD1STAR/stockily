import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StockService } from '../stock/stock.service';
import { CreateSiteDto } from './dto/create-site.dto';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { UpdateTransferDto } from './dto/update-transfer.dto';

@Injectable()
export class SitesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
  ) {}

  async createSite(orgId: string, dto: CreateSiteDto) {
    return this.prisma.site.create({ data: { orgId, name: dto.name, address: dto.address ?? null } });
  }

  async listSites(orgId: string) {
    return this.prisma.site.findMany({ where: { orgId }, orderBy: { name: 'asc' } });
  }

  /**
   * Creates the tracking record AND moves the ledger atomically (both legs)
   * via StockService — StockTransfer.status starts 'in_transit' since the
   * stock has, per this milestone's simplified model, already left the
   * source site by the time the record exists (see CreateTransferDto's own
   * comment). Reuses StockService.recordMovement rather than constructing
   * @org/domain-stock's StockMovementService itself — StockService is the
   * only thing in apps/api allowed to do that (stock.service.ts).
   */
  async createTransfer(orgId: string, performedBy: string, dto: CreateTransferDto) {
    if (dto.fromSiteId === dto.toSiteId) {
      throw new BadRequestException('fromSiteId and toSiteId must differ');
    }

    const transfer = await this.prisma.stockTransfer.create({
      data: { orgId, fromSiteId: dto.fromSiteId, toSiteId: dto.toSiteId, status: 'in_transit' },
    });

    try {
      await this.stock.recordMovement(orgId, performedBy, {
        productId: dto.productId,
        siteId: dto.fromSiteId,
        toSiteId: dto.toSiteId,
        type: 'TRANSFER',
        quantity: dto.quantity,
        batchId: dto.batchId,
        relatedEntityType: 'stock_transfer',
        relatedEntityId: transfer.id,
      });
    } catch (err) {
      // The transfer record and its ledger legs must agree — if the ledger
      // move failed (e.g. not enough stock at the source; StockService has
      // already translated that into a BadRequestException/NotFoundException
      // by this point), don't leave a dangling StockTransfer row implying
      // stock moved when it didn't.
      await this.prisma.stockTransfer.delete({ where: { id: transfer.id } });
      throw err;
    }

    return transfer;
  }

  async listTransfers(orgId: string) {
    return this.prisma.stockTransfer.findMany({
      where: { orgId },
      include: { fromSite: { select: { name: true } }, toSite: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Note: unlike Stock's movement/product endpoints, this isn't
  // site-scoped by SiteScopeGuard (the route param is a transfer id, not a
  // siteId — the guard has nothing to match against) — any user with
  // `sites.transfer.update` can update any of their org's transfers
  // regardless of which site(s) they're personally scoped to. Flagged as a
  // known gap in docs/MILESTONE_2.md, not silently accepted.
  async updateTransfer(orgId: string, transferId: string, dto: UpdateTransferDto) {
    const existing = await this.prisma.stockTransfer.findFirst({ where: { id: transferId, orgId } });
    if (!existing) throw new NotFoundException(`Unknown transfer: ${transferId}`);

    return this.prisma.stockTransfer.update({
      where: { id: transferId },
      data: {
        ...(dto.status ? { status: dto.status } : {}),
        ...(dto.driverName !== undefined ? { driverName: dto.driverName } : {}),
        ...(dto.driverPhone !== undefined ? { driverPhone: dto.driverPhone } : {}),
        ...(dto.vehicleRef !== undefined ? { vehicleRef: dto.vehicleRef } : {}),
      },
    });
  }
}
