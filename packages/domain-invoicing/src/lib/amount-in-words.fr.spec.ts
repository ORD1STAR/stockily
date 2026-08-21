import { amountToFrenchWords, numberToFrenchWords } from './amount-in-words.fr.js';

describe('numberToFrenchWords', () => {
  it.each([
    [0, 'zéro'],
    [1, 'un'],
    [16, 'seize'],
    [17, 'dix-sept'],
    [21, 'vingt-et-un'],
    [39, 'trente-neuf'],
    [71, 'soixante-et-onze'],
    [72, 'soixante-douze'],
    [80, 'quatre-vingts'],
    [81, 'quatre-vingt-un'],
    [91, 'quatre-vingt-onze'],
    [99, 'quatre-vingt-dix-neuf'],
    [100, 'cent'],
    [101, 'cent un'],
    [139, 'cent trente-neuf'],
    [200, 'deux cents'],
    [201, 'deux cent un'],
    [999, 'neuf cent quatre-vingt-dix-neuf'],
    [1000, 'mille'],
    [2000, 'deux mille'],
    [48139, 'quarante-huit mille cent trente-neuf'],
    [1000000, 'un million'],
    [2000000, 'deux millions'],
    [1000000000, 'un milliard'],
  ])('%i -> %s', (n, expected) => {
    expect(numberToFrenchWords(n)).toBe(expected);
  });

  it('rejects negative numbers and non-integers', () => {
    expect(() => numberToFrenchWords(-1)).toThrow(RangeError);
    expect(() => numberToFrenchWords(1.5)).toThrow(RangeError);
  });
});

describe('amountToFrenchWords', () => {
  it('matches the exact wireframe string for 48139', () => {
    expect(amountToFrenchWords(48139)).toBe('quarante-huit mille cent trente-neuf dinars algériens');
  });

  it('singularizes exactly 1 dinar', () => {
    expect(amountToFrenchWords(1)).toBe('un dinar algérien');
  });

  it('appends centimes when the amount has a fractional part', () => {
    expect(amountToFrenchWords(48139.5)).toBe('quarante-huit mille cent trente-neuf dinars algériens et cinquante centimes');
  });

  it('singularizes exactly 1 centime', () => {
    expect(amountToFrenchWords(1.01)).toBe('un dinar algérien et un centime');
  });
});
