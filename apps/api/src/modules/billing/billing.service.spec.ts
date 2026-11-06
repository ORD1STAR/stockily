import { addMonths, isEntitlementUsable } from './billing.service';

describe('addMonths', () => {
  it('adds calendar months', () => {
    expect(addMonths(new Date('2026-11-06T10:00:00Z'), 1).toISOString()).toBe('2026-12-06T10:00:00.000Z');
    expect(addMonths(new Date('2026-11-06T10:00:00Z'), 12).toISOString()).toBe('2027-11-06T10:00:00.000Z');
  });
  it('clamps the day at month end instead of overflowing', () => {
    expect(addMonths(new Date('2026-01-31T00:00:00Z'), 1).toISOString()).toBe('2026-02-28T00:00:00.000Z');
    expect(addMonths(new Date('2028-01-31T00:00:00Z'), 1).toISOString()).toBe('2028-02-29T00:00:00.000Z');
  });
  it('does not mutate its input', () => {
    const d = new Date('2026-03-15T00:00:00Z');
    addMonths(d, 5);
    expect(d.toISOString()).toBe('2026-03-15T00:00:00.000Z');
  });
});

describe('isEntitlementUsable', () => {
  const now = new Date('2026-11-06T12:00:00Z').getTime();
  const day = 86_400_000;
  it('active with no end date is usable', () => {
    expect(isEntitlementUsable({ status: 'active', trialEndsAt: null, expiresAt: null }, now)).toBe(true);
  });
  it('active is usable until expiresAt, then not', () => {
    expect(isEntitlementUsable({ status: 'active', trialEndsAt: null, expiresAt: new Date(now + day) }, now)).toBe(true);
    expect(isEntitlementUsable({ status: 'active', trialEndsAt: null, expiresAt: new Date(now - 1) }, now)).toBe(false);
  });
  it('trial is usable only before trialEndsAt', () => {
    expect(isEntitlementUsable({ status: 'trial', trialEndsAt: new Date(now + day) }, now)).toBe(true);
    expect(isEntitlementUsable({ status: 'trial', trialEndsAt: new Date(now - day) }, now)).toBe(false);
    expect(isEntitlementUsable({ status: 'trial', trialEndsAt: null }, now)).toBe(false);
  });
  it('suspended, cancelled and expired are never usable', () => {
    for (const status of ['suspended', 'cancelled', 'expired']) {
      expect(isEntitlementUsable({ status, trialEndsAt: null, expiresAt: new Date(now + day) }, now)).toBe(false);
    }
  });
});
