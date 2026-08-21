import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  InvalidQualityCheckInputError,
  NonConformityAlreadyResolvedError,
  QualityService as DomainQualityService,
  UnknownBatchError,
  UnknownNonConformityError,
  UnknownProductError,
} from '@org/domain-quality';
import { PrismaQualityDataPort } from '@org/infra-db';
import { PrismaService } from '../../prisma/prisma.service';
import { StockService } from '../stock/stock.service';
import { CreateBatchDto } from './dto/create-batch.dto';
import { RecordQualityCheckDto } from './dto/record-quality-check.dto';

// Thin NestJS wrapper around @org/domain-quality's QualityService, the same
// shape as StockService wraps @org/domain-stock (docs/Action Plan.md §1/§5/
// §6/§7). Also the ONLY thing that turns domain-quality's `quarantineTargets`
// (plain data) into real StockService.quarantine calls — this is the
// cross-module integration point, done at the apps/api orchestration layer
// rather than domain-quality depending on domain-stock directly (see
// domain-quality's QualityService doc comment for why).
@Injectable()
export class QualityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
    private readonly stock: StockService,
  ) {}

  private domainService(): DomainQualityService {
    return new DomainQualityService(new PrismaQualityDataPort(this.prisma));
  }

  async createBatch(orgId: string, dto: CreateBatchDto) {
    try {
      return await this.domainService().createBatch({ orgId, ...dto });
    } catch (err) {
      throw this.translateError(err);
    }
  }

  listBatches(orgId: string, productId?: string) {
    return this.domainService().listBatches(orgId, { productId });
  }

  /**
   * Batches for one product, each enriched with its most recent quality
   * check result — exactly what the Stock module's SKU-detail view needs
   * (docs/Wireframes.html's lot table). A presentation-shaping join, so it
   * lives here (apps/api) rather than in domain-quality's own service,
   * which stays about batch/check *logic*, not this kind of read-model
   * assembly.
   */
  async listBatchesWithLatestCheck(orgId: string, productId: string) {
    const batches = await this.domainService().listBatches(orgId, { productId });
    if (batches.length === 0) return [];

    const checks = await this.prisma.qualityCheck.findMany({
      where: { orgId, batchId: { in: batches.map((b) => b.id) } },
      orderBy: { checkedAt: 'desc' },
    });
    const latestByBatch = new Map<string, (typeof checks)[number]>();
    for (const c of checks) {
      if (c.batchId && !latestByBatch.has(c.batchId)) latestByBatch.set(c.batchId, c);
    }

    return batches.map((b) => {
      const latest = latestByBatch.get(b.id);
      return { ...b, latestCheck: latest ? { result: latest.result, checkedAt: latest.checkedAt.toISOString() } : null };
    });
  }

  async getBatch(orgId: string, batchId: string) {
    try {
      return await this.domainService().getBatch(orgId, batchId);
    } catch (err) {
      throw this.translateError(err);
    }
  }

  /**
   * Records the check, then — if it failed — actually performs the
   * quarantine(s) domain-quality computed were necessary, one
   * StockService.quarantine call per affected site. If a site's quarantine
   * call fails (e.g. the derived remaining quantity somehow doesn't match
   * what Stock's own ledger says right now — a race with a concurrent
   * movement, not expected in normal operation), that failure surfaces to
   * the caller as-is: the check/non-conformity already committed is not
   * rolled back, since the check itself is a true, standalone fact ("this
   * was inspected and failed") independent of whether the mechanical
   * quarantine bookkeeping fully caught up — flagged in docs/MILESTONE_3.md
   * as a known edge case, not silently swallowed.
   */
  async recordQualityCheck(orgId: string, performedBy: string, dto: RecordQualityCheckDto) {
    let result;
    try {
      result = await this.domainService().recordQualityCheck({
        orgId,
        productId: dto.productId,
        result: dto.result,
        notes: dto.notes,
        checkedBy: performedBy,
        ...(dto.batchId ? { batchId: dto.batchId } : { siteId: dto.siteId as string, quantity: dto.quantity as number }),
      });
    } catch (err) {
      throw this.translateError(err);
    }

    this.publish(result.events);

    for (const target of result.quarantineTargets) {
      await this.stock.quarantine({
        orgId,
        productId: dto.productId,
        siteId: target.siteId,
        quantity: target.quantity,
        batchId: dto.batchId,
        reason: dto.result === 'non_conforme' ? `Contrôle qualité non conforme${dto.notes ? ` — ${dto.notes}` : ''}` : 'quality_check',
        performedBy,
      });
    }

    return result;
  }

  listNonConformities(orgId: string, status?: 'open' | 'resolved') {
    return this.domainService().listNonConformities(orgId, status);
  }

  async resolveNonConformity(orgId: string, id: string, resolutionNotes?: string) {
    try {
      return await this.domainService().resolveNonConformity(orgId, id, resolutionNotes ?? null);
    } catch (err) {
      throw this.translateError(err);
    }
  }

  /**
   * Runs the expiry sweep on-demand and returns the current alert list.
   * Also invoked periodically by ExpirySweepScheduler — calling it here too
   * means a dev/demo environment that never has the scheduler tick still
   * sees correct, up-to-date data the moment this endpoint is hit.
   */
  async listExpiryAlerts(orgId: string) {
    const sweep = await this.domainService().runExpirySweep(orgId);
    this.publish(sweep.events);
    for (const { batch, targets } of sweep.autoQuarantined) {
      for (const target of targets) {
        await this.stock.quarantine({
          orgId,
          productId: batch.productId,
          siteId: target.siteId,
          quantity: target.quantity,
          batchId: batch.id,
          reason: 'Péremption dépassée — quarantaine automatique',
        });
      }
    }
    return this.prisma.expiryAlert.findMany({
      where: { orgId },
      include: { batch: { include: { product: { select: { id: true, sku: true, name: true } } } } },
      orderBy: { alertedAt: 'desc' },
    });
  }

  private publish(events: { kind: string }[]): void {
    for (const event of events) this.events.emit(event.kind, event);
  }

  private translateError(err: unknown): Error {
    if (err instanceof UnknownProductError || err instanceof UnknownBatchError || err instanceof UnknownNonConformityError) {
      return new NotFoundException(err.message);
    }
    if (err instanceof InvalidQualityCheckInputError) {
      return new BadRequestException({ statusCode: 400, error: 'invalid_quality_check_input', message: err.message });
    }
    if (err instanceof NonConformityAlreadyResolvedError) {
      return new ConflictException(err.message);
    }
    return err as Error;
  }
}
