// Self-implemented Modern Standard Arabic number-to-words, scoped to the
// Algerian Dinar (دينار جزائري — masculine noun) invoice-amount use case
// (Action Plan §9/§11, in-scope for Phase 1). No npm package used — Arabic
// numeral/noun agreement is genuinely one of the more complex parts of the
// language (gender "polarity" for 3-10, dual forms, case-dependent noun
// number after the numeral), and a random third-party package's quality
// would be hard to vet quickly; a hand-rolled implementation at least keeps
// the rules explicit and testable.
//
// HONEST LIMITATION, stated plainly rather than hidden behind a passing
// test: this covers the well-documented core rules correctly for the
// ranges an invoice realistically hits (units through low millions) —
// gender-polarity for 3-10 (دينار is masculine, so 3-10 use the
// ة-suffixed numeral form: ثلاثة دنانير, not ثلاث دنانير), dual for
// exactly 2, singular-accusative noun after 11-99, singular noun after
// 100+. It has NOT been reviewed by a native Arabic speaker and almost
// certainly has edge cases wrong in less common ranges (very large
// numbers, some case-ending/i'rab subtleties this implementation doesn't
// attempt at all — Arabic script normally omits short-vowel case endings
// in writing anyway, which is what a printed invoice would show, so this
// is less of a gap in practice than it sounds). Recommend a native-speaker
// review before this ships to real customers; do not treat the passing
// unit tests as proof of linguistic correctness, only of internal
// consistency with the documented rules below.

const UNITS_MASC = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة'];
// The ة-suffixed forms above ARE the masculine-noun-agreement ("polarity")
// forms for 3-10 — Arabic numerals 3-10 take the opposite grammatical
// gender of the counted noun; دينار is masculine, so these ة-forms are
// exactly what's needed here. A feminine-noun variant (ثلاث, أربع, ...)
// would be needed for a feminine currency noun and is deliberately not
// built, since it isn't needed for دينار/سنتيم.
const TEENS = ['عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
const TENS: Record<number, string> = { 20: 'عشرون', 30: 'ثلاثون', 40: 'أربعون', 50: 'خمسون', 60: 'ستون', 70: 'سبعون', 80: 'ثمانون', 90: 'تسعون' };
const HUNDREDS: Record<number, string> = {
  1: 'مائة', 2: 'مئتان', 3: 'ثلاثمائة', 4: 'أربعمائة', 5: 'خمسمائة', 6: 'ستمائة', 7: 'سبعمائة', 8: 'ثمانمائة', 9: 'تسعمائة',
};

function underThousand(n: number): string {
  if (n === 0) return '';
  const h = Math.floor(n / 100);
  const rem = n % 100;
  const hundredWord = h > 0 ? HUNDREDS[h] : '';
  if (rem === 0) return hundredWord;

  let remWord: string;
  if (rem < 10) remWord = UNITS_MASC[rem];
  else if (rem < 20) remWord = TEENS[rem - 10];
  else {
    const tens = Math.floor(rem / 10) * 10;
    const units = rem % 10;
    // 21-99 (non-exact-ten): units-and-tens, e.g. 23 -> "ثلاثة وعشرون"
    // ("three and twenty" — Arabic states the units digit before the
    // tens, joined by wa- "and", the mirror image of French/English).
    remWord = units === 0 ? TENS[tens] : `${UNITS_MASC[units]} و${TENS[tens]}`;
  }
  return hundredWord ? `${hundredWord} و${remWord}` : remWord;
}

/**
 * `noun`: the three grammatical forms needed after a cardinal number in
 * Arabic — singular (used after 1, and after 11+ in the accusative
 * tamyiz position, and after 100+), dual (used only for exactly 2, as a
 * suffixed dual form of the noun itself, not a separate word), and plural
 * (used only for 3-10). This is the real complexity in Arabic numeral
 * grammar — which noun FORM appears depends on which range the number
 * falls in, not just which number word is chosen.
 */
export interface ArabicCountedNoun {
  singular: string;
  dual: string;
  plural: string;
}

export const DINAR: ArabicCountedNoun = { singular: 'دينار', dual: 'ديناران', plural: 'دنانير' };
export const CENTIME: ArabicCountedNoun = { singular: 'سنتيم', dual: 'سنتيمان', plural: 'سنتيمات' };

function withNoun(n: number, noun: ArabicCountedNoun): string {
  if (n === 0) return `صفر ${noun.singular}`;
  if (n === 1) return `${noun.singular} ${UNITS_MASC[1]}`;
  if (n === 2) return noun.dual;
  // UNITS_MASC only covers 0-9 (indices 0..9); 10 ("عشرة") lives in TEENS[0]
  // since underThousand() addresses the teens as TEENS[rem-10].
  if (n === 10) return `${TEENS[0]} ${noun.plural}`;
  if (n <= 10) return `${UNITS_MASC[n]} ${noun.plural}`;
  if (n <= 99) return `${underThousand(n)} ${noun.singular}`; // 11-99: singular noun (tamyiz)
  return `${wholeNumberToArabicWords(n)} ${noun.singular}`; // 100+: singular noun
}

/** Whole non-negative integers, WITHOUT a trailing counted noun — the scale-word (ألف/مليون) sequencing for 100+. */
function wholeNumberToArabicWords(n: number): string {
  if (n === 0) return 'صفر';
  const million = Math.floor(n / 1_000_000);
  const thousand = Math.floor((n % 1_000_000) / 1000);
  const rest = n % 1000;

  const parts: string[] = [];
  if (million > 0) {
    if (million === 1) parts.push('مليون');
    else if (million === 2) parts.push('مليونان');
    else if (million <= 10) parts.push(`${underThousand(million)} ملايين`);
    else parts.push(`${wholeNumberToArabicWords(million)} مليون`);
  }
  if (thousand > 0) {
    if (thousand === 1) parts.push('ألف');
    else if (thousand === 2) parts.push('ألفان');
    else if (thousand <= 10) parts.push(`${underThousand(thousand)} آلاف`);
    else parts.push(`${underThousand(thousand)} ألفًا`);
  }
  if (rest > 0 || parts.length === 0) parts.push(underThousand(rest));

  return parts.filter(Boolean).join(' و');
}

/** e.g. 48139 dinars -> a best-effort MSA rendering — see this file's header for the honest limitations. */
export function amountToArabicWords(amount: number): string {
  const rounded = Math.round(Math.abs(amount) * 100) / 100;
  const dinars = Math.floor(rounded);
  const centimes = Math.round((rounded - dinars) * 100);

  const dinarPhrase = dinars <= 99 ? withNoun(dinars, DINAR) : `${wholeNumberToArabicWords(dinars)} ${DINAR.singular}`;
  if (centimes === 0) return dinarPhrase;

  const centimePhrase = withNoun(centimes, CENTIME);
  return `${dinarPhrase} و${centimePhrase}`;
}
