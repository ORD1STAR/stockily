import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { setTenantOnTransaction } from '@org/infra-db';
import { PrismaService } from '../../prisma/prisma.service';
import { StockService } from '../stock/stock.service';
import { nextDocumentNumber } from '../invoicing/document-numbering';
import { DocumentPdfService, formatMoney } from '../shared-pdf/document-pdf.service';
import { CreateInventoryCountDto, ReminderFrequency, UpdateCountedLinesDto, ValidateInventoryDto } from './dto/inventory.dto';

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const MONTHS: Record<Exclude<ReminderFrequency, 'off' | 'weekly'>, number> = { monthly: 1, quarterly: 3, semiannual: 6, yearly: 12 };

export const REMINDER_LABEL: Record<ReminderFrequency, string> = {
  off: 'Désactivé',
  weekly: 'Toutes les semaines',
  monthly: 'Tous les mois',
  quarterly: 'Tous les 3 mois',
  semiannual: 'Tous les 6 mois',
  yearly: 'Une fois par an',
};

/** Next due date: the last validated inventory (or org creation) + the chosen period. */
export function computeDueAt(frequency: ReminderFrequency, since: Date): Date | null {
  if (frequency === 'off') return null;
  const d = new Date(since);
  if (frequency === 'weekly') d.setDate(d.getDate() + 7);
  else d.setMonth(d.getMonth() + MONTHS[frequency]);
  return d;
}

/**
 * Inventaires physiques. A count snapshots the book quantities of a dépôt;
 * quantities are entered progressively (draft, saved as you go); validating
 * re-reads the live stock and records one ADJUSTMENT per discrepancy so the
 * stock ends up exactly at the counted quantity.
 */
@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
    private readonly pdf: DocumentPdfService,
  ) {}

  async create(orgId: string, userId: string, dto: CreateInventoryCountDto) {
    const site = await this.prisma.site.findFirst({ where: { id: dto.siteId, orgId } });
    if (!site) throw new NotFoundException(`Dépôt inconnu : ${dto.siteId}`);
    const open = await this.prisma.inventoryCount.findFirst({ where: { orgId, siteId: dto.siteId, status: 'draft' } });
    if (open) throw new BadRequestException(`Un inventaire est déjà en cours sur ce dépôt (${open.number}) — terminez-le ou annulez-le d’abord.`);

    const products = await this.prisma.product.findMany({
      where: {
        orgId,
        deletedAt: null,
        ...(dto.scope === 'category' ? { categoryId: dto.categoryId } : {}),
        ...(dto.scope === 'selection' ? { id: { in: dto.productIds } } : {}),
      },
      include: { stockLevels: { where: { siteId: dto.siteId } } },
      orderBy: { name: 'asc' },
    });
    if (products.length === 0) throw new BadRequestException('Aucun produit à inventorier pour ce choix.');

    const created = await this.prisma.$transaction(async (tx) => {
      await setTenantOnTransaction(tx, orgId);
      const number = await nextDocumentNumber(tx, orgId, 'inventory', 'INV');
      return tx.inventoryCount.create({
        data: {
          orgId,
          siteId: dto.siteId,
          number,
          scope: dto.scope,
          categoryId: dto.scope === 'category' ? dto.categoryId ?? null : null,
          notes: dto.notes ?? null,
          createdBy: userId,
          lines: {
            create: products.map((p) => ({
              productId: p.id,
              systemQty: p.stockLevels[0] ? p.stockLevels[0].quantityOnHand : 0,
            })),
          },
        },
      });
    });
    return this.get(orgId, created.id);
  }

  async list(orgId: string) {
    const counts = await this.prisma.inventoryCount.findMany({
      where: { orgId },
      include: { site: { select: { id: true, name: true } }, lines: { select: { systemQty: true, countedQty: true, unitCost: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return counts.map((c) => {
      const counted = c.lines.filter((l) => l.countedQty != null);
      const discrepancies = counted.filter((l) => Number(l.countedQty) !== Number(l.systemQty));
      return {
        id: c.id,
        number: c.number,
        status: c.status,
        scope: c.scope,
        site: c.site,
        createdAt: c.createdAt,
        validatedAt: c.validatedAt,
        lineCount: c.lines.length,
        countedCount: counted.length,
        discrepancyCount: discrepancies.length,
        valueDifference:
          c.status === 'validated'
            ? round2(counted.reduce((s, l) => s + (Number(l.countedQty) - Number(l.systemQty)) * Number(l.unitCost), 0))
            : null,
      };
    });
  }

  async get(orgId: string, id: string) {
    const count = await this.prisma.inventoryCount.findFirst({
      where: { id, orgId },
      include: {
        site: { select: { id: true, name: true } },
        lines: {
          include: {
            product: {
              select: {
                id: true,
                sku: true,
                name: true,
                barcode: true,
                unitsPerCarton: true,
                averageCost: true,
                category: { select: { name: true } },
                stockLevels: { select: { siteId: true, quantityOnHand: true } },
              },
            },
          },
        },
      },
    });
    if (!count) throw new NotFoundException(`Inventaire inconnu : ${id}`);

    const lines = count.lines
      .map((l) => {
        // While counting, show the live book quantity (stock keeps moving); once validated, the frozen one.
        const live = l.product.stockLevels.find((s) => s.siteId === count.siteId);
        const systemQty = count.status === 'draft' ? Number(live?.quantityOnHand ?? 0) : Number(l.systemQty);
        const countedQty = l.countedQty != null ? Number(l.countedQty) : null;
        const unitCost = count.status === 'validated' ? Number(l.unitCost) : Number(l.product.averageCost);
        const difference = countedQty != null ? round3(countedQty - systemQty) : null;
        return {
          productId: l.productId,
          sku: l.product.sku,
          name: l.product.name,
          barcode: l.product.barcode,
          category: l.product.category?.name ?? null,
          unitsPerCarton: l.product.unitsPerCarton,
          systemQty,
          countedQty,
          difference,
          unitCost,
          valueDifference: difference != null ? round2(difference * unitCost) : null,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'));

    return {
      id: count.id,
      number: count.number,
      status: count.status,
      scope: count.scope,
      notes: count.notes,
      site: count.site,
      createdAt: count.createdAt,
      validatedAt: count.validatedAt,
      lines,
      summary: {
        lineCount: lines.length,
        countedCount: lines.filter((l) => l.countedQty != null).length,
        discrepancyCount: lines.filter((l) => l.difference != null && l.difference !== 0).length,
        valueDifference: round2(lines.reduce((s, l) => s + (l.valueDifference ?? 0), 0)),
      },
    };
  }

  /** Saves counted quantities (as you go). A product not in the count yet (e.g. found while scanning) is added. */
  async updateLines(orgId: string, id: string, dto: UpdateCountedLinesDto) {
    const count = await this.prisma.inventoryCount.findFirst({ where: { id, orgId }, include: { lines: { select: { productId: true } } } });
    if (!count) throw new NotFoundException(`Inventaire inconnu : ${id}`);
    if (count.status !== 'draft') throw new BadRequestException('Cet inventaire est clôturé.');
    const existing = new Set(count.lines.map((l) => l.productId));

    await this.prisma.$transaction(async (tx) => {
      await setTenantOnTransaction(tx, orgId);
      for (const l of dto.lines) {
        if (existing.has(l.productId)) {
          await tx.inventoryCountLine.update({
            where: { countId_productId: { countId: id, productId: l.productId } },
            data: { countedQty: l.countedQty },
          });
        } else {
          const product = await tx.product.findFirst({
            where: { id: l.productId, orgId, deletedAt: null },
            include: { stockLevels: { where: { siteId: count.siteId } } },
          });
          if (!product) throw new NotFoundException(`Produit inconnu : ${l.productId}`);
          await tx.inventoryCountLine.create({
            data: { countId: id, productId: product.id, systemQty: product.stockLevels[0]?.quantityOnHand ?? 0, countedQty: l.countedQty },
          });
          existing.add(product.id);
        }
      }
    });
    return this.get(orgId, id);
  }

  async validate(orgId: string, userId: string, id: string, dto: ValidateInventoryDto) {
    const count = await this.prisma.inventoryCount.findFirst({ where: { id, orgId }, include: { lines: true } });
    if (!count) throw new NotFoundException(`Inventaire inconnu : ${id}`);
    if (count.status !== 'draft') throw new BadRequestException('Cet inventaire est déjà clôturé.');
    if (!dto.zeroUncounted && count.lines.every((l) => l.countedQty == null)) {
      throw new BadRequestException('Aucune quantité saisie.');
    }

    const events: { kind: string }[] = [];
    await this.prisma.$transaction(
      async (tx) => {
        await setTenantOnTransaction(tx, orgId);
        for (const line of count.lines) {
          const product = await tx.product.findUniqueOrThrow({ where: { id: line.productId }, select: { averageCost: true } });
          const level = await tx.stockLevel.findUnique({ where: { productId_siteId: { productId: line.productId, siteId: count.siteId } } });
          const current = Number(level?.quantityOnHand ?? 0);
          const counted = line.countedQty != null ? Number(line.countedQty) : dto.zeroUncounted ? 0 : null;

          await tx.inventoryCountLine.update({
            where: { id: line.id },
            data: { systemQty: current, unitCost: product.averageCost, countedQty: counted },
          });
          if (counted == null) continue;
          const diff = round3(counted - current);
          if (diff === 0) continue;
          const result = await this.stock.recordMovementInTransaction(tx, orgId, userId, {
            productId: line.productId,
            siteId: count.siteId,
            type: 'ADJUSTMENT',
            adjustmentDirection: diff > 0 ? 'increase' : 'decrease',
            quantity: Math.abs(diff),
            relatedEntityType: 'inventory_count',
            relatedEntityId: count.id,
          });
          events.push(...result.events);
        }
        await tx.inventoryCount.update({ where: { id }, data: { status: 'validated', validatedAt: new Date(), validatedBy: userId } });
      },
      { timeout: 60_000 },
    );
    this.stock.publishEvents(events);
    return this.get(orgId, id);
  }

  async cancel(orgId: string, id: string) {
    const count = await this.prisma.inventoryCount.findFirst({ where: { id, orgId } });
    if (!count) throw new NotFoundException(`Inventaire inconnu : ${id}`);
    if (count.status !== 'draft') throw new BadRequestException('Seul un inventaire en cours peut être annulé.');
    await this.prisma.inventoryCount.update({ where: { id }, data: { status: 'cancelled' } });
    return this.get(orgId, id);
  }

  // ───────────────────────── Rappel ─────────────────────────

  async reminderStatus(orgId: string) {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { inventoryReminder: true, createdAt: true } });
    const last = await this.prisma.inventoryCount.findFirst({ where: { orgId, status: 'validated' }, orderBy: { validatedAt: 'desc' }, select: { validatedAt: true } });
    const inProgress = await this.prisma.inventoryCount.count({ where: { orgId, status: 'draft' } });
    const frequency = org.inventoryReminder as ReminderFrequency;
    const lastInventoryAt = last?.validatedAt ?? null;
    const dueAt = computeDueAt(frequency, lastInventoryAt ?? org.createdAt);
    const now = new Date();
    return {
      frequency,
      frequencyLabel: REMINDER_LABEL[frequency],
      lastInventoryAt,
      dueAt,
      isDue: !!dueAt && dueAt <= now,
      daysOverdue: dueAt && dueAt <= now ? Math.floor((now.getTime() - dueAt.getTime()) / 86_400_000) : 0,
      inProgress,
    };
  }

  async updateSettings(orgId: string, frequency: ReminderFrequency) {
    await this.prisma.organization.update({ where: { id: orgId }, data: { inventoryReminder: frequency, inventoryReminderLastSentAt: null } });
    return this.reminderStatus(orgId);
  }

  // ───────────────────────── Feuille de comptage / PV ─────────────────────────

  async generatePdf(orgId: string, id: string): Promise<Buffer> {
    const count = await this.get(orgId, id);
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
    const validated = count.status === 'validated';
    const qty = (n: number | null) => (n == null ? '' : String(n));
    return this.pdf.generate({
      title: validated ? 'PV D’INVENTAIRE' : 'FEUILLE DE COMPTAGE',
      number: count.number,
      date: validated && count.validatedAt ? count.validatedAt : count.createdAt,
      statusLabel: count.status === 'cancelled' ? 'Annulé' : validated ? 'Validé' : 'En cours',
      org: { name: org.name, address: org.address, nif: org.nif, nis: org.nis, rc: org.rc, taxArticle: org.taxArticle, phone: org.phone, logo: org.logo },
      counterpartyLabel: 'DÉPÔT',
      counterparty: { name: count.site.name },
      columns: [
        { key: 'ref', label: 'Réf.', width: 80 },
        { key: 'name', label: 'Désignation', width: 165 },
        { key: 'system', label: 'Théorique', width: 62, align: 'right' as const },
        { key: 'counted', label: 'Compté', width: 62, align: 'right' as const },
        { key: 'diff', label: 'Écart', width: 52, align: 'right' as const },
        { key: 'value', label: 'Valeur écart', width: 74, align: 'right' as const },
      ],
      lines: count.lines.map((l) => ({
        cells: {
          ref: l.sku,
          name: l.name,
          system: String(l.systemQty),
          counted: qty(l.countedQty),
          diff: l.difference ? `${l.difference > 0 ? '+' : ''}${l.difference}` : l.difference === 0 ? '0' : '',
          value: l.valueDifference ? formatMoney(l.valueDifference) : '',
        },
      })),
      summary: [
        { label: 'Articles comptés', value: `${count.summary.countedCount} / ${count.summary.lineCount}` },
        { label: 'Articles en écart', value: String(count.summary.discrepancyCount) },
        { label: 'Valeur des écarts', value: `${formatMoney(count.summary.valueDifference)} DZD`, accent: true },
      ],
      notes: count.notes,
      footerNote: 'Document généré par Stockily.',
    });
  }
}
