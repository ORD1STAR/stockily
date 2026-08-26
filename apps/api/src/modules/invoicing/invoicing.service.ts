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
        nif: dto.nif,
        nis: dto.nis ?? null,
        rc: dto.rc ?? null,
        taxArticle: dto.taxArticle ?? null,
        address: dto.address ?? null,
        phone: dto.phone ?? null,
        email: dto.email ?? null,
      },
    });
  }

  async listPartners(orgId: string) {
    return this.prisma.partner.findMany({ where: { orgId }, orderBy: { name: 'asc' } });
  }

  async updatePartner(orgId: string, id: string, dto: UpdatePartnerDto) {
    const existing = await this.prisma.partner.findFirst({ where: { id, orgId } });
    if (!existing) throw new NotFoundException(`Unknown partner: ${id}`);
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
    if (dto.partnerId) {
      const partner = await this.prisma.partner.findFirst({ where: { id: dto.partnerId, orgId } });
      if (!partner) throw new NotFoundException(`Unknown partner: ${dto.partnerId}`);
    }
    const site = await this.prisma.site.findFirst({ where: { id: dto.siteId, orgId } });
    if (!site) throw new NotFoundException(`Unknown site: ${dto.siteId}`);

    const linesData = dto.lines.map((l) => this.toLineCreateData(l));

    if (dto.type === 'SUPPLIER') {
      // No draft/finalize dance, no compliance numbering (this is the
      // SUPPLIER's own reference, supplied directly), no stock movement —
      // receiving/Purchasing is Phase 2, out of scope (docs/MILESTONE_4.md).
      return this.prisma.invoice.create({
        data: {
          orgId,
          siteId: dto.siteId,
          type: 'SUPPLIER',
          number: dto.number,
          partnerId: dto.partnerId ?? null,
          status: 'unpaid',
          finalizedAt: new Date(),
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
        status: 'draft',
        lines: { create: linesData },
      },
      include: { lines: true },
    });
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
    };
  }

  async listInvoices(orgId: string, filters: { status?: string }) {
    const invoices = await this.prisma.invoice.findMany({
      where: { orgId, ...(filters.status ? { status: filters.status } : {}) },
      include: { lines: { include: { taxRate: true } }, partner: { select: { name: true, nif: true } }, payments: true },
      orderBy: { issuedAt: 'desc' },
    });
    return invoices.map((inv) => this.assembleView(inv));
  }

  async getInvoiceDetail(orgId: string, invoiceId: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, orgId },
      include: { lines: { include: { taxRate: true, product: { select: { name: true } } } }, partner: true, payments: true, site: true },
    });
    if (!invoice) throw new NotFoundException(`Unknown invoice: ${invoiceId}`);
    return this.assembleView(invoice);
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
      where: { id: invoiceId, orgId },
      include: { lines: true, partner: true },
    });
    if (!invoice) throw new NotFoundException(`Unknown invoice: ${invoiceId}`);
    if (invoice.type !== 'CUSTOMER') {
      throw new BadRequestException('Only CUSTOMER invoices go through finalize — a SUPPLIER invoice is already final at creation.');
    }
    if (invoice.status !== 'draft') {
      throw new ConflictException(`Invoice ${invoice.number ?? invoice.id} is not a draft (status: ${invoice.status}).`);
    }
    // Defense in depth only — Partner.nif is a required non-null column,
    // so an attached partner always has one; a null partnerId is the
    // actual "vente comptoir" override path (Action Plan §9 decision,
    // confirmed with the user), not a missing-NIF case to special-case here.
    if (invoice.partnerId && !invoice.partner?.nif) {
      throw new BadRequestException('Partner has no NIF on file.');
    }

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

      return tx.invoice.update({
        where: { id: invoiceId },
        data: { number, status: 'unpaid', finalizedAt: new Date() },
        include: { lines: { include: { taxRate: true } }, payments: true },
      });
    });

    // Only after the transaction actually committed — see
    // recordMovementInTransaction's comment on why this order matters.
    this.stock.publishEvents(collectedEvents);

    return this.assembleView(finalized);
  }

  async voidInvoice(orgId: string, invoiceId: string) {
    const invoice = await this.prisma.invoice.findFirst({ where: { id: invoiceId, orgId }, include: { payments: true } });
    if (!invoice) throw new NotFoundException(`Unknown invoice: ${invoiceId}`);

    if (invoice.type === 'CUSTOMER' && invoice.status !== 'draft') {
      throw new BadRequestException(
        'Only a draft CUSTOMER invoice can be voided. A finalized invoice carries a compliance-numbered, gapless sequence and cannot simply be removed — issue a credit note instead (Retours/SAV, Phase 3) once that module exists.',
      );
    }
    if (invoice.type === 'SUPPLIER' && invoice.payments.length > 0) {
      throw new BadRequestException('Cannot void a supplier invoice that already has recorded payments.');
    }

    return this.prisma.invoice.update({ where: { id: invoiceId }, data: { status: 'void' } });
  }

  // ---------------- Payments ----------------

  async recordPayment(orgId: string, invoiceId: string, dto: CreatePaymentDto) {
    return this.prisma.$transaction(async (tx) => {
      await setTenantOnTransaction(tx, orgId);
      const invoice = await tx.invoice.findFirst({
        where: { id: invoiceId, orgId },
        include: { lines: { include: { taxRate: true } }, payments: true },
      });
      if (!invoice) throw new NotFoundException(`Unknown invoice: ${invoiceId}`);
      if (invoice.status === 'draft') throw new BadRequestException('Finalize this invoice before recording a payment against it.');
      if (invoice.status === 'void') throw new BadRequestException('Cannot record a payment against a voided invoice.');

      const totals = computeInvoiceTotals(this.toLineInputs(invoice));
      const alreadyPaid = invoice.payments.reduce((s, p) => s + Number(p.amount), 0);
      const newTotalPaid = Math.round((alreadyPaid + dto.amount) * 100) / 100;

      const EPSILON = 0.01;
      if (newTotalPaid > totals.totalTtc + EPSILON) {
        throw new BadRequestException({
          statusCode: 400,
          error: 'overpayment',
          message: `Payment of ${dto.amount} exceeds the remaining balance of ${Math.round((totals.totalTtc - alreadyPaid) * 100) / 100}.`,
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
      const invoice = await tx.invoice.findFirst({ where: { id: invoiceId, orgId }, include: { payments: true } });
      if (!invoice) throw new NotFoundException(`Unknown invoice: ${invoiceId}`);
      if (invoice.status === 'draft' || invoice.status === 'void') {
        throw new BadRequestException('No payments to reset on a draft or voided invoice.');
      }
      await tx.payment.deleteMany({ where: { invoiceId } });
      return tx.invoice.update({ where: { id: invoiceId }, data: { status: 'unpaid' } });
    });
  }

  // ---------------- PDF ----------------

  async generatePdf(orgId: string, invoiceId: string): Promise<Buffer> {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, orgId },
      include: { lines: { include: { taxRate: true } }, partner: true, organization: true },
    });
    if (!invoice) throw new NotFoundException(`Unknown invoice: ${invoiceId}`);
    if (invoice.status === 'draft') throw new BadRequestException('Finalize the invoice before generating its PDF.');

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
      where: { orgId, status: { in: ['unpaid', 'partially_paid'] }, finalizedAt: { lte: cutoff } },
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
