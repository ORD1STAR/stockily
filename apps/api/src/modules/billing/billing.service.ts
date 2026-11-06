import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { AdminPrismaService } from '../../admin/admin-prisma.service';
import { renderBillingInvoice } from './billing-invoice-pdf';
import { EntitlementCacheService } from '../tenancy/services/entitlement-cache.service';
import { CATALOG_KEYS, CATALOG_MODULES, CATALOG_PACKS, DURATIONS, UPCOMING } from './billing.catalog';
import { ChangePasswordDto, PurchaseDto, UpdateAccountDto } from './billing.dto';
import { ChargilyService } from './chargily.service';
import { MailService } from '../mail/mail.service';
import { paymentConfirmedMail } from '../mail/mail.templates';

type Tx = Prisma.TransactionClient;

const DAY = 24 * 60 * 60 * 1000;
const dzd = (n: number) => `${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0')}\u00a0DZD`;

/** Calendar-month addition that clamps the day (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}

/** The single "is this module usable right now" rule, shared with the guard. */
export function isEntitlementUsable(e: { status: string; trialEndsAt: Date | null; expiresAt?: Date | null }, now = Date.now()): boolean {
  if (e.status === 'active') return !e.expiresAt || e.expiresAt.getTime() > now;
  if (e.status === 'trial') return !!e.trialEndsAt && e.trialEndsAt.getTime() > now;
  return false;
}

// Self-service billing for an organization: catalogue, purchases (modules
// one by one, a selection, or a pack) and
// invoices — plus the logged-in user's own account settings.
//
// Runs on the superuser client (AdminPrismaService) because module_prices
// and platform_payments are RLS deny-all for the restricted app role
// (platform-level data). Every query is therefore scoped to the caller's
// orgId/userId explicitly, taken from the verified JWT — never from input.
//
// Payments go through Chargily Pay (customers + checkouts only): a purchase
// creates a pending payment and a checkout; the modules are activated when
// the signed webhook (or the post-redirect sync) says it was paid. Without
// CHARGILY_SECRET_KEY a purchase is "offered" (activated immediately).
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly db: AdminPrismaService,
    private readonly cache: EntitlementCacheService,
    private readonly chargily: ChargilyService,
    private readonly mail: MailService,
  ) {}

  // ---------------------------------------------------------------- catalog

  private async prices(tx: Tx | AdminPrismaService = this.db): Promise<Map<string, number>> {
    const rows = await tx.modulePrice.findMany({ where: { moduleKey: { in: CATALOG_KEYS }, isActive: true } });
    return new Map(rows.map((r) => [r.moduleKey, Number(r.monthlyPrice)]));
  }

  async catalog() {
    const [prices, modules] = await Promise.all([this.prices(), this.db.module.findMany({ where: { key: { in: CATALOG_KEYS } } })]);
    const deps = new Map(modules.map((m) => [m.key, m.dependencies.filter((d) => CATALOG_KEYS.includes(d))]));
    const catalogModules = CATALOG_MODULES.filter((m) => prices.has(m.key)).map((m) => ({
      ...m,
      monthlyPrice: prices.get(m.key) ?? 0,
      dependencies: deps.get(m.key) ?? [],
    }));
    const available = new Set(catalogModules.map((m) => m.key));
    return {
      currency: 'DZD',
      onlinePayment: this.chargily.enabled(),
      modules: catalogModules,
      packs: CATALOG_PACKS.filter((p) => p.modules.every((k) => available.has(k))).map((p) => ({
        ...p,
        monthlyPrice: p.modules.reduce((s, k) => s + (prices.get(k) ?? 0), 0),
      })),
      durations: DURATIONS,
      upcoming: UPCOMING,
    };
  }

  // -------------------------------------------------------------- overview

  /** Only an org administrator (Super Admin / Gestionnaire) may spend the org's money. */
  async canManage(userId: string): Promise<boolean> {
    const n = await this.db.rolePermission.count({
      where: { action: 'members.user.manage', role: { userRoles: { some: { userId } } } },
    });
    return n > 0;
  }

  private async assertManager(userId: string) {
    if (!(await this.canManage(userId))) {
      throw new ForbiddenException("Seul un administrateur du compte peut gérer l'abonnement.");
    }
  }

  async overview(orgId: string, userId: string) {
    const [org, ents, prices, payments, canManage, sitesUsed] = await Promise.all([
      this.db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { id: true, name: true } }),
      this.db.organizationModuleEntitlement.findMany({ where: { orgId }, include: { module: { select: { key: true } } } }),
      this.prices(),
      this.db.platformPayment.findMany({ where: { orgId }, orderBy: { createdAt: 'desc' }, take: 200 }),
      this.canManage(userId),
      this.db.site.count({ where: { orgId, isActive: true } }),
    ]);
    const now = Date.now();
    const byKey = new Map(ents.map((e) => [e.module.key, e]));
    const modules = CATALOG_MODULES.filter((m) => prices.has(m.key)).map((m) => {
      const e = byKey.get(m.key);
      const usable = e ? isEntitlementUsable(e, now) : false;
      const endsAt = !e ? null : e.status === 'trial' ? e.trialEndsAt : e.status === 'active' ? e.expiresAt : (e.expiresAt ?? e.trialEndsAt);
      const state: 'active' | 'trial' | 'expired' | 'none' = !e ? 'none' : usable ? (e.status === 'trial' ? 'trial' : 'active') : 'expired';
      return {
        key: m.key,
        name: m.name,
        monthlyPrice: prices.get(m.key) ?? 0,
        state,
        endsAt,
        daysLeft: usable && endsAt ? Math.max(0, Math.ceil((endsAt.getTime() - now) / DAY)) : null,
        siteQuota: m.key === 'sites' ? (e?.siteQuota ?? null) : null,
      };
    });
    return {
      sitesUsed,
      organization: { id: org.id, name: org.name },
      canManage,
      modules,
      payments: payments.map((p) => this.paymentView(p)),
    };
  }

  private paymentView(p: Prisma.PlatformPaymentGetPayload<object>) {
    return {
      id: p.id,
      number: p.number,
      kind: p.kind,
      amount: Number(p.amount),
      currency: p.currency,
      method: p.method,
      status: p.status,
      items: (p.items as { key: string; label: string; months: number; unitPrice: number; total: number }[] | null) ?? [],
      checkoutId: p.checkoutId,
      trackId: p.trackId,
      checkoutUrl: p.status === 'pending' ? p.checkoutUrl : null,
      paidAt: p.paidAt,
      createdAt: p.createdAt,
    };
  }

  private async nextNumber(tx: Tx): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `STK-${year}-`;
    // Serialize number allocation across concurrent purchases.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('platform_payment_number'))`;
    const last = await tx.platformPayment.findFirst({ where: { number: { startsWith: prefix } }, orderBy: { number: 'desc' }, select: { number: true } });
    const seq = last?.number ? Number(last.number.slice(prefix.length)) + 1 : 1;
    return `${prefix}${String(seq).padStart(6, '0')}`;
  }

  // -------------------------------------------------------------- purchase

  /**
   * The single source of truth for what a purchase does and costs, used by
   * the read-only quote AND the real purchase (so the amount shown is always
   * the amount charged).
   *
   * Beyond the requested modules it adds every dependency that isn't PAID
   * (one still on trial would lapse under its dependents), and then makes
   * sure each dependency lasts at least as long as every module that needs
   * it: a dependency that would end earlier is extended by whole months and
   * billed. Without that, buying Ventes for 3 months on top of a Factures
   * that ends in 1 month would leave Ventes unusable after month 1.
   */
  private async plan(client: Tx | AdminPrismaService, orgId: string, dto: Pick<PurchaseDto, 'modules' | 'months' | 'extraSites'>) {
    const unknown = dto.modules.filter((k) => !CATALOG_KEYS.includes(k));
    if (unknown.length) throw new BadRequestException(`Module inconnu : ${unknown.join(', ')}`);
    const duration = DURATIONS.find((d) => d.months === dto.months);
    if (!duration) throw new BadRequestException('Durée invalide.');

    const ents = await client.organizationModuleEntitlement.findMany({ where: { orgId }, include: { module: { select: { key: true } } } });
    const entOf = (key: string) => ents.find((e) => e.module.key === key);
    const now = new Date();
    const isPaid = (key: string) => {
      const e = entOf(key);
      return !!e && e.status === 'active' && (!e.expiresAt || e.expiresAt > now);
    };
    const moduleRows = await client.module.findMany({ where: { key: { in: CATALOG_KEYS } }, select: { key: true, dependencies: true } });
    const depsOf = (k: string) => (moduleRows.find((m) => m.key === k)?.dependencies ?? []).filter((d) => CATALOG_KEYS.includes(d));

    // 1. The requested modules plus every unpaid dependency (transitively).
    const requested = new Set(dto.modules);
    const wanted = new Set<string>();
    const visit = (k: string) => {
      if (wanted.has(k)) return;
      wanted.add(k);
      depsOf(k).forEach((d) => !isPaid(d) && visit(d));
    };
    dto.modules.forEach(visit);
    const bought = CATALOG_KEYS.filter((k) => wanted.has(k) && (requested.has(k) || !isPaid(k)));

    const prices = await this.prices(client);
    const missing = bought.filter((k) => !prices.has(k));
    if (missing.length) throw new BadRequestException(`Module non disponible à la vente : ${missing.join(', ')}`);

    // 2. Where each period starts: after a still-running paid period, or after
    // a running trial (its remaining days are kept), otherwise now.
    const baseOf = (k: string) => {
      const e = entOf(k);
      if (e?.status === 'active' && e.expiresAt && e.expiresAt > now) return e.expiresAt;
      if (e?.status === 'trial' && e.trialEndsAt && e.trialEndsAt > now) return e.trialEndsAt;
      return now;
    };
    const end = new Map<string, Date>();
    const extra = new Map<string, number>(); // whole months added to cover dependents
    const coversFor = new Map<string, Set<string>>();
    for (const k of bought) end.set(k, addMonths(baseOf(k), duration.months));

    // 3. Every dependency must last at least as long as its dependents.
    for (let guard = 0; guard < 12; guard++) {
      let changed = false;
      for (const k of [...end.keys()]) {
        const required = end.get(k) as Date;
        for (const d of depsOf(k)) {
          let cur = end.get(d);
          if (!cur) {
            const e = entOf(d);
            // A paid dependency with no end date (admin grant) never lapses: nothing to cover.
            if (!isPaid(d) || !e?.expiresAt) continue;
            cur = e.expiresAt;
          }
          if (cur >= required) continue;
          let m = 1;
          while (addMonths(cur, m) < required) m++;
          end.set(d, addMonths(cur, m));
          extra.set(d, (extra.get(d) ?? 0) + m);
          coversFor.set(d, new Set([...(coversFor.get(d) ?? []), k]));
          changed = true;
        }
      }
      if (!changed) break;
    }

    // 4. Items. Multi-sites is priced per site beyond the first (free for life).
    const names = new Map(CATALOG_MODULES.map((m) => [m.key, m.name]));
    const siteEnt = entOf('sites');
    const extraSites = end.has('sites') ? (bought.includes('sites') ? (dto.extraSites ?? siteEnt?.siteQuota ?? 1) : (siteEnt?.siteQuota ?? 1)) : 0;
    const items = CATALOG_KEYS.filter((k) => end.has(k)).map((k) => {
      const isBought = bought.includes(k);
      const add = extra.get(k) ?? 0;
      const base = prices.get(k) ?? 0;
      const unitPrice = k === 'sites' ? base * extraSites : base;
      const months = (isBought ? duration.months : 0) + add;
      const billed = (isBought ? duration.billedMonths : 0) + add;
      const label = k === 'sites' ? `Multi-sites (${extraSites} site${extraSites > 1 ? 's' : ''} supplémentaire${extraSites > 1 ? 's' : ''})` : (names.get(k) ?? k);
      const cover = [...(coversFor.get(k) ?? [])].map((c) => names.get(c) ?? c);
      const note = add > 0 ? `Prolongé de ${add} mois pour couvrir ${cover.join(', ')}` : undefined;
      return { key: k, label, months, unitPrice, total: unitPrice * billed, fullTotal: unitPrice * months, note };
    });
    const amount = items.reduce((sum, i) => sum + i.total, 0);
    const discount = items.reduce((sum, i) => sum + (i.fullTotal - i.total), 0);
    return { duration, items, amount, discount, end, bought, extraSites, entOf, now };
  }

  /** Read-only: exactly what a purchase would activate and cost. */
  async quote(orgId: string, dto: PurchaseDto) {
    const p = await this.plan(this.db, orgId, dto);
    return {
      amount: p.amount,
      discount: p.discount,
      items: p.items,
      modules: [...p.end.entries()].map(([key, expiresAt]) => ({ key, expiresAt })),
    };
  }

  /** Applies a plan: activates/extends every module of it. Runs inside the caller's transaction. */
  private async applyPlan(tx: Tx, orgId: string, plan: Awaited<ReturnType<BillingService['plan']>>) {
    const { end, bought, extraSites, now } = plan;
    const moduleRows = await tx.module.findMany({ where: { key: { in: [...end.keys()] } } });
    const idByKey = new Map(moduleRows.map((m) => [m.key, m.id]));
    const periods: { key: string; expiresAt: Date }[] = [];
    for (const [key, expiresAt] of end) {
      const moduleId = idByKey.get(key);
      if (!moduleId) throw new BadRequestException(`Module non initialisé : ${key}`);
      const current = plan.entOf(key);
      const quota = key === 'sites' && bought.includes(key) ? { siteQuota: extraSites } : {};
      await tx.organizationModuleEntitlement.upsert({
        where: { orgId_moduleId: { orgId, moduleId } },
        update: { status: 'active', expiresAt, trialEndsAt: null, ...quota, ...(current?.status !== 'active' ? { activatedAt: now } : {}) },
        create: { orgId, moduleId, status: 'active', expiresAt, activatedAt: now, ...quota },
      });
      periods.push({ key, expiresAt });
    }
    // First purchase: the org leaves the free-trial plan.
    await tx.organization.updateMany({ where: { id: orgId, plan: 'trial' }, data: { plan: 'paid' } });
    return periods;
  }

  private packNote(packKey?: string) {
    const pack = CATALOG_PACKS.find((p) => p.key === packKey);
    return pack ? `Pack ${pack.name}` : null;
  }

  async purchase(orgId: string, userId: string, dto: PurchaseDto) {
    await this.assertManager(userId);
    return this.chargily.enabled() ? this.startCheckout(orgId, userId, dto) : this.purchaseOffered(orgId, userId, dto);
  }

  /** Launch mode (no payment provider configured): activated at once, recorded as offered. */
  private async purchaseOffered(orgId: string, userId: string, dto: PurchaseDto) {
    const result = await this.db.$transaction(async (tx) => {
      const plan = await this.plan(tx, orgId, dto);
      const periods = await this.applyPlan(tx, orgId, plan);
      const payment = await tx.platformPayment.create({
        data: {
          orgId,
          userId,
          kind: 'purchase',
          number: await this.nextNumber(tx),
          amount: plan.amount,
          currency: 'DZD',
          status: 'paid',
          method: 'Activation offerte (paiement en ligne à venir)',
          notes: this.packNote(dto.packKey),
          items: plan.items,
          paidAt: plan.now,
        },
      });
      return { payment, periods };
    });
    result.periods.forEach((p) => this.cache.invalidate(orgId, p.key));
    return { payment: this.paymentView(result.payment), modules: result.periods, checkoutUrl: null as string | null };
  }

  /**
   * Chargily Pay: a pending payment + a checkout for exactly the quoted
   * amount. Nothing is activated yet; the customer is sent to `checkoutUrl`.
   */
  private async startCheckout(orgId: string, userId: string, dto: PurchaseDto) {
    const plan = await this.plan(this.db, orgId, dto);
    if (plan.amount < 50) throw new BadRequestException('Montant trop faible pour un paiement en ligne (minimum 50 DZD).');
    const app = (process.env.PUBLIC_APP_URL ?? 'https://stockily.ordi-tech.com').replace(/\/$/, '');

    const payment = await this.db.platformPayment.create({
      data: {
        orgId,
        userId,
        kind: 'purchase',
        amount: plan.amount,
        currency: 'DZD',
        status: 'pending',
        method: 'Chargily Pay (EDAHABIA / CIB)',
        notes: this.packNote(dto.packKey),
        items: plan.items,
        request: { modules: dto.modules, months: dto.months, extraSites: dto.extraSites ?? null, packKey: dto.packKey ?? null },
      },
    });
    try {
      const customerId = await this.ensureCustomer(orgId, userId);
      const label = plan.items.map((i) => i.label).join(', ');
      const checkout = await this.chargily.createCheckout({
        amount: plan.amount,
        customerId,
        description: `Stockily : ${label}`.slice(0, 250),
        successUrl: `${app}/compte?tab=payments&pay=${payment.id}`,
        failureUrl: `${app}/compte?tab=payments&pay=${payment.id}&failed=1`,
        webhookUrl: `${app}/api/billing/webhook`,
        metadata: { stockily_org_id: orgId, stockily_payment_id: payment.id },
      });
      if (!checkout.checkout_url) throw new Error('checkout_url manquant');
      const saved = await this.db.platformPayment.update({ where: { id: payment.id }, data: { checkoutId: checkout.id, checkoutUrl: checkout.checkout_url } });
      return { payment: this.paymentView(saved), modules: [] as { key: string; expiresAt: Date }[], checkoutUrl: checkout.checkout_url as string | null };
    } catch (err) {
      await this.db.platformPayment.update({ where: { id: payment.id }, data: { status: 'failed' } });
      throw err;
    }
  }

  /** One Chargily customer per org, created on first payment; our org id travels in its metadata. */
  private async ensureCustomer(orgId: string, userId: string): Promise<string> {
    const org = await this.db.organization.findUniqueOrThrow({ where: { id: orgId } });
    if (org.chargilyCustomerId) return org.chargilyCustomerId;
    const user = await this.db.user.findUnique({ where: { id: userId }, select: { email: true, phone: true } });
    const customer = await this.chargily.createCustomer({ name: org.name, email: user?.email ?? org.email, phone: user?.phone ?? org.phone, orgId });
    await this.db.organization.update({ where: { id: orgId }, data: { chargilyCustomerId: customer.id } });
    return customer.id;
  }

  /**
   * Applies a Chargily outcome to a payment. Idempotent: the webhook, the
   * redirect sync and Chargily's retries can all call it for the same payment;
   * only the first one that finds it still pending does anything.
   */
  async settle(paymentId: string, outcome: 'paid' | 'failed' | 'canceled', paidAmount?: number, trackId?: string | null): Promise<void> {
    const modules: { orgId: string; key: string }[] = [];
    let receipt: { id: string; orgId: string; number: string | null; amount: number; items: { label: string; months: number; total: number }[] } | null = null;
    await this.db.$transaction(async (tx) => {
      const p = await tx.platformPayment.findUnique({ where: { id: paymentId } });
      if (!p || p.status !== 'pending') return;
      if (outcome !== 'paid') {
        await tx.platformPayment.update({ where: { id: p.id }, data: { status: outcome } });
        return;
      }
      if (paidAmount !== undefined && Math.round(paidAmount) < Math.round(Number(p.amount))) {
        this.logger.error(`Payment ${p.id}: paid ${paidAmount} < expected ${Number(p.amount)}; not activating.`);
        return;
      }
      const req = p.request as { modules: string[]; months: number; extraSites: number | null; packKey: string | null } | null;
      if (!req) return;
      const plan = await this.plan(tx, p.orgId, { modules: req.modules, months: req.months, extraSites: req.extraSites ?? undefined });
      const periods = await this.applyPlan(tx, p.orgId, plan);
      const number = await this.nextNumber(tx);
      await tx.platformPayment.update({
        where: { id: p.id },
        data: { status: 'paid', paidAt: new Date(), number, items: plan.items, ...(trackId ? { trackId } : {}) },
      });
      receipt = { id: p.id, orgId: p.orgId, number, amount: Number(p.amount), items: plan.items };
      periods.forEach((x) => modules.push({ orgId: p.orgId, key: x.key }));
    });
    modules.forEach((m) => this.cache.invalidate(m.orgId, m.key));
    if (receipt) void this.sendReceipt(receipt);
  }

  /** Payment-received email (with the invoice PDF attached) to the account owner (the org's first user). Never throws. */
  private async sendReceipt(r: { id: string; orgId: string; number: string | null; amount: number; items: { label: string; months: number; total: number }[] }): Promise<void> {
    try {
      const [org, owner] = await Promise.all([
        this.db.organization.findUnique({ where: { id: r.orgId }, select: { name: true } }),
        this.db.user.findFirst({ where: { orgId: r.orgId, email: { not: null } }, orderBy: { createdAt: 'asc' }, select: { email: true } }),
      ]);
      // The invoice PDF rides along. If it cannot be produced the confirmation still goes out (the invoice stays in the Espace client).
      const attachments = await this.paymentPdf(r.orgId, r.id)
        .then((f) => [{ filename: `Facture-${f.number}.pdf`, content: f.pdf, contentType: 'application/pdf' }])
        .catch((err) => {
          this.logger.error(`Invoice PDF for payment ${r.id} could not be attached: ${err instanceof Error ? err.message : err}`);
          return [];
        });
      await this.mail.send(owner?.email, paymentConfirmedMail({ organizationName: org?.name ?? '', number: r.number, amount: r.amount, items: r.items }), attachments);
    } catch (err) {
      this.logger.error(`Receipt email failed for org ${r.orgId}: ${err instanceof Error ? err.message : err}`);
    }
  }

  /** Webhook entry point (signature already verified by the controller). */
  async handleWebhook(event: { type?: string; data?: { id?: string; amount?: number; invoice_id?: string | null; metadata?: Record<string, unknown> | null } }): Promise<void> {
    const outcome = event.type === 'checkout.paid' ? 'paid' : event.type === 'checkout.failed' ? 'failed' : event.type === 'checkout.canceled' ? 'canceled' : null;
    const checkoutId = event.data?.id;
    if (!outcome || !checkoutId) return;
    const payment = await this.db.platformPayment.findUnique({ where: { checkoutId } });
    if (!payment) return;
    await this.settle(payment.id, outcome, event.data?.amount, event.data?.invoice_id);
  }

  /** Called when the customer comes back from Chargily: asks Chargily for the truth instead of waiting for the webhook. */
  async syncPayment(orgId: string, paymentId: string) {
    const payment = await this.db.platformPayment.findFirst({ where: { id: paymentId, orgId } });
    if (!payment) throw new NotFoundException('Paiement introuvable.');
    if (payment.status === 'pending' && payment.checkoutId && this.chargily.enabled()) {
      const checkout = await this.chargily.getCheckout(payment.checkoutId);
      if (checkout.status === 'paid') await this.settle(payment.id, 'paid', checkout.amount, checkout.invoice_id);
      else if (checkout.status === 'failed' || checkout.status === 'canceled') await this.settle(payment.id, checkout.status);
    }
    const fresh = await this.db.platformPayment.findFirstOrThrow({ where: { id: paymentId, orgId } });
    return { payment: this.paymentView(fresh) };
  }

  // ---------------------------------------------------------- expiry

  /**
   * Marks lapsed paid periods `expired` (bookkeeping: the entitlement guard
   * already refuses a module past its expiresAt on its own). Called hourly by
   * BillingScheduler.
   */
  async markExpired(now = new Date()): Promise<{ expired: number }> {
    const lapsed = await this.db.organizationModuleEntitlement.findMany({
      where: { status: 'active', expiresAt: { not: null, lte: now } },
      include: { module: { select: { key: true } } },
    });
    if (lapsed.length) {
      await this.db.organizationModuleEntitlement.updateMany({ where: { id: { in: lapsed.map((l) => l.id) } }, data: { status: 'expired' } });
      lapsed.forEach((l) => this.cache.invalidate(l.orgId, l.module.key));
    }
    return { expired: lapsed.length };
  }

  // ------------------------------------------------------------- invoices

  async paymentPdf(orgId: string, paymentId: string): Promise<{ pdf: Buffer; number: string }> {
    const p = await this.db.platformPayment.findFirst({ where: { id: paymentId, orgId, status: 'paid' } });
    if (!p) throw new NotFoundException('Facture introuvable (paiement non finalisé).');
    const org = await this.db.organization.findUniqueOrThrow({ where: { id: orgId } });
    // The customer's email: the user who made the payment, else the org's, else its first user.
    const payer = p.userId ? await this.db.user.findUnique({ where: { id: p.userId }, select: { email: true } }) : null;
    const owner = payer?.email || org.email ? null : await this.db.user.findFirst({ where: { orgId, email: { not: null } }, orderBy: { createdAt: 'asc' }, select: { email: true } });
    const view = this.paymentView(p);
    const number = p.number ?? p.id.slice(0, 8).toUpperCase();
    const pdf = await renderBillingInvoice({
      number,
      kind: p.kind,
      date: p.paidAt ?? p.createdAt,
      customer: { name: org.name, email: payer?.email ?? org.email ?? owner?.email ?? null, phone: org.phone },
      method: p.method,
      items: view.items,
      total: view.amount,
      pack: p.notes,
      checkoutId: p.checkoutId,
      trackId: p.trackId,
      fmtMoney: dzd,
    });
    return { pdf, number };
  }

  // -------------------------------------------------------------- account

  async getAccount(userId: string) {
    const u = await this.db.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, email: true, username: true, displayName: true, phone: true, twoFactorEnabled: true, emailVerifiedAt: true },
    });
    const { emailVerifiedAt, ...rest } = u;
    // Sub-users without an email have no second factor to speak of.
    return { ...rest, emailVerified: !!emailVerifiedAt, twoFactorEnabled: !!u.email && u.twoFactorEnabled };
  }

  /** Turning the second factor off asks for the password (a stolen session must not be able to drop it). */
  async setTwoFactor(userId: string, enabled: boolean, password?: string) {
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, passwordHash: true } });
    if (!user.email) throw new BadRequestException('La double authentification nécessite une adresse e-mail sur le compte.');
    if (!enabled) {
      if (!password || !(await bcrypt.compare(password, user.passwordHash))) throw new BadRequestException('Mot de passe incorrect.');
    }
    await this.db.user.update({ where: { id: userId }, data: { twoFactorEnabled: enabled } });
    return this.getAccount(userId);
  }

  async updateAccount(userId: string, dto: UpdateAccountDto) {
    const data: Prisma.UserUpdateInput = {};
    if (dto.email !== undefined) data.email = dto.email.trim().toLowerCase();
    if (dto.username !== undefined) data.username = dto.username.trim();
    if (dto.displayName !== undefined) data.displayName = dto.displayName.trim() || null;
    if (dto.phone !== undefined) data.phone = dto.phone.trim() || null;
    if (typeof data.email === 'string') {
      const taken = await this.db.user.findFirst({ where: { email: { equals: data.email, mode: 'insensitive' }, NOT: { id: userId } }, select: { id: true } });
      if (taken) throw new ConflictException('Cette adresse email est déjà utilisée.');
    }
    if (typeof data.username === 'string') {
      const taken = await this.db.user.findFirst({ where: { username: data.username, NOT: { id: userId } }, select: { id: true } });
      if (taken) throw new ConflictException("Ce nom d'utilisateur est déjà pris.");
    }
    // A new address has not proven it can read its mail: it must be confirmed (by code) at the next login.
    if (typeof data.email === 'string') {
      const current = await this.db.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } });
      if ((current.email ?? '').toLowerCase() !== data.email) data.emailVerifiedAt = null;
    }
    await this.db.user.update({ where: { id: userId }, data });
    return this.getAccount(userId);
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId }, select: { passwordHash: true } });
    if (!(await bcrypt.compare(dto.currentPassword, user.passwordHash))) {
      throw new BadRequestException('Mot de passe actuel incorrect.');
    }
    if (dto.currentPassword === dto.newPassword) throw new BadRequestException("Le nouveau mot de passe doit être différent de l'actuel.");
    await this.db.user.update({ where: { id: userId }, data: { passwordHash: await bcrypt.hash(dto.newPassword, 10) } });
    return { ok: true };
  }
}
