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
   * Creates the tracking record only — the ledger move (both legs,
   * atomically) is deferred to updateTransfer, firing once, exactly when
   * the transfer is marked 'delivered'. Previously the movement fired here,
   * at creation, with status forced to 'in_transit' regardless of what the
   * caller asked for: the destination site's stock became available
   * immediately, before the goods had physically arrived, while the
   * transfer's own status still said "en transit" — a real, visible
   * contradiction found by creating a transfer and watching the
   * destination's stock count update instantly. status now defaults to the
   * schema's own 'prepared' and is purely a logistics/tracking value until
   * delivery.
   */
  async createTransfer(orgId: string, performedBy: string, dto: CreateTransferDto) {
    if (dto.fromSiteId === dto.toSiteId) {
      throw new BadRequestException('fromSiteId and toSiteId must differ');
    }
    void performedBy; // no ledger move happens at creation anymore — kept in the signature for API stability

    return this.prisma.stockTransfer.create({
      data: {
        orgId,
        fromSiteId: dto.fromSiteId,
        toSiteId: dto.toSiteId,
        productId: dto.productId,
        quantity: dto.quantity,
        batchId: dto.batchId ?? null,
      },
    });
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
  async updateTransfer(orgId: string, performedBy: string, transferId: string, dto: UpdateTransferDto) {
    const existing = await this.prisma.stockTransfer.findFirst({ where: { id: transferId, orgId } });
    if (!existing) throw new NotFoundException(`Unknown transfer: ${transferId}`);

    // The ledger move happens exactly once, on the transition INTO
    // 'delivered' — checked against the transfer's own prior status, not
    // just "is the target status delivered", so re-saving driver/vehicle
    // info on an already-delivered transfer (dto.status: 'delivered' sent
    // again by a form that doesn't diff) never double-posts the movement.
    const isDeliveringNow = dto.status === 'delivered' && existing.status !== 'delivered';

    if (isDeliveringNow) {
      await this.stock.recordMovement(orgId, performedBy, {
        productId: existing.productId,
        siteId: existing.fromSiteId,
        toSiteId: existing.toSiteId,
        type: 'TRANSFER',
        quantity: Number(existing.quantity),
        batchId: existing.batchId,
        relatedEntityType: 'stock_transfer',
        relatedEntityId: existing.id,
      });
    }

    return this.prisma.stockTransfer.update({
      where: { id: transferId },
      data: {
        ...(dto.status ? { status: dto.status } : {}),
        ...(isDeliveringNow ? { deliveredAt: new Date() } : {}),
        ...(dto.driverName !== undefined ? { driverName: dto.driverName } : {}),
        ...(dto.driverPhone !== undefined ? { driverPhone: dto.driverPhone } : {}),
        ...(dto.vehicleRef !== undefined ? { vehicleRef: dto.vehicleRef } : {}),
      },
    });
  }
}
