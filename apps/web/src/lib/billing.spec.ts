import { formatDuration } from './billing';

const at = (iso: string) => new Date(`${iso}T12:00:00`);

describe('formatDuration', () => {
  const from = at('2026-11-06');
  it('keeps days up to a month', () => {
    expect(formatDuration(at('2026-11-07'), from)).toBe('1 j');
    expect(formatDuration(at('2026-11-21'), from)).toBe('15 j');
    expect(formatDuration(at('2026-12-06'), from)).toBe('30 j');
  });
  it('switches to months and days', () => {
    expect(formatDuration(at('2027-02-06'), from)).toBe('3 mois');
    expect(formatDuration(at('2027-01-18'), from)).toBe('2 mois et 12 j');
    expect(formatDuration(at('2027-05-20'), from)).toBe('6 mois et 14 j');
  });
  it('switches to years beyond 12 months', () => {
    expect(formatDuration(at('2027-11-06'), from)).toBe('1 an');
    expect(formatDuration(at('2028-01-06'), from)).toBe('1 an et 2 mois');
    expect(formatDuration(at('2028-11-06'), from)).toBe('2 ans');
  });
  it('ignores the time of day (an exact 6 months stays 6 months)', () => {
    const now = new Date('2026-11-06T17:30:00');
    expect(formatDuration(new Date('2027-05-06T09:15:00'), now)).toBe('6 mois');
    expect(formatDuration(new Date('2027-05-21T09:15:00'), now)).toBe('6 mois et 15 j');
  });
  it('never goes negative', () => {
    expect(formatDuration(at('2026-11-01'), from)).toBe('0 j');
  });
});
