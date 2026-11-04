import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import {
  computeThresholdStatus,
  InsufficientQuarantineSourceError,
  InsufficientReservableStockError,
  NegativeStockError,
  QuarantineInput,
  RecordMovementInput,
  ReleaseInput,
  ReserveInput,
  StockMovementService,
  UnknownProductError,
} from '@org/domain-stock';
import { PrismaStockDataPort, setTenantOnTransaction } from '@org/infra-db';
import { PrismaService } from '../../prisma/prisma.service';
import { SiteAccessService } from '../tenancy/services/site-access.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { CreateInventoryAdjustmentDto } from './dto/create-inventory-adjustment.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { RecordMovementDto } from './dto/record-movement.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { SetVariantsDto } from './dto/set-variants.dto';

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

  // No unique constraint exists on (orgId, name) — this used to insert
  // unconditionally, so the "Nouveau produit" modal's free-text "nouvelle
  // catégorie" field (shown right next to an "existing category" dropdown)
  // could silently create a second, indistinguishable "Produits Laitiers"
  // row the moment someone typed a name that already existed. Two real
  // products then sit in "the same" category by name but are actually
  // split across rows in the data model, with no merge path anywhere in
  // the UI. Found by reusing a category name while adding new products.
  // Case-insensitive reuse here is cheaper and safer than a DB constraint
  // (which would need a migration + conflict-handling everywhere this is
  // called) for what is, in practice, a small, rarely-changing list.
  async createCategory(orgId: string, dto: CreateCategoryDto) {
    const name = dto.name.trim();
    const existing = await this.prisma.productCategory.findFirst({
      where: { orgId, name: { equals: name, mode: 'insensitive' } },
    });
    if (existing) return existing;
    return this.prisma.productCategory.create({ data: { orgId, name, parentId: dto.parentId ?? null } });
  }

  async listCategories(orgId: string) {
    return this.prisma.productCategory.findMany({ where: { orgId }, orderBy: { name: 'asc' } });
  }

  async createProduct(orgId: string, dto: CreateProductDto) {
    const existing = await this.prisma.product.findUnique({ where: { orgId_sku: { orgId, sku: dto.sku } } });
    if (existing) throw new ConflictException(`Cette référence est déjà utilisée : ${dto.sku}`);

    const barcode = dto.barcode?.trim() || null;
    if (barcode) await this.assertBarcodeAvailable(orgId, barcode);

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
        sellPrice: dto.sellPrice ?? null,
        sellPrice2: dto.sellPrice2 ?? null,
        unitsPerCarton: dto.unitsPerCarton ?? null,
        barcode,
      },
    });
  }

  async updateProduct(orgId: string, productId: string, dto: UpdateProductDto) {
    const updated = await this.updateSingleProduct(orgId, productId, dto);
    if (updated.variantSizes.length > 0 || updated.variantColors.length > 0) {
      // Prices, famille, seuils and carton size set on the modèle apply to all its variants.
      const shared = {
        ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId || null } : {}),
        ...(dto.minThreshold !== undefined ? { minThreshold: dto.minThreshold } : {}),
        ...(dto.maxThreshold !== undefined ? { maxThreshold: dto.maxThreshold } : {}),
        ...(dto.sellPrice !== undefined ? { sellPrice: dto.sellPrice } : {}),
        ...(dto.sellPrice2 !== undefined ? { sellPrice2: dto.sellPrice2 } : {}),
        ...(dto.unitsPerCarton !== undefined ? { unitsPerCarton: dto.unitsPerCarton } : {}),
        ...(dto.isLotTracked !== undefined ? { isLotTracked: dto.isLotTracked } : {}),
      };
      if (Object.keys(shared).length) await this.prisma.product.updateMany({ where: { orgId, parentId: productId, deletedAt: null }, data: shared });
    }
    return updated;
  }

  private async updateSingleProduct(orgId: string, productId: string, dto: UpdateProductDto) {
    const existing = await this.prisma.product.findFirst({ where: { id: productId, orgId } });
    if (!existing) throw new NotFoundException(`Produit inconnu : ${productId}`);

    const barcode = dto.barcode !== undefined ? dto.barcode.trim() || null : undefined;
    if (barcode) await this.assertBarcodeAvailable(orgId, barcode, productId);

    // Turning lot-tracking OFF once the product already has batches would
    // orphan them from the UI that shows them (Quality's batch list, Scan's
    // FEFO suggestion, this product's own "Lots" section) — the batches
    // themselves would still exist, just made invisible through every path
    // that gates on this flag. Turning it ON has no such risk: nothing
    // reads isLotTracked to enforce anything at the domain level (grep
    // confirms — it's a display flag, not a data-integrity constraint), so
    // the common real case this exists for — "forgot to check the box when
    // creating the product, want to fix that" — is never blocked.
    if (dto.isLotTracked === false && existing.isLotTracked) {
      const hasBatches = await this.prisma.batch.findFirst({ where: { productId }, select: { id: true } });
      if (hasBatches) {
        throw new ConflictException(
          'Impossible de désactiver le suivi par lot : ce produit a déjà des lots enregistrés.',
        );
      }
    }

    return this.prisma.product.update({
      where: { id: productId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId || null } : {}),
        ...(dto.isLotTracked !== undefined ? { isLotTracked: dto.isLotTracked } : {}),
        ...(dto.minThreshold !== undefined ? { minThreshold: dto.minThreshold } : {}),
        ...(dto.maxThreshold !== undefined ? { maxThreshold: dto.maxThreshold } : {}),
        ...(dto.sellPrice !== undefined ? { sellPrice: dto.sellPrice } : {}),
        ...(dto.sellPrice2 !== undefined ? { sellPrice2: dto.sellPrice2 } : {}),
        ...(dto.unitsPerCarton !== undefined ? { unitsPerCarton: dto.unitsPerCarton } : {}),
        ...(barcode !== undefined ? { barcode } : {}),
      },
    });
  }

  /**
   * Feeds the Stock product-detail "Supprimer" confirmation — every table
   * with a `productId` FK found across stock/quality/purchasing/sales/
   * invoicing (see schema.prisma), so the UI can warn what's actually
   * attached before a soft delete rather than the delete just silently
   * making history harder to find.
   */
  async getProductUsage(orgId: string, productId: string) {
    const product = await this.prisma.product.findFirst({ where: { id: productId, orgId, deletedAt: null }, select: { id: true } });
    if (!product) throw new NotFoundException(`Produit inconnu : ${productId}`);

    const [stockLevels, movements, batches, invoiceLines, purchaseOrderLines, purchaseReceiptLines, salesOrderLines, partnerPrices, qualityChecks, nonConformities] =
      await Promise.all([
        this.prisma.stockLevel.aggregate({ where: { productId }, _sum: { quantityOnHand: true } }),
        this.prisma.stockMovement.count({ where: { productId } }),
        this.prisma.batch.count({ where: { productId } }),
        this.prisma.invoiceLine.count({ where: { productId } }),
        this.prisma.purchaseOrderLine.count({ where: { productId, deletedAt: null } }),
        this.prisma.purchaseReceiptLine.count({ where: { productId } }),
        this.prisma.salesOrderLine.count({ where: { productId, deletedAt: null } }),
        this.prisma.partnerProductPrice.count({ where: { productId } }),
        this.prisma.qualityCheck.count({ where: { productId } }),
        this.prisma.nonConformity.count({ where: { productId } }),
      ]);

    return {
      stockOnHand: Number(stockLevels._sum.quantityOnHand ?? 0),
      stockMovements: movements,
      batches,
      invoiceLines,
      purchaseOrderLines,
      purchaseReceiptLines,
      salesOrderLines,
      partnerPrices,
      qualityChecks,
      nonConformities,
    };
  }

  /**
   * Soft delete only — never physical (too many FKs point at a product
   * across every module's history). The dependency warning is entirely
   * client-side (getProductUsage above, called before this) — this always
   * succeeds since it's non-destructive.
   */
  async softDeleteProduct(orgId: string, productId: string) {
    const existing = await this.prisma.product.findFirst({ where: { id: productId, orgId, deletedAt: null } });
    if (!existing) throw new NotFoundException(`Produit inconnu : ${productId}`);
    const now = new Date();
    await this.prisma.product.updateMany({ where: { orgId, parentId: productId, deletedAt: null }, data: { deletedAt: now } });
    return this.prisma.product.update({ where: { id: productId }, data: { deletedAt: now } });
  }

  // A friendly ConflictException instead of letting the DB's raw P2002
  // (`@@unique([orgId, barcode])`) surface — same pattern as the sku check
  // above. Scoped out the product being edited so re-saving a product's own
  // unchanged barcode doesn't self-conflict.
  private async assertBarcodeAvailable(orgId: string, barcode: string, excludingProductId?: string) {
    const clash = await this.prisma.product.findFirst({
      where: { orgId, barcode, ...(excludingProductId ? { id: { not: excludingProductId } } : {}) },
      select: { id: true, name: true },
    });
    if (clash) throw new ConflictException(`Ce code-barres est déjà utilisé par « ${clash.name} ».`);
  }

  /**
   * `siteId`: a concrete site id, or `'all'` for the consolidated
   * multi-site view (docs/Wireframes.html's "Tous les sites" toggle) — an
   * all-sites request is filtered down to what `userId` can actually see
   * (SiteAccessService), not the whole org, when the caller isn't org-wide.
   */
  /**
   * Tailles / couleurs. Creates one variant (child product) per combination,
   * re-activates previously removed ones, and removes combinations no longer
   * listed — refused if such a variant still has stock. The modèle's prices,
   * famille, seuils and carton size are copied onto new variants.
   */
  async setVariants(orgId: string, productId: string, dto: SetVariantsDto) {
    const clean = (list: string[]) => Array.from(new Set(list.map((x) => x.trim()).filter(Boolean)));
    const sizes = clean(dto.sizes);
    const colors = clean(dto.colors);
    const product = await this.prisma.product.findFirst({
      where: { id: productId, orgId, deletedAt: null },
      include: { stockLevels: true, variants: { include: { stockLevels: true } } },
    });
    if (!product) throw new NotFoundException(`Produit inconnu : ${productId}`);
    if (product.parentId) throw new BadRequestException('Une variante ne peut pas avoir ses propres variantes.');
    const wasParent = product.variantSizes.length > 0 || product.variantColors.length > 0;
    if (!wasParent && (sizes.length || colors.length) && product.stockLevels.some((l) => Number(l.quantityOnHand) !== 0)) {
      throw new BadRequestException('Ce produit a du stock : mettez-le à 0 (ou faites un inventaire) avant d’activer les tailles/couleurs.');
    }

    const combos: { size: string | null; color: string | null }[] = [];
    if (sizes.length && colors.length) for (const c of colors) for (const z of sizes) combos.push({ size: z, color: c });
    else if (sizes.length) for (const z of sizes) combos.push({ size: z, color: null });
    else if (colors.length) for (const c of colors) combos.push({ size: null, color: c });
    const key = (size: string | null, color: string | null) => `${color ?? ''}|${size ?? ''}`;
    const wanted = new Set(combos.map((c) => key(c.size, c.color)));

    const toRemove = product.variants.filter((v) => !v.deletedAt && !wanted.has(key(v.size, v.color)));
    const blocked = toRemove.filter((v) => v.stockLevels.some((l) => Number(l.quantityOnHand) !== 0));
    if (blocked.length) {
      throw new BadRequestException(`Impossible de retirer ${blocked.map((v) => v.name).join(', ')} : il reste du stock.`);
    }

    const slug = (x: string) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '').toUpperCase().slice(0, 12);
    const label = (c: { size: string | null; color: string | null }) => [c.color, c.size].filter(Boolean).join(' / ');

    await this.prisma.$transaction(async (tx) => {
      await setTenantOnTransaction(tx, orgId);
      for (const v of toRemove) await tx.product.update({ where: { id: v.id }, data: { deletedAt: new Date() } });
      for (const c of combos) {
        const existing = product.variants.find((v) => key(v.size, v.color) === key(c.size, c.color));
        if (existing) {
          if (existing.deletedAt) await tx.product.update({ where: { id: existing.id }, data: { deletedAt: null } });
          continue;
        }
        let sku = [product.sku, c.color ? slug(c.color) : null, c.size ? slug(c.size) : null].filter(Boolean).join('-');
        for (let n = 2; await tx.product.findUnique({ where: { orgId_sku: { orgId, sku } } }); n++) sku = `${sku.replace(/-\d+$/, '')}-${n}`;
        await tx.product.create({
          data: {
            orgId,
            parentId: product.id,
            size: c.size,
            color: c.color,
            sku,
            name: `${product.name} ${label(c)}`,
            categoryId: product.categoryId,
            unitOfMeasure: product.unitOfMeasure,
            isLotTracked: product.isLotTracked,
            minThreshold: product.minThreshold,
            maxThreshold: product.maxThreshold,
            sellPrice: product.sellPrice,
            sellPrice2: product.sellPrice2,
            unitsPerCarton: product.unitsPerCarton,
          },
        });
      }
      await tx.product.update({ where: { id: product.id }, data: { variantSizes: sizes, variantColors: colors } });
    });
    return this.getProductDetail(orgId, productId);
  }

  async listProducts(orgId: string, userId: string, siteId: string, includeParents = false) {
    const siteFilter =
      siteId === 'all'
        ? await this.resolveAllSitesFilter(orgId, userId)
        : { id: siteId };

    // A `StockLevel` row is only created on a product's first movement at a
    // site (getOrCreateStockLevel) — a brand-new product, or an existing
    // one that's simply never been received at a given site, has none yet.
    // Mapping straight over `stockLevels` (as this used to) silently drops
    // such a product from the response entirely: it never appears in the
    // table, and "+ Nouveau mouvement" — disabled whenever this list comes
    // back empty — can never be opened to receive its first stock. A real
    // dead end, found by actually creating a fresh product on a fresh org
    // and watching both the table and the button stay empty/disabled.
    // Fetching the candidate sites explicitly and synthesizing a
    // zero-quantity row for any (product, site) pair with no ledger
    // history yet fixes this — it's the same "0, Rupture" state a product
    // with an actual zero-valued StockLevel row already renders as.
    const sites = await this.prisma.site.findMany({ where: siteFilter, select: { id: true, name: true } });

    // A "modèle" (product with tailles/couleurs) holds no stock: product
    // pickers only get its variants; the Stock page asks for both and groups them.
    const products = await this.prisma.product.findMany({
      where: {
        orgId,
        deletedAt: null,
        ...(includeParents ? {} : { variantSizes: { isEmpty: true }, variantColors: { isEmpty: true } }),
      },
      include: {
        category: { select: { name: true } },
        stockLevels: { where: { site: siteFilter }, include: { site: { select: { id: true, name: true } } } },
      },
      orderBy: { name: 'asc' },
    });

    // A modèle's own row shows the total of its variants at that site.
    const childTotals = new Map<string, { onHand: number; reserved: number; quarantined: number }>();
    for (const p of products) {
      if (!p.parentId) continue;
      for (const level of p.stockLevels) {
        const k = `${p.parentId}|${level.site.id}`;
        const t = childTotals.get(k) ?? { onHand: 0, reserved: 0, quarantined: 0 };
        t.onHand += Number(level.quantityOnHand);
        t.reserved += Number(level.quantityReserved);
        t.quarantined += Number(level.quantityQuarantined);
        childTotals.set(k, t);
      }
    }
    return products.flatMap((p) => {
      const levelBySiteId = new Map(p.stockLevels.map((level) => [level.site.id, level]));
      return sites.map((site) => {
        const level = levelBySiteId.get(site.id);
        const isModel = p.variantSizes.length > 0 || p.variantColors.length > 0;
        const totals = isModel ? childTotals.get(`${p.id}|${site.id}`) : undefined;
        const quantityOnHand = isModel ? (totals?.onHand ?? 0) : level ? Number(level.quantityOnHand) : 0;
        const quantityQuarantined = isModel ? (totals?.quarantined ?? 0) : level ? Number(level.quantityQuarantined) : 0;
        const quantityReserved = isModel ? (totals?.reserved ?? 0) : level ? Number(level.quantityReserved) : 0;
        const averageCost = Number(p.averageCost);
        const sellPrice = p.sellPrice != null ? Number(p.sellPrice) : null;
        const sellPrice2 = p.sellPrice2 != null ? Number(p.sellPrice2) : null;
        return {
          productId: p.id,
          parentId: p.parentId,
          size: p.size,
          color: p.color,
          isVariantParent: p.variantSizes.length > 0 || p.variantColors.length > 0,
          sku: p.sku,
          name: p.name,
          barcode: p.barcode,
          category: p.category?.name ?? null,
          isLotTracked: p.isLotTracked,
          unitsPerCarton: p.unitsPerCarton,
          site,
          quantityOnHand,
          quantityQuarantined,
          quantityReserved,
          minThreshold: p.minThreshold != null ? Number(p.minThreshold) : null,
          averageCost,
          sellPrice,
          sellPrice2,
          // Marge en DA = prix de vente − prix d'achat (coût moyen pondéré).
          margin1: sellPrice != null ? Math.round((sellPrice - averageCost) * 100) / 100 : null,
          margin2: sellPrice2 != null ? Math.round((sellPrice2 - averageCost) * 100) / 100 : null,
          status: computeThresholdStatus(quantityOnHand, p.minThreshold != null ? Number(p.minThreshold) : null),
        };
      });
    });
  }

  /** For a `siteId=all` request, narrows the query to the sites `userId` can see — an org-wide role sees every site, a site-scoped role only their own (§2 permission model; PermissionGuard/SiteScopeGuard already let the *request* itself through, this is what stops it from *returning* more rows than the caller is entitled to). */
  private async resolveAllSitesFilter(orgId: string, userId: string) {
    const accessible = await this.siteAccess.getAccessibleSiteIds(userId, orgId);
    if (accessible === 'all') return { orgId };
    return { orgId, id: { in: accessible } };
  }

  async getProductDetail(orgId: string, productId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, orgId, deletedAt: null },
      include: {
        category: { select: { name: true } },
        stockLevels: { include: { site: { select: { id: true, name: true } } } },
        parent: { select: { id: true, name: true, sku: true } },
        variants: {
          where: { deletedAt: null },
          include: { stockLevels: { select: { quantityOnHand: true, quantityReserved: true } } },
          orderBy: [{ color: 'asc' }, { size: 'asc' }],
        },
      },
    });
    if (!product) throw new NotFoundException(`Produit inconnu : ${productId}`);

    return {
      id: product.id,
      parent: product.parent,
      size: product.size,
      color: product.color,
      variantSizes: product.variantSizes,
      variantColors: product.variantColors,
      variants: product.variants.map((v) => ({
        id: v.id,
        sku: v.sku,
        name: v.name,
        size: v.size,
        color: v.color,
        barcode: v.barcode,
        sellPrice: v.sellPrice != null ? Number(v.sellPrice) : null,
        sellPrice2: v.sellPrice2 != null ? Number(v.sellPrice2) : null,
        quantityOnHand: v.stockLevels.reduce((s, l) => s + Number(l.quantityOnHand), 0),
        quantityReserved: v.stockLevels.reduce((s, l) => s + Number(l.quantityReserved), 0),
      })),
      sku: product.sku,
      name: product.name,
      barcode: product.barcode,
      categoryId: product.categoryId,
      category: product.category?.name ?? null,
      isLotTracked: product.isLotTracked,
      unitsPerCarton: product.unitsPerCarton,
      averageCost: Number(product.averageCost),
      minThreshold: product.minThreshold != null ? Number(product.minThreshold) : null,
      maxThreshold: product.maxThreshold != null ? Number(product.maxThreshold) : null,
      sellPrice: product.sellPrice != null ? Number(product.sellPrice) : null,
      sellPrice2: product.sellPrice2 != null ? Number(product.sellPrice2) : null,
      levels: product.stockLevels.map((l) => ({
        site: l.site,
        quantityOnHand: Number(l.quantityOnHand),
        quantityQuarantined: Number(l.quantityQuarantined),
      })),
      // No `lots` field here (Milestone 2 had a `lots: null` placeholder).
      // Milestone 3: the frontend's SKU-detail modal fetches
      // GET /quality/batches?productId=<id> itself when isLotTracked is
      // true, rather than StockModule reaching into Quality's data —
      // avoids a StockModule -> QualityModule dependency (StockModule is
      // deliberately the one Quality depends on, not the reverse).
    };
  }

  async recordMovement(orgId: string, performedBy: string, dto: RecordMovementDto) {
    const target = await this.prisma.product.findFirst({ where: { id: dto.productId, orgId }, select: { variantSizes: true, variantColors: true } });
    if (target && (target.variantSizes.length > 0 || target.variantColors.length > 0)) {
      throw new BadRequestException('Ce produit a des tailles/couleurs : choisissez une variante.');
    }
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

  /**
   * The one entry point Quality (and, later, anything else) uses to
   * reclassify already-on-hand quantity as quarantined — see
   * docs/Action Plan.md §1/§5/§6 and domain-quality's own doc comment on why
   * it returns quarantineTargets as data instead of calling this itself:
   * StockService is the only thing in apps/api allowed to construct
   * StockMovementService, same rule as recordMovement/createInventoryAdjustment
   * above, so Quality's orchestration goes through this method rather than
   * building its own StockMovementService.
   */
  async quarantine(input: QuarantineInput) {
    try {
      const result = await this.movementService().quarantine(input);
      this.publish(result.events);
      return result;
    } catch (err) {
      throw this.translateQuarantineError(err);
    }
  }

  /**
   * The one entry point Gestion Ventes uses to earmark stock against a
   * commande (Milestone 10) — same rule as quarantine/recordMovement
   * above, StockService is the only thing in apps/api allowed to
   * construct StockMovementService. Strict-path failures
   * (`InsufficientReservableStockError`) become a 409, not a 400 — Ventes'
   * preview-then-confirm flow uses the distinct status to mean "needs a
   * decision", not "malformed/invalid request".
   */
  async reserve(input: ReserveInput) {
    try {
      const result = await this.movementService().reserve(input);
      this.publish(result.events);
      return result;
    } catch (err) {
      throw this.translateReserveError(err);
    }
  }

  async release(input: ReleaseInput) {
    try {
      const result = await this.movementService().release(input);
      this.publish(result.events);
      return result;
    } catch (err) {
      throw this.translateDomainError(err);
    }
  }

  /** Same transaction-composition rationale as recordMovementInTransaction — finalizeInvoice releases a commande's reservation atomically alongside its own number assignment + OUT movement. */
  async releaseInTransaction(tx: Prisma.TransactionClient, input: ReleaseInput) {
    try {
      return await new StockMovementService(new PrismaStockDataPort(tx)).release(input);
    } catch (err) {
      throw this.translateDomainError(err);
    }
  }

  /** Same transaction-composition rationale — SalesService.createSalesOrder reserves every product line atomically alongside the SalesOrder/lines it just created: a shortage on any one line (allowBackorder false) rolls back the whole order, nothing partially reserved. */
  async reserveInTransaction(tx: Prisma.TransactionClient, input: ReserveInput) {
    try {
      return await new StockMovementService(new PrismaStockDataPort(tx)).reserve(input);
    } catch (err) {
      throw this.translateReserveError(err);
    }
  }

  private translateReserveError(err: unknown): Error {
    if (err instanceof InsufficientReservableStockError) {
      return new ConflictException({
        statusCode: 409,
        error: 'insufficient_reservable_stock',
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

  private translateQuarantineError(err: unknown): Error {
    if (err instanceof InsufficientQuarantineSourceError) {
      return new BadRequestException({
        statusCode: 400,
        error: 'insufficient_quarantine_source',
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

  /**
   * Cross-module composed-transaction variant (Action Plan §5) — for a
   * caller (Invoicing's finalize, first) that needs a stock movement to
   * commit-or-rollback atomically together with ITS OWN writes in the same
   * DB transaction (e.g. assigning the invoice number + deducting stock for
   * every line must be all-or-nothing). `recordMovement()` above always
   * opens its own independent transaction via the root PrismaService — it
   * is NOT suitable for this; calling it from inside another transaction
   * would silently run as a second, unrelated transaction against a
   * different connection, breaking atomicity rather than composing with
   * it. This variant takes the caller's own already-open
   * `Prisma.TransactionClient` and participates in it directly:
   * `PrismaStockDataPort.withTransaction` detects it's already a
   * transaction client (no `$transaction` method of its own) and reuses it
   * rather than trying to open a nested one.
   *
   * Events are RETURNED, not published — the caller must call
   * `publishEvents()` itself only AFTER its own transaction has actually
   * committed. Publishing before commit would announce a movement over the
   * websocket gateway that might still be rolled back if a later step in
   * the caller's transaction fails.
   */
  async recordMovementInTransaction(
    tx: Prisma.TransactionClient,
    orgId: string,
    performedBy: string | null,
    input: Omit<RecordMovementInput, 'orgId' | 'performedBy'>,
  ) {
    try {
      return await new StockMovementService(new PrismaStockDataPort(tx)).recordMovement({
        orgId,
        performedBy: performedBy ?? undefined,
        ...input,
      });
    } catch (err) {
      throw this.translateDomainError(err);
    }
  }

  /** Same transaction-composition rationale as recordMovementInTransaction, for Quality's future quarantine-on-fail flow. */
  async quarantineInTransaction(tx: Prisma.TransactionClient, input: QuarantineInput) {
    try {
      return await new StockMovementService(new PrismaStockDataPort(tx)).quarantine(input);
    } catch (err) {
      throw this.translateDomainError(err);
    }
  }

  /** Publishes previously-collected events — see recordMovementInTransaction's own comment on why this is a separate step rather than automatic. */
  publishEvents(events: { kind: string }[]): void {
    this.publish(events);
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
