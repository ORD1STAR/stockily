import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  computeThresholdStatus,
  NegativeStockError,
  RecordMovementInput,
  StockMovementService,
  UnknownProductError,
} from '@org/domain-stock';
import { PrismaStockDataPort } from '@org/infra-db';
import { PrismaService } from '../../prisma/prisma.service';
import { SiteAccessService } from '../tenancy/services/site-access.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { CreateInventoryAdjustmentDto } from './dto/create-inventory-adjustment.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { RecordMovementDto } from './dto/record-movement.dto';

// Thin NestJS wrapper around @org/domain-stock's StockMovementService — this
// class is the ONLY thing in apps/api allowed to construct that service
// (docs/Action Plan.md §1/§5/§6): every controller/other module goes through
// StockService, never StockMovementService directly, so the Prisma wiring
// and event publication stay in exactly one place.
@Injectable()
export class StockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
    private readonly siteAccess: SiteAccessService,
  ) {}

  private movementService(): StockMovementService {
    return new StockMovementService(new PrismaStockDataPort(this.prisma));
  }

  async createCategory(orgId: string, dto: CreateCategoryDto) {
    return this.prisma.productCategory.create({ data: { orgId, name: dto.name, parentId: dto.parentId ?? null } });
  }

  async listCategories(orgId: string) {
    return this.prisma.productCategory.findMany({ where: { orgId }, orderBy: { name: 'asc' } });
  }

  async createProduct(orgId: string, dto: CreateProductDto) {
    const existing = await this.prisma.product.findUnique({ where: { orgId_sku: { orgId, sku: dto.sku } } });
    if (existing) throw new ConflictException(`SKU already in use: ${dto.sku}`);

    return this.prisma.product.create({
      data: {
        orgId,
        sku: dto.sku,
        name: dto.name,
        categoryId: dto.categoryId ?? null,
        unitOfMeasure: dto.unitOfMeasure ?? 'unit',
        isLotTracked: dto.isLotTracked ?? false,
        minThreshold: dto.minThreshold ?? null,
        maxThreshold: dto.maxThreshold ?? null,
      },
    });
  }

  /**
   * `siteId`: a concrete site id, or `'all'` for the consolidated
   * multi-site view (docs/Wireframes.html's "Tous les sites" toggle) — an
   * all-sites request is filtered down to what `userId` can actually see
   * (SiteAccessService), not the whole org, when the caller isn't org-wide.
   */
  async listProducts(orgId: string, userId: string, siteId: string) {
    const siteFilter =
      siteId === 'all'
        ? await this.resolveAllSitesFilter(orgId, userId)
        : { id: siteId };

    const products = await this.prisma.product.findMany({
      where: { orgId },
      include: {
        category: { select: { name: true } },
        stockLevels: { where: { site: siteFilter }, include: { site: { select: { id: true, name: true } } } },
      },
      orderBy: { name: 'asc' },
    });

    return products.flatMap((p) =>
      p.stockLevels.map((level) => ({
        productId: p.id,
        sku: p.sku,
        name: p.name,
        category: p.category?.name ?? null,
        isLotTracked: p.isLotTracked,
        site: level.site,
        quantityOnHand: Number(level.quantityOnHand),
        quantityQuarantined: Number(level.quantityQuarantined),
        minThreshold: p.minThreshold != null ? Number(p.minThreshold) : null,
        averageCost: Number(p.averageCost),
        status: computeThresholdStatus(Number(level.quantityOnHand), p.minThreshold != null ? Number(p.minThreshold) : null),
      })),
    );
  }

  /** For a `siteId=all` request, narrows the query to the sites `userId` can see — an org-wide role sees every site, a site-scoped role only their own (§2 permission model; PermissionGuard/SiteScopeGuard already let the *request* itself through, this is what stops it from *returning* more rows than the caller is entitled to). */
  private async resolveAllSitesFilter(orgId: string, userId: string) {
    const accessible = await this.siteAccess.getAccessibleSiteIds(userId, orgId);
    if (accessible === 'all') return { orgId };
    return { orgId, id: { in: accessible } };
  }

  async getProductDetail(orgId: string, productId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, orgId },
      include: { category: { select: { name: true } }, stockLevels: { include: { site: { select: { id: true, name: true } } } } },
    });
    if (!product) throw new NotFoundException(`Unknown product: ${productId}`);

    return {
      id: product.id,
      sku: product.sku,
      name: product.name,
      category: product.category?.name ?? null,
      isLotTracked: product.isLotTracked,
      averageCost: Number(product.averageCost),
      minThreshold: product.minThreshold != null ? Number(product.minThreshold) : null,
      maxThreshold: product.maxThreshold != null ? Number(product.maxThreshold) : null,
      levels: product.stockLevels.map((l) => ({
        site: l.site,
        quantityOnHand: Number(l.quantityOnHand),
        quantityQuarantined: Number(l.quantityQuarantined),
      })),
      // Quality doesn't exist yet this milestone — the frontend's SKU-detail
      // modal is expected to handle `lots: null` as "no quality data yet",
      // not an error, and a later milestone's Quality module is what
      // actually populates this the same way it populates the Quality panel.
      lots: null as null,
    };
  }

  async recordMovement(orgId: string, performedBy: string, dto: RecordMovementDto) {
    const input: RecordMovementInput = { orgId, performedBy, ...dto };
    try {
      const result = await this.movementService().recordMovement(input);
      this.publish(result.events);
      return result;
    } catch (err) {
      throw this.translateDomainError(err);
    }
  }

  async createInventoryAdjustment(orgId: string, performedBy: string, dto: CreateInventoryAdjustmentDto) {
    try {
      const result = await this.movementService().recordMovement({
        orgId,
        productId: dto.productId,
        siteId: dto.siteId,
        type: 'ADJUSTMENT',
        adjustmentDirection: dto.direction,
        quantity: dto.quantity,
        relatedEntityType: 'manual_adjustment',
        performedBy,
      });
      this.publish(result.events);
      return result;
    } catch (err) {
      throw this.translateDomainError(err);
    }
  }

  async listMovements(orgId: string, filters: { siteId?: string; productId?: string }) {
    return this.prisma.stockMovement.findMany({
      where: {
        orgId,
        ...(filters.siteId && filters.siteId !== 'all' ? { siteId: filters.siteId } : {}),
        ...(filters.productId ? { productId: filters.productId } : {}),
      },
      orderBy: { occurredAt: 'desc' },
      take: 200,
    });
  }

  private publish(events: { kind: string }[]): void {
    for (const event of events) this.events.emit(event.kind, event);
  }

  // The domain layer's typed errors (framework-agnostic, no HTTP status of
  // their own) become the specific Nest HTTP exceptions here — this
  // translation belongs at the API boundary, not inside @org/domain-stock.
  private translateDomainError(err: unknown): Error {
    if (err instanceof NegativeStockError) {
      return new BadRequestException({
        statusCode: 400,
        error: 'negative_stock',
        message: err.message,
        productId: err.productId,
        siteId: err.siteId,
        requested: err.requested,
        available: err.available,
      });
    }
    if (err instanceof UnknownProductError) {
      return new NotFoundException(err.message);
    }
    return err as Error;
  }
}
