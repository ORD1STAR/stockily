// Self-implemented French number-to-words (Action Plan §9/§11 — bilingual
// FR/AR amount-in-words is in scope for Phase 1, not deferred; no npm
// dependency chosen deliberately — this is a well-defined, bounded
// algorithm and a hand-rolled implementation avoids pulling in a randomly
// vetted third-party package for something this contained). Traditional
// (pre-1990-reform) spacing/hyphenation, matching the exact style already
// shown in docs/Wireframes.html's invoice mock: "quarante-huit mille cent
// trente-neuf" — hyphens only within a tens+units pair, plain spaces around
// "cent"/"mille". Verified against that string in amount-in-words.spec.ts.

const UNITS = [
  'zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf',
  'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf',
];
const TENS: Record<number, string> = { 20: 'vingt', 30: 'trente', 40: 'quarante', 50: 'cinquante', 60: 'soixante' };

function twoDigits(n: number): string {
  if (n < 17) return UNITS[n];
  if (n < 20) return UNITS[n];
  if (n < 70) {
    const tens = Math.floor(n / 10) * 10;
    const rem = n % 10;
    const word = TENS[tens];
    if (rem === 0) return word;
    if (rem === 1) return `${word}-et-un`;
    return `${word}-${UNITS[rem]}`;
  }
  if (n < 80) {
    const rem = n - 60; // 10..19
    if (rem === 11) return 'soixante-et-onze';
    return `soixante-${UNITS[rem]}`;
  }
  // 80-99
  const rem = n - 80;
  if (rem === 0) return 'quatre-vingts';
  return `quatre-vingt-${UNITS[rem]}`;
}

function threeDigits(n: number): string {
  const h = Math.floor(n / 100);
  const rem = n % 100;
  if (h === 0) return twoDigits(rem);
  const hundredWord = h === 1 ? 'cent' : `${UNITS[h]} cent${rem === 0 ? 's' : ''}`;
  return rem === 0 ? hundredWord : `${hundredWord} ${twoDigits(rem)}`;
}

/** Whole non-negative integers only — amountToFrenchWords below handles sign/decimals. */
export function numberToFrenchWords(n: number): string {
  if (!Number.isInteger(n) || n < 0) {
    throw new RangeError(`numberToFrenchWords expects a non-negative integer, got ${n}`);
  }
  if (n === 0) return 'zéro';

  const billion = Math.floor(n / 1_000_000_000);
  const million = Math.floor((n % 1_000_000_000) / 1_000_000);
  const thousand = Math.floor((n % 1_000_000) / 1000);
  const rest = n % 1000;

  const parts: string[] = [];
  if (billion > 0) parts.push(billion === 1 ? 'un milliard' : `${threeDigits(billion)} milliards`);
  if (million > 0) parts.push(million === 1 ? 'un million' : `${threeDigits(million)} millions`);
  if (thousand > 0) parts.push(thousand === 1 ? 'mille' : `${threeDigits(thousand)} mille`);
  if (rest > 0 || parts.length === 0) parts.push(threeDigits(rest));

  return parts.join(' ');
}

function pluralize(word: string, n: number): string {
  return n === 1 ? word : `${word}s`;
}

/** e.g. 48139 -> "quarante-huit mille cent trente-neuf dinars algériens" (matches docs/Wireframes.html exactly). */
export function amountToFrenchWords(amount: number): string {
  const rounded = Math.round(Math.abs(amount) * 100) / 100;
  const dinars = Math.floor(rounded);
  const centimes = Math.round((rounded - dinars) * 100);

  const dinarPhrase = `${numberToFrenchWords(dinars)} ${pluralize('dinar', dinars)} ${pluralize('algérien', dinars)}`;
  if (centimes === 0) return dinarPhrase;

  const centimePhrase = `${numberToFrenchWords(centimes)} ${pluralize('centime', centimes)}`;
  return `${dinarPhrase} et ${centimePhrase}`;
}
