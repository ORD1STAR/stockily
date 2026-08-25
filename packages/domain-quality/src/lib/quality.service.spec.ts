import { InMemoryQualityDataPort } from './in-memory-quality-data-port.test-helper.js';
import { QualityService } from './quality.service.js';
import { InvalidQualityCheckInputError, NonConformityAlreadyResolvedError, UnknownBatchError, UnknownProductError } from './types.js';

function makePort() {
  const port = new InMemoryQualityDataPort();
  port.seedProduct({ id: 'prod-1', isLotTracked: true });
  port.seedProduct({ id: 'prod-2', isLotTracked: false }); // e.g. the belt
  return port;
}

describe('QualityService.createBatch', () => {
  it('creates a batch for a known product', async () => {
    const port = makePort();
    const service = new QualityService(port);
    const batch = await service.createBatch({ orgId: 'org-1', productId: 'prod-1', lotNumber: 'LOT-1', quantityReceived: 100 });
    expect(batch.status).toBe('active');
    expect(batch.lotNumber).toBe('LOT-1');
  });

  it('rejects an unknown product', async () => {
    const service = new QualityService(makePort());
    await expect(service.createBatch({ orgId: 'org-1', productId: 'nope', lotNumber: 'LOT-1', quantityReceived: 1 })).rejects.toBeInstanceOf(
      UnknownProductError,
    );
  });
});

describe('QualityService.recordQualityCheck — batch-based path', () => {
  it('a conforme result opens no non-conformity and requires no quarantine', async () => {
    const port = makePort();
    const service = new QualityService(port);
    const batch = await service.createBatch({ orgId: 'org-1', productId: 'prod-1', lotNumber: 'LOT-1', quantityReceived: 50 });
    port.seedBatchQuantity(batch.id, 'site-1', 50);

    const result = await service.recordQualityCheck({ orgId: 'org-1', productId: 'prod-1', batchId: batch.id, result: 'conforme' });

    expect(result.nonConformity).toBeNull();
    expect(result.quarantineTargets).toEqual([]);
    expect((await port.getBatch('org-1', batch.id))?.status).toBe('active');
  });

  it('a non_conforme result opens a non-conformity, quarantines every site holding the batch, and marks it quarantined', async () => {
    const port = makePort();
    const service = new QualityService(port);
    const batch = await service.createBatch({ orgId: 'org-1', productId: 'prod-1', lotNumber: 'LOT-1', quantityReceived: 50 });
    // simulates a batch split across two sites via a transfer, per docs/MILESTONE_3.md's derivation
    port.seedBatchQuantity(batch.id, 'site-1', 30);
    port.seedBatchQuantity(batch.id, 'site-2', 20);

    const result = await service.recordQualityCheck({
      orgId: 'org-1',
      productId: 'prod-1',
      batchId: batch.id,
      result: 'non_conforme',
      notes: "défaut d'étanchéité",
    });

    expect(result.nonConformity).not.toBeNull();
    expect(result.nonConformity?.status).toBe('open');
    expect(result.quarantineTargets.sort((a, b) => a.siteId.localeCompare(b.siteId))).toEqual([
      { siteId: 'site-1', quantity: 30 },
      { siteId: 'site-2', quantity: 20 },
    ]);
    expect((await port.getBatch('org-1', batch.id))?.status).toBe('quarantined');
    expect(result.events).toContainEqual(
      expect.objectContaining({ kind: 'NonConformityOpened', batchId: batch.id, productId: 'prod-1' }),
    );
  });

  it('rejects an unknown batch', async () => {
    const service = new QualityService(makePort());
    await expect(
      service.recordQualityCheck({ orgId: 'org-1', productId: 'prod-1', batchId: 'nope', result: 'conforme' }),
    ).rejects.toBeInstanceOf(UnknownBatchError);
  });
});

describe('QualityService.recordQualityCheck — product-direct path (non-lot-tracked product)', () => {
  it('a non_conforme result quarantines exactly the caller-stated site/quantity, no batch involved', async () => {
    const port = makePort();
    const service = new QualityService(port);

    const result = await service.recordQualityCheck({
      orgId: 'org-1',
      productId: 'prod-2',
      siteId: 'site-1',
      quantity: 8,
      result: 'non_conforme',
      notes: 'défaut de couture à la livraison',
    });

    expect(result.check.batchId).toBeNull();
    expect(result.nonConformity?.batchId).toBeNull();
    expect(result.quarantineTargets).toEqual([{ siteId: 'site-1', quantity: 8 }]);
  });

  it('rejects a call with both batchId and siteId/quantity', async () => {
    const service = new QualityService(makePort());
    await expect(
      // @ts-expect-error — deliberately malformed to exercise the guard; the discriminated union normally prevents this at compile time
      service.recordQualityCheck({ orgId: 'org-1', productId: 'prod-1', batchId: 'b1', siteId: 's1', quantity: 1, result: 'conforme' }),
    ).rejects.toBeInstanceOf(InvalidQualityCheckInputError);
  });

  it('rejects a call with neither batchId nor siteId/quantity', async () => {
    const service = new QualityService(makePort());
    await expect(
      // @ts-expect-error — same as above
      service.recordQualityCheck({ orgId: 'org-1', productId: 'prod-1', result: 'conforme' }),
    ).rejects.toBeInstanceOf(InvalidQualityCheckInputError);
  });
});

describe('QualityService non-conformity lifecycle', () => {
  it('resolves an open non-conformity and rejects resolving it twice', async () => {
    const port = makePort();
    const service = new QualityService(port);
    const batch = await service.createBatch({ orgId: 'org-1', productId: 'prod-1', lotNumber: 'LOT-1', quantityReceived: 10 });
    port.seedBatchQuantity(batch.id, 'site-1', 10);
    const { nonConformity } = await service.recordQualityCheck({ orgId: 'org-1', productId: 'prod-1', batchId: batch.id, result: 'non_conforme' });

    const resolved = await service.resolveNonConformity('org-1', nonConformity!.id, 'Repris par le fournisseur');
    expect(resolved.status).toBe('resolved');

    await expect(service.resolveNonConformity('org-1', nonConformity!.id, null)).rejects.toBeInstanceOf(NonConformityAlreadyResolvedError);
  });
});

describe('QualityService.runExpirySweep', () => {
  it('alerts a batch within the near-expiry window exactly once', async () => {
    const port = makePort();
    const service = new QualityService(port);
    const soon = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(); // 10 days out, within NEAR_EXPIRY_DAYS=30
    const batch = await service.createBatch({ orgId: 'org-1', productId: 'prod-1', lotNumber: 'LOT-SOON', expiryDate: soon, quantityReceived: 5 });

    const first = await service.runExpirySweep('org-1');
    expect(first.newAlerts).toHaveLength(1);
    expect(first.autoQuarantined).toHaveLength(0);
    expect(await port.hasExpiryAlert(batch.id)).toBe(true);

    const second = await service.runExpirySweep('org-1'); // must not re-alert
    expect(second.newAlerts).toHaveLength(0);
  });

  it('auto-quarantines a batch whose expiry has already passed, at every site holding it', async () => {
    const port = makePort();
    const service = new QualityService(port);
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const batch = await service.createBatch({ orgId: 'org-1', productId: 'prod-1', lotNumber: 'LOT-EXPIRED', expiryDate: past, quantityReceived: 12 });
    port.seedBatchQuantity(batch.id, 'site-1', 12);

    const result = await service.runExpirySweep('org-1');
    expect(result.autoQuarantined).toHaveLength(1);
    expect(result.autoQuarantined[0].targets).toEqual([{ siteId: 'site-1', quantity: 12 }]);
    expect((await port.getBatch('org-1', batch.id))?.status).toBe('quarantined');
    expect(result.events).toContainEqual(expect.objectContaining({ kind: 'BatchExpired', batchId: batch.id }));
  });

  it('does not touch a batch with no expiryDate', async () => {
    const port = makePort();
    const service = new QualityService(port);
    await service.createBatch({ orgId: 'org-1', productId: 'prod-1', lotNumber: 'LOT-NO-EXP', quantityReceived: 1 });
    const result = await service.runExpirySweep('org-1');
    expect(result.newAlerts).toHaveLength(0);
    expect(result.autoQuarantined).toHaveLength(0);
  });
});
