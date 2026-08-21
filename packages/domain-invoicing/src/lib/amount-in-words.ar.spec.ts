import { amountToArabicWords } from './amount-in-words.ar.js';

// These assert internal consistency with the documented rules in
// amount-in-words.ar.ts, not independently-verified linguistic correctness
// — see that file's header for the honest limitation.
describe('amountToArabicWords', () => {
  it('renders zero', () => {
    expect(amountToArabicWords(0)).toBe('صفر دينار');
  });

  it('renders exactly 1 (singular)', () => {
    expect(amountToArabicWords(1)).toBe('دينار واحد');
  });

  it('renders exactly 2 (dual)', () => {
    expect(amountToArabicWords(2)).toBe('ديناران');
  });

  it('renders 3-10 with the ة-suffixed masculine-agreement form and plural noun', () => {
    expect(amountToArabicWords(3)).toBe('ثلاثة دنانير');
    expect(amountToArabicWords(10)).toBe('عشرة دنانير');
  });

  it('renders 11-99 with a singular noun', () => {
    expect(amountToArabicWords(11)).toContain('دينار');
    expect(amountToArabicWords(11)).not.toContain('دنانير');
    expect(amountToArabicWords(23)).toBe('ثلاثة وعشرون دينار');
  });

  it('renders a non-trivial amount without throwing and includes the currency noun', () => {
    const result = amountToArabicWords(48139);
    expect(result).toContain('دينار');
    expect(result.length).toBeGreaterThan(0);
  });

  it('appends centimes when present', () => {
    const result = amountToArabicWords(48139.5);
    expect(result).toContain('سنتيم');
  });
});
