import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Invoice, InvoiceLine, Prisma, TaxRate } from '@prisma/client';
import { amountToArabicWords, amountToFrenchWords, computeInvoiceTotals, deriveInvoiceStatus, InvoiceLineInput } from '@org/domain-invoicing';
import { setTenantOnTransaction } from '@org/infra-db';
import { PrismaService } from '../../prisma/prisma.service';
import { StockService } from '../stock/stock.service';
import { CreateInvoiceDto, CreateInvoiceLineDto } from './dto/create-invoice.dto';
import { CreatePartnerDto } from './dto/create-partner.dto';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { CreateTaxRateDto } from './dto/create-tax-rate.dto';
import { UpdateOrganizationProfileDto } from './dto/update-organization-profile.dto';
import { UpdatePartnerDto } from './dto/update-partner.dto';
import { EMAIL_SENDER, EmailSenderPort } from './email/email-sender.port';
import { InvoicePdfService } from './pdf/invoice-pdf.service';

type InvoiceWithLines = Invoice & { lines: (InvoiceLine & { taxRate: TaxRate | null })[] };

// A day count, not a real "payment terms" field (schema has none yet) — see
// docs/MILESTONE_4.md for why this is a documented simplification, not an
// oversight.
const REMINDER_AFTER_DAYS = 30;

@Injectable()
export class InvoicingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
    private readonly pdf: InvoicePdfService,
    @Inject(EMAIL_SENDER) private readonly emailSender: EmailSenderPort,
  ) {}

  // ---------------- Partners ----------------

  async createPartner(orgId: string, dto: CreatePartnerDto) {
    return this.prisma.partner.create({
      data: {
        orgId,
        name: dto.name,
        isCustomer: dto.isCustomer ?? true,
        isSupplier: dto.isSupplier ?? false,
        nif: dto.nif ?? null,
        nis: dto.nis ?? null,
        rc: dto.rc ?? null,
        taxArticle: dto.taxArticle ?? null,
        address: dto.address ?? null,
        phone: dto.phone ?? null,
        email: dto.email ?? null,
        paymentTermsNetDays: dto.paymentTermsNetDays ?? null,
      },
    });
  }

  async listPartners(orgId: string) {
    return this.prisma.partner.findMany({ where: { orgId, deletedAt: null }, orderBy: { name: 'asc' } });
  }

  /**
   * Soft delete — the partner disappears from lists and pickers, but every
   * existing facture/commande keeps pointing at it (and still prints its
   * name), which a physical delete would break.
   */
  async deletePartner(orgId: string, id: string) {
    const existing = await this.prisma.partner.findFirst({ where: { id, orgId, deletedAt: null } });
    if (!existing) throw new NotFoundException(`Partenaire inconnu : ${id}`);
    await this.prisma.partner.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  async updatePartner(orgId: string, id: string, dto: UpdatePartnerDto) {
    const existing = await this.prisma.partner.findFirst({ where: { id, orgId, deletedAt: null } });
    if (!existing) throw new NotFoundException(`Partenaire inconnu : ${id}`);
    return this.prisma.partner.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.isCustomer !== undefined ? { isCustomer: dto.isCustomer } : {}),
        ...(dto.isSupplier !== undefined ? { isSupplier: dto.isSupplier } : {}),
        ...(dto.nif !== undefined ? { nif: dto.nif } : {}),
        ...(dto.nis !== undefined ? { nis: dto.nis } : {}),
        ...(dto.rc !== undefined ? { rc: dto.rc } : {}),
        ...(dto.taxArticle !== undefined ? { taxArticle: dto.taxArticle } : {}),
        ...(dto.address !== undefined ? { address: dto.address } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
        ...(dto.email !== undefined ? { email: dto.email } : {}),
        ...(dto.paymentTermsNetDays !== undefined ? { paymentTermsNetDays: dto.paymentTermsNetDays } : {}),
      },
    });
  }

  // ---------------- Tax rates ----------------

  async createTaxRate(orgId: string, dto: CreateTaxRateDto) {
    return this.prisma.taxRate.create({ data: { orgId, name: dto.name, rate: dto.rate, isDefault: dto.isDefault ?? false } });
  }

  async listTaxRates(orgId: string) {
    return this.prisma.taxRate.findMany({ where: { orgId }, orderBy: { name: 'asc' } });
  }

  // ---------------- Organization legal profile ----------------
  // Backs the "⚙ Paramètres du Business" screen (docs/Wireframes.html) —
  // required before a CUSTOMER invoice can be finalized, see finalize()'s
  // own check below.

  async getOrganizationProfile(orgId: string) {
    return this.prisma.organization.findUniqueOrThrow({
      where: { id: orgId },
      select: {
        id: true,
        name: true,
        address: true,
        nif: true,
        nis: true,
        rc: true,
        taxArticle: true,
        phone: true,
        email: true,
        logo: true,
      },
    });
  }

  async updateOrganizationProfile(orgId: string, dto: UpdateOrganizationProfileDto) {
    return this.prisma.organization.update({ where: { id: orgId }, data: dto });
  }

  // ---------------- Invoices ----------------

  async createInvoice(orgId: string, dto: CreateInvoiceDto) {
    let partner: { paymentTermsNetDays: number | null } | null = null;
    if (dto.partnerId) {
      partner = await this.prisma.partner.findFirst({ where: { id: dto.partnerId, orgId, deletedAt: null } });
      if (!partner) throw new NotFoundException(`Partenaire inconnu : ${dto.partnerId}`);
    }
    const site = await this.prisma.site.findFirst({ where: { id: dto.siteId, orgId } });
    if (!site) throw new NotFoundException(`Site inconnu : ${dto.siteId}`);
    if (dto.purchaseOrderId) {
      const po = await this.prisma.purchaseOrder.findFirst({ where: { id: dto.purchaseOrderId, orgId } });
      if (!po) throw new NotFoundException(`Bon de commande inconnu : ${dto.purchaseOrderId}`);
    }
    if (dto.salesOrderId) {
      const so = await this.prisma.salesOrder.findFirst({ where: { id: dto.salesOrderId, orgId, deletedAt: null } });
      if (!so) throw new NotFoundException(`Commande de vente inconnue : ${dto.salesOrderId}`);
    }

    const linesData = dto.lines.map((l) => this.toLineCreateData(l));

    if (dto.type === 'SUPPLIER') {
      // No draft/finalize dance, no compliance numbering (this is the
      // SUPPLIER's own reference, supplied directly), no stock movement —
      // receiving goes through Purchasing (Milestone 9) instead. finalizedAt
      // is set immediately here, which is also when Milestone 10's dueDate
      // becomes computable (see computeDueDate).
      const finalizedAt = new Date();
      return this.prisma.invoice.create({
        data: {
          orgId,
          siteId: dto.siteId,
          type: 'SUPPLIER',
          number: dto.number,
          partnerId: dto.partnerId ?? null,
          purchaseOrderId: dto.purchaseOrderId ?? null,
          status: 'unpaid',
          finalizedAt,
          dueDate: this.computeDueDate(finalizedAt, partner?.paymentTermsNetDays ?? null),
          lines: { create: linesData },
        },
        include: { lines: true },
      });
    }

    return this.prisma.invoice.create({
      data: {
        orgId,
        siteId: dto.siteId,
        type: 'CUSTOMER',
        number: null,
        partnerId: dto.partnerId ?? null,
        salesOrderId: dto.salesOrderId ?? null,
        status: 'draft',
        lines: { create: linesData },
        // dueDate stays null until finalize — a draft has no finalizedAt
        // yet to compute it from (see finalizeInvoice).
      },
      include: { lines: true },
    });
  }

  /** Milestone 10 — null when the partner has no payment-terms figure on file (most partners today), not a silent default. */
  private computeDueDate(finalizedAt: Date, paymentTermsNetDays: number | null): Date | null {
    if (paymentTermsNetDays == null) return null;
    return new Date(finalizedAt.getTime() + paymentTermsNetDays * 24 * 60 * 60 * 1000);
  }

  private toLineCreateData(l: CreateInvoiceLineDto) {
    return {
      productId: l.productId ?? null,
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      discountPercent: l.discountPercent ?? null,
      discountAmount: l.discountAmount ?? null,
      taxRateId: l.taxRateId ?? null,
      salesOrderLineId: l.salesOrderLineId ?? null,
    };
  }

  async listInvoices(orgId: string, filters: { status?: string }) {
    const invoices = await this.prisma.invoice.findMany({
      where: { orgId, deletedAt: null, ...(filters.status ? { status: filters.status } : {}) },
      include: { lines: { include: { taxRate: true } }, partner: { select: { name: true, nif: true } }, payments: true },
      orderBy: { issuedAt: 'desc' },
    });
    return invoices.map((inv) => this.assembleView(inv));
  }

  async getInvoiceDetail(orgId: string, invoiceId: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, orgId, deletedAt: null },
      include: { lines: { include: { taxRate: true, product: { select: { name: true } } } }, partner: true, payments: true, site: true },
    });
    if (!invoice) throw new NotFoundException(`Facture inconnue : ${invoiceId}`);
    return this.assembleView(invoice);
  }

  /**
   * Soft delete only — never physical, same convention as Product (see
   * schema.prisma). Deliberately broader than voidInvoice above (which is
   * narrow by design: draft-CUSTOMER-only, or payment-free-SUPPLIER) — this
   * is a separate action with no status restriction, matching the request
   * to simply remove a facture from view regardless of its state.
   */
  async softDeleteInvoice(orgId: string, invoiceId: string) {
    const invoice = await this.prisma.invoice.findFirst({ where: { id: invoiceId, orgId, deletedAt: null } });
    if (!invoice) throw new NotFoundException(`Facture inconnue : ${invoiceId}`);
    return this.prisma.invoice.update({ where: { id: invoiceId }, data: { deletedAt: new Date() } });
  }

  private toLineInputs(invoice: InvoiceWithLines): InvoiceLineInput[] {
    return invoice.lines.map((l) => ({
      id: l.id,
      quantity: Number(l.quantity),
      unitPrice: Number(l.unitPrice),
      discountPercent: l.discountPercent != null ? Number(l.discountPercent) : null,
      discountAmount: l.discountAmount != null ? Number(l.discountAmount) : null,
      taxRatePercent: l.taxRate ? Number(l.taxRate.rate) : null,
    }));
  }

  // Prisma.Decimal fields serialize to JSON as strings, not numbers — fine
  // for `totals` (built from toLineInputs's already-Number()'d values) but
  // `invoice.lines` here is still the raw Prisma include, so the frontend's
  // line-by-line render (e.g. `l.unitPrice.toFixed(2)`) crashed on every
  // invoice detail view. Found by actually opening an invoice in the
  // browser, not by reading the code — normalize the same way toLineInputs
  // already does, so every numeric field in the response is a real number.
  private assembleView<T extends InvoiceWithLines & { payments: { amount: Prisma.Decimal }[] }>(invoice: T) {
    const rawTotals = computeInvoiceTotals(this.toLineInputs(invoice));
    // Décret 05-468 mention #10 (TTC in figures AND in words, FR + AR) is
    // already correctly rendered in the PDF export (invoice-pdf.service.ts),
    // but the in-app detail modal reads invoice.totals.totalInWordsFr/Ar,
    // which computeInvoiceTotals never set — the modal silently rendered an
    // empty line instead of erroring, so it went unnoticed until actually
    // opening an invoice and looking at that specific line.
    const totals = {
      ...rawTotals,
      totalInWordsFr: amountToFrenchWords(rawTotals.totalTtc),
      totalInWordsAr: amountToArabicWords(rawTotals.totalTtc),
    };
    const totalPaid = invoice.payments.reduce((s, p) => s + Number(p.amount), 0);
    const lines = invoice.lines.map((l) => ({
      ...l,
      quantity: Number(l.quantity),
      unitPrice: Number(l.unitPrice),
      discountPercent: l.discountPercent != null ? Number(l.discountPercent) : null,
      discountAmount: l.discountAmount != null ? Number(l.discountAmount) : null,
      taxRate: l.taxRate ? { ...l.taxRate, rate: Number(l.taxRate.rate) } : null,
    }));
    return { ...invoice, lines, totals, totalPaid, balance: Math.round((totals.totalTtc - totalPaid) * 100) / 100 };
  }

  // ---------------- Finalize (CUSTOMER only) ----------------
  // See schema.prisma's Invoice/InvoiceCounter comments for the full
  // reasoning on why CUSTOMER and SUPPLIER invoices have different
  // lifecycles here.

  async finalizeInvoice(orgId: string, invoiceId: string, performedBy: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, orgId, deletedAt: null },
      include: { lines: true, partner: true },
    });
    if (!invoice) throw new NotFoundException(`Facture inconnue : ${invoiceId}`);
    if (invoice.type !== 'CUSTOMER') {
      throw new BadRequestException('Seules les factures CLIENT passent par la finalisation — une facture FOURNISSEUR est déjà finale dès sa création.');
    }
    if (invoice.status !== 'draft') {
      throw new ConflictException(`La facture ${invoice.number ?? invoice.id} n'est pas un brouillon (statut : ${invoice.status}).`);
    }
    // NIF/NIS are no longer required on a Partner (explicit user decision —
    // see the PartnersModal form and CreatePartnerDto) — finalizing an
    // invoice for a partner with no NIF on file is allowed; the PDF/print
    // template just renders the "NIF :" label with an empty value.

    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
    if (!org.name || !org.address || !org.nif || !org.nis || !org.rc || !org.taxArticle) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'organization_profile_incomplete',
        message:
          "Renseignez les informations légales de votre entreprise (nom, adresse, NIF, NIS, RC, article d'imposition) dans Paramètres du Business avant de finaliser une facture.",
      });
    }

    const collectedEvents: { kind: string }[] = [];

    const finalized = await this.prisma.$transaction(async (tx) => {
      // Milestone 8 (RLS) — must be the very first statement in this
      // transaction; see rls-extension.ts's doc for why the extension can't
      // do this automatically for calls already inside an interactive
      // transaction (it would silently break this transaction's own
      // atomicity, the exact thing this call composes stock deduction +
      // number assignment to protect).
      await setTenantOnTransaction(tx, orgId);
      // Stock deduction per stock-linked line — all-or-nothing with the
      // number assignment below (Action Plan directive: "if a line's
      // quantity would oversell, the whole finalization must fail
      // cleanly"). Uses StockService.recordMovementInTransaction, NOT
      // recordMovement, specifically so this participates in the SAME
      // transaction (see that method's own comment on why the ordinary
      // one can't be used here).
      const touchedSalesOrderIds = new Set<string>();

      for (const line of invoice.lines) {
        if (!line.productId) continue;
        try {
          const result = await this.stock.recordMovementInTransaction(tx, orgId, performedBy, {
            productId: line.productId,
            siteId: invoice.siteId,
            type: 'OUT',
            quantity: Number(line.quantity),
            partnerId: invoice.partnerId,
            relatedEntityType: 'invoice_line',
            relatedEntityId: line.id,
          });
          collectedEvents.push(...result.events);
        } catch (err) {
          if (err instanceof BadRequestException) {
            const body = err.getResponse();
            const parsed = typeof body === 'object' ? (body as Record<string, unknown>) : { message: body };
            // The domain layer's own message names the product/site by id
            // ("Movement would take stock negative for product
            // 28995e46-...") — perfectly fine as a developer-facing detail,
            // but it's exactly what reached the invoicing UI raw: a user
            // finalizing a real multi-line order saw that string with no
            // way to tell which of their lines it was even about. Rebuilt
            // here using `line.description`, which this loop already has
            // on hand — no extra lookup needed — while `requested`/
            // `available` (already on the error body) still say concretely
            // by how much. Found by actually finalizing an order that
            // oversold one of its lines.
            const message =
              parsed.error === 'negative_stock'
                ? `Stock insuffisant pour « ${line.description} » : ${parsed.requested} demandé(s), ${parsed.available} disponible(s).`
                : parsed.message;
            throw new BadRequestException({ ...parsed, message, lineId: line.id, lineDescription: line.description });
          }
          throw err;
        }

        // Milestone 10 — additive, only for a line built by
        // SalesService.invoiceSalesOrder (every other line, including
        // every pre-Milestone-10 invoice and Vente rapide, has
        // salesOrderLineId null and never enters this branch). Releases
        // the matching commande reservation and advances
        // quantityInvoiced atomically alongside the OUT movement and
        // number assignment above — not a separate call, so a failure
        // anywhere in finalize still rolls back the whole thing including
        // this. Deliberately raw Prisma calls on Sales' own tables rather
        // than injecting SalesService here: InvoicingModule must not
        // depend on SalesModule, which itself depends on InvoicingModule
        // (SalesService.invoiceSalesOrder calls createInvoice) — a real
        // circular-module-dependency risk, avoided by keeping this small,
        // self-contained bookkeeping inline instead.
        // Services-only lines (productId null) still advance
        // quantityInvoiced — only the reservation release needs a product.
        if (line.salesOrderLineId) {
          const soLine = await tx.salesOrderLine.findUniqueOrThrow({ where: { id: line.salesOrderLineId } });
          // Last line of defence against over-invoicing a commande: several
          // drafts can exist for the same line, and only finalization moves
          // quantityInvoiced, so this is the one place the total is certain.
          const remaining = Number(soLine.quantityOrdered) - Number(soLine.quantityInvoiced);
          if (Number(line.quantity) > remaining) {
            throw new BadRequestException(
              `Impossible de finaliser : « ${line.description} » dépasserait la quantité commandée (${Number(soLine.quantityOrdered)} commandé(s), ${Number(soLine.quantityInvoiced)} déjà facturé(s)).`,
            );
          }
          if (line.productId) {
            await this.stock.releaseInTransaction(tx, {
              orgId,
              productId: line.productId,
              siteId: invoice.siteId,
              quantity: Number(line.quantity),
            });
          }
          await tx.salesOrderLine.update({
            where: { id: line.salesOrderLineId },
            data: { quantityInvoiced: { increment: Number(line.quantity) } },
          });
          touchedSalesOrderIds.add(soLine.salesOrderId);
        }
      }

      for (const salesOrderId of touchedSalesOrderIds) {
        await this.recomputeSalesOrderStatusInTransaction(tx, salesOrderId);
      }

      // Gapless, per-org, per-calendar-year sequential number (Décret
      // 05-468) via a single atomic statement — safe under concurrent
      // finalization because Postgres serializes concurrent
      // INSERT...ON CONFLICT DO UPDATE statements targeting the same row
      // via ordinary row-level locking (the second concurrent transaction
      // blocks until the first commits/rolls back, then sees the
      // incremented value) — NOT a read-then-write from application code,
      // which would race. Column names are quoted camelCase because this
      // schema has no per-field @map (only @@map on the table name) — see
      // docs/MILESTONE_4.md, this tripped up the first draft of this query.
      const year = new Date().getFullYear();
      const rows = await tx.$queryRaw<{ lastNumber: number }[]>`
        INSERT INTO "invoice_counters" ("orgId", "year", "lastNumber")
        VALUES (${orgId}, ${year}, 1)
        ON CONFLICT ("orgId", "year")
        DO UPDATE SET "lastNumber" = "invoice_counters"."lastNumber" + 1
        RETURNING "lastNumber"
      `;
      const seq = rows[0].lastNumber;
      const number = `FA-${year}-${String(seq).padStart(6, '0')}`;
      const finalizedAt = new Date();

      return tx.invoice.update({
        where: { id: invoiceId },
        data: {
          number,
          status: 'unpaid',
          finalizedAt,
          dueDate: this.computeDueDate(finalizedAt, invoice.partner?.paymentTermsNetDays ?? null),
        },
        include: { lines: { include: { taxRate: true } }, payments: true },
      });
    });

    // Only after the transaction actually committed — see
    // recordMovementInTransaction's comment on why this order matters.
    this.stock.publishEvents(collectedEvents);

    return this.assembleView(finalized);
  }

  /** Derives a SalesOrder (kind='order')'s status from its lines' cumulative quantityInvoiced — same shape as PurchasingService's own updatePurchaseOrderStatus, kept here (not in a shared helper) since it only ever runs from inside finalizeInvoice's own transaction. */
  private async recomputeSalesOrderStatusInTransaction(tx: Prisma.TransactionClient, salesOrderId: string): Promise<void> {
    const lines = await tx.salesOrderLine.findMany({ where: { salesOrderId } });
    const fullyInvoiced = lines.every((l) => Number(l.quantityInvoiced) >= Number(l.quantityOrdered));
    const anyInvoiced = lines.some((l) => Number(l.quantityInvoiced) > 0);
    const status = fullyInvoiced ? 'invoiced' : anyInvoiced ? 'partially_invoiced' : 'confirmed';
    await tx.salesOrder.update({ where: { id: salesOrderId }, data: { status } });
  }

  async voidInvoice(orgId: string, invoiceId: string) {
    const invoice = await this.prisma.invoice.findFirst({ where: { id: invoiceId, orgId, deletedAt: null }, include: { payments: true } });
    if (!invoice) throw new NotFoundException(`Facture inconnue : ${invoiceId}`);

    if (invoice.type === 'CUSTOMER' && invoice.status !== 'draft') {
      throw new BadRequestException(
        'Seule une facture CLIENT en brouillon peut être annulée. Une facture finalisée porte une numérotation séquentielle sans trou requise pour la conformité et ne peut pas être simplement supprimée — émettez plutôt un avoir (Retours/SAV, Phase 3) une fois ce module disponible.',
      );
    }
    if (invoice.type === 'SUPPLIER' && invoice.payments.length > 0) {
      throw new BadRequestException('Impossible d\'annuler une facture fournisseur qui a déjà des paiements enregistrés.');
    }

    return this.prisma.invoice.update({ where: { id: invoiceId }, data: { status: 'void' } });
  }

  // ---------------- Payments ----------------

  async recordPayment(orgId: string, invoiceId: string, dto: CreatePaymentDto) {
    return this.prisma.$transaction(async (tx) => {
      await setTenantOnTransaction(tx, orgId);
      const invoice = await tx.invoice.findFirst({
        where: { id: invoiceId, orgId, deletedAt: null },
        include: { lines: { include: { taxRate: true } }, payments: true },
      });
      if (!invoice) throw new NotFoundException(`Facture inconnue : ${invoiceId}`);
      if (invoice.status === 'draft') throw new BadRequestException('Finalisez cette facture avant d\'y enregistrer un paiement.');
      if (invoice.status === 'void') throw new BadRequestException('Impossible d\'enregistrer un paiement sur une facture annulée.');

      const totals = computeInvoiceTotals(this.toLineInputs(invoice));
      const alreadyPaid = invoice.payments.reduce((s, p) => s + Number(p.amount), 0);
      const newTotalPaid = Math.round((alreadyPaid + dto.amount) * 100) / 100;

      const EPSILON = 0.01;
      if (newTotalPaid > totals.totalTtc + EPSILON) {
        throw new BadRequestException({
          statusCode: 400,
          error: 'overpayment',
          message: `Le paiement de ${dto.amount} dépasse le solde restant de ${Math.round((totals.totalTtc - alreadyPaid) * 100) / 100}.`,
        });
      }

      const payment = await tx.payment.create({ data: { invoiceId, amount: dto.amount, method: dto.method ?? null } });
      const status = deriveInvoiceStatus(totals.totalTtc, newTotalPaid);
      await tx.invoice.update({ where: { id: invoiceId }, data: { status } });

      return { payment, status, balance: Math.round((totals.totalTtc - newTotalPaid) * 100) / 100 };
    });
  }

  // A payment fat-fingered onto the wrong invoice, or a "fully paid" click
  // that shouldn't have happened, had no way back — the invoice's own
  // compliance-numbered sequence must never be touched once finalized, but
  // the payments recorded against it are a separate, correctable record of
  // what was actually collected, not part of that sequence. Removing every
  // Payment row and letting status re-derive (back to "unpaid") is the
  // fix: it doesn't un-finalize anything, it just undoes the payment
  // entries so they can be re-entered correctly.
  async resetPayments(orgId: string, invoiceId: string) {
    return this.prisma.$transaction(async (tx) => {
      await setTenantOnTransaction(tx, orgId);
      const invoice = await tx.invoice.findFirst({ where: { id: invoiceId, orgId, deletedAt: null }, include: { payments: true } });
      if (!invoice) throw new NotFoundException(`Facture inconnue : ${invoiceId}`);
      if (invoice.status === 'draft' || invoice.status === 'void') {
        throw new BadRequestException('Aucun paiement à réinitialiser sur une facture brouillon ou annulée.');
      }
      await tx.payment.deleteMany({ where: { invoiceId } });
      return tx.invoice.update({ where: { id: invoiceId }, data: { status: 'unpaid' } });
    });
  }

  // ---------------- PDF ----------------

  async generatePdf(orgId: string, invoiceId: string): Promise<Buffer> {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, orgId, deletedAt: null },
      include: { lines: { include: { taxRate: true } }, partner: true, organization: true },
    });
    if (!invoice) throw new NotFoundException(`Facture inconnue : ${invoiceId}`);
    if (invoice.status === 'draft') throw new BadRequestException('Finalisez la facture avant de générer son PDF.');

    const totals = computeInvoiceTotals(this.toLineInputs(invoice));

    return this.pdf.generate({
      number: invoice.number ?? '(brouillon)',
      issuedAt: invoice.finalizedAt ?? invoice.issuedAt,
      type: invoice.type,
      status: invoice.status,
      seller: {
        name: invoice.organization.name,
        address: invoice.organization.address,
        nif: invoice.organization.nif,
        nis: invoice.organization.nis,
        rc: invoice.organization.rc,
        taxArticle: invoice.organization.taxArticle,
        phone: invoice.organization.phone,
        logo: invoice.organization.logo,
      },
      buyer: invoice.partner ? { name: invoice.partner.name, nif: invoice.partner.nif } : null,
      lines: totals.lines.map((computed, i) => ({
        description: invoice.lines[i].description,
        quantity: Number(invoice.lines[i].quantity),
        unitPrice: Number(invoice.lines[i].unitPrice),
        discountAmount: computed.discountAmount,
        taxRatePercent: invoice.lines[i].taxRate ? Number(invoice.lines[i].taxRate.rate) : null,
        netAmount: computed.netAmount,
        taxAmount: computed.taxAmount,
        totalAmount: computed.totalAmount,
      })),
      totalHt: totals.totalHt,
      totalTax: totals.totalTax,
      totalTtc: totals.totalTtc,
    });
  }

  // ---------------- Reminders ----------------
  // A simple overdue check, not the full Phase 2 Notifications center
  // (Action Plan §7 milestone 4 scope). "Overdue" = unpaid/partially_paid
  // and finalized more than REMINDER_AFTER_DAYS ago — the schema has no
  // explicit due-date/payment-terms field yet, so this uses finalizedAt +
  // a fixed grace period as a documented simplification.

  async runReminderCheck(orgId: string) {
    const cutoff = new Date(Date.now() - REMINDER_AFTER_DAYS * 24 * 60 * 60 * 1000);
    const overdue = await this.prisma.invoice.findMany({
      where: { orgId, deletedAt: null, status: { in: ['unpaid', 'partially_paid'] }, finalizedAt: { lte: cutoff } },
      include: { partner: true, reminders: { orderBy: { sentAt: 'desc' }, take: 1 } },
    });

    const remindedIds: string[] = [];
    for (const invoice of overdue) {
      const lastReminder = invoice.reminders[0];
      if (lastReminder && lastReminder.sentAt > cutoff) continue; // already reminded within the same window

      await this.prisma.invoiceReminder.create({ data: { invoiceId: invoice.id, channel: 'email' } });
      if (invoice.partner?.email) {
        await this.emailSender.send(
          invoice.partner.email,
          `Facture ${invoice.number} en retard de paiement`,
          `Votre facture ${invoice.number} est impayée depuis plus de ${REMINDER_AFTER_DAYS} jours. Merci de régulariser dans les meilleurs délais.`,
        );
      }
      remindedIds.push(invoice.id);
    }

    return { checked: overdue.length, reminded: remindedIds.length, invoiceIds: remindedIds };
  }
}
