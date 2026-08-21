import { InMemoryStockDataPort } from './in-memory-stock-data-port.test-helper.js';
import { StockMovementService } from './stock-movement.service.js';
import { InsufficientQuarantineSourceError, NegativeStockError, UnknownProductError } from './types.js';

const ORG = 'org-1';
const SITE_A = 'site-a';
const SITE_B = 'site-b';
const PRODUCT = 'product-1';

function makeService() {
  const port = new InMemoryStockDataPort();
  port.seedProduct({ id: PRODUCT, isLotTracked: false, averageCost: 0, minThreshold: 10, maxThreshold: null });
  return { port, service: new StockMovementService(port) };
}

describe('StockMovementService.recordMovement', () => {
  it('rejects an unknown product', async () => {
    const { service } = makeService();
    await expect(
      service.recordMovement({ orgId: ORG, productId: 'nope', siteId: SITE_A, type: 'IN', quantity: 5 }),
    ).rejects.toBeInstanceOf(UnknownProductError);
  });

  it('rejects a non-positive quantity', async () => {
    const { service } = makeService();
    await expect(
      service.recordMovement({ orgId: ORG, productId: PRODUCT, siteId: SITE_A, type: 'IN', quantity: 0 }),
    ).rejects.toBeInstanceOf(RangeError);
  });

  it('IN increases onHand and recalculates Weighted Average Cost', async () => {
    const { port, service } = makeService();
    port.products.get(PRODUCT)!.averageCost = 10; // 10 units already at cost 10 each (implied)
    port.seedStockLevel(PRODUCT, SITE_A, { quantityOnHand: 10, quantityQuarantined: 0, quantityReserved: 0 });

    // Buy 10 more at unit cost 20 -> new average = (10*10 + 20*10) / 20 = 15
    const result = await service.recordMovement({
      orgId: ORG,
      productId: PRODUCT,
      siteId: SITE_A,
      type: 'IN',
      quantity: 10,
      unitCost: 20,
    });

    expect(result.fromStockLevel.quantityOnHand).toBe(20);
    expect(port.products.get(PRODUCT)!.averageCost).toBe(15);
    expect(result.events).toEqual([
      expect.objectContaining({ kind: 'StockMovementCreated', movementType: 'IN', quantity: 10 }),
    ]);
  });

  it('IN with no unitCost leaves averageCost untouched', async () => {
    const { port, service } = makeService();
    port.products.get(PRODUCT)!.averageCost = 42;

    await service.recordMovement({ orgId: ORG, productId: PRODUCT, siteId: SITE_A, type: 'IN', quantity: 5 });

    expect(port.products.get(PRODUCT)!.averageCost).toBe(42);
  });

  it('OUT decreases onHand', async () => {
    const { port, service } = makeService();
    port.seedStockLevel(PRODUCT, SITE_A, { quantityOnHand: 50, quantityQuarantined: 0, quantityReserved: 0 });

    const result = await service.recordMovement({ orgId: ORG, productId: PRODUCT, siteId: SITE_A, type: 'OUT', quantity: 20 });

    expect(result.fromStockLevel.quantityOnHand).toBe(30);
  });

  it('OUT beyond available stock is rejected (negative stock blocked, §9 decision #3)', async () => {
    const { port, service } = makeService();
    port.seedStockLevel(PRODUCT, SITE_A, { quantityOnHand: 5, quantityQuarantined: 0, quantityReserved: 0 });

    await expect(
      service.recordMovement({ orgId: ORG, productId: PRODUCT, siteId: SITE_A, type: 'OUT', quantity: 6 }),
    ).rejects.toBeInstanceOf(NegativeStockError);

    // Rejected movement must not have partially applied.
    expect((await port.getOrCreateStockLevel(PRODUCT, SITE_A)).quantityOnHand).toBe(5);
  });

  it('TRANSFER moves quantity from source to destination site in one call, two movement rows', async () => {
    const { port, service } = makeService();
    port.seedStockLevel(PRODUCT, SITE_A, { quantityOnHand: 40, quantityQuarantined: 0, quantityReserved: 0 });

    const result = await service.recordMovement({
      orgId: ORG,
      productId: PRODUCT,
      siteId: SITE_A,
      toSiteId: SITE_B,
      type: 'TRANSFER',
      quantity: 15,
    });

    expect(result.fromStockLevel.quantityOnHand).toBe(25);
    expect(result.toStockLevel?.quantityOnHand).toBe(15);
    expect(result.movementId).not.toBe(result.transferMovementId);
    expect(port.movements).toHaveLength(2);
    expect(port.movements.map((m) => m.siteId).sort()).toEqual([SITE_A, SITE_B].sort());
  });

  it('TRANSFER requires a distinct destination site', async () => {
    const { service } = makeService();
    await expect(
      service.recordMovement({ orgId: ORG, productId: PRODUCT, siteId: SITE_A, toSiteId: SITE_A, type: 'TRANSFER', quantity: 5 }),
    ).rejects.toBeInstanceOf(RangeError);
  });

  it('ADJUSTMENT requires a direction', async () => {
    const { service } = makeService();
    await expect(
      service.recordMovement({ orgId: ORG, productId: PRODUCT, siteId: SITE_A, type: 'ADJUSTMENT', quantity: 3 }),
    ).rejects.toBeInstanceOf(RangeError);
  });

  it('ADJUSTMENT decrease is still blocked from going negative', async () => {
    const { port, service } = makeService();
    port.seedStockLevel(PRODUCT, SITE_A, { quantityOnHand: 2, quantityQuarantined: 0, quantityReserved: 0 });

    await expect(
      service.recordMovement({
        orgId: ORG,
        productId: PRODUCT,
        siteId: SITE_A,
        type: 'ADJUSTMENT',
        adjustmentDirection: 'decrease',
        quantity: 5,
      }),
    ).rejects.toBeInstanceOf(NegativeStockError);
  });

  it('emits StockLevelLow exactly on the ok -> low/out crossing, not on every subsequent movement', async () => {
    const { port, service } = makeService(); // minThreshold = 10
    port.seedStockLevel(PRODUCT, SITE_A, { quantityOnHand: 15, quantityQuarantined: 0, quantityReserved: 0 });

    const crossing = await service.recordMovement({ orgId: ORG, productId: PRODUCT, siteId: SITE_A, type: 'OUT', quantity: 6 }); // 15 -> 9, crosses below 10
    expect(crossing.events).toContainEqual(expect.objectContaining({ kind: 'StockLevelLow', quantityOnHand: 9, minThreshold: 10 }));

    const stillLow = await service.recordMovement({ orgId: ORG, productId: PRODUCT, siteId: SITE_A, type: 'OUT', quantity: 1 }); // 9 -> 8, already low
    expect(stillLow.events.some((e) => e.kind === 'StockLevelLow')).toBe(false);
  });

  it('does not emit StockLevelLow when the product has no minThreshold configured', async () => {
    const { port, service } = makeService();
    port.products.get(PRODUCT)!.minThreshold = null;
    port.seedStockLevel(PRODUCT, SITE_A, { quantityOnHand: 5, quantityQuarantined: 0, quantityReserved: 0 });

    const result = await service.recordMovement({ orgId: ORG, productId: PRODUCT, siteId: SITE_A, type: 'OUT', quantity: 5 });
    expect(result.events.some((e) => e.kind === 'StockLevelLow')).toBe(false);
  });
});

describe('StockMovementService.quarantine', () => {
  it('moves quantity from onHand to quarantined without changing the total', async () => {
    const { port, service } = makeService();
    port.seedStockLevel(PRODUCT, SITE_A, { quantityOnHand: 20, quantityQuarantined: 3, quantityReserved: 0 });

    const result = await service.quarantine({ orgId: ORG, productId: PRODUCT, siteId: SITE_A, quantity: 5, reason: 'expired' });

    expect(result.stockLevel.quantityOnHand).toBe(15);
    expect(result.stockLevel.quantityQuarantined).toBe(8);
    expect(result.events).toEqual([expect.objectContaining({ kind: 'StockQuarantined', quantity: 5, reason: 'expired' })]);
  });

  it('does not create a StockMovement row (§ design note: reclassification, not a ledger entry)', async () => {
    const { port, service } = makeService();
    port.seedStockLevel(PRODUCT, SITE_A, { quantityOnHand: 20, quantityQuarantined: 0, quantityReserved: 0 });

    await service.quarantine({ orgId: ORG, productId: PRODUCT, siteId: SITE_A, quantity: 5, reason: 'expired' });

    expect(port.movements).toHaveLength(0);
  });

  it('rejects quarantining more than is on hand', async () => {
    const { port, service } = makeService();
    port.seedStockLevel(PRODUCT, SITE_A, { quantityOnHand: 3, quantityQuarantined: 0, quantityReserved: 0 });

    await expect(
      service.quarantine({ orgId: ORG, productId: PRODUCT, siteId: SITE_A, quantity: 4, reason: 'expired' }),
    ).rejects.toBeInstanceOf(InsufficientQuarantineSourceError);
  });
});
