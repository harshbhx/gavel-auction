import { SCALE, THOUSAND_WORDS, TENS, UNITS, isNumeral, smallValue } from './lexicon.js';

/**
 * Number words and numerals to integer cents. Both functions are pure and total; they return
 * null when the tokens are not a number they understand. A lone "zero" or "oh" is 0.
 */

const MAX_CENTS = Number.MAX_SAFE_INTEGER;

function isTensMultiple(v: number): boolean {
  return v >= 20 && v <= 90 && v % 10 === 0;
}

/** 1..99 as one word or "tens unit". */
function below100(t: string[]): number | null {
  if (t.length === 1) {
    const v = smallValue(t[0] ?? '');
    return v === undefined || v === 0 ? null : v;
  }
  if (t.length === 2) {
    const a = TENS[t[0] ?? ''];
    const b = UNITS[t[1] ?? ''];
    if (a !== undefined && b !== undefined && b > 0) return a + b;
  }
  return null;
}

/**
 * Colloquial hundreds without the word "hundred": "two fifty" 250, "twelve fifty" 1250,
 * "two fifty five" 255, "two oh five" 205, plus "fifty five" and digit read-outs ("two five" 25).
 */
function colloquial(t: string[]): number | null {
  const vals = t.map((w) => smallValue(w));
  if (vals.some((v) => v === undefined)) return null;
  const v = vals as number[];
  const a = v[0] ?? 0;
  const b = v[1] ?? 0;
  const lead = a <= 19;
  const tail = (b >= 10 && b <= 19) || isTensMultiple(b);
  if (v.length === 1) return a;
  if (v.length === 2 && lead && tail) return a * 100 + b;
  if (v.length === 3 && lead && isTensMultiple(b) && (v[2] ?? 99) < 10)
    return a * 100 + b + (v[2] ?? 0);
  if (
    v.length === 3 &&
    lead &&
    a > 0 &&
    b === 0 &&
    t[1] === 'oh' &&
    (v[2] ?? 0) > 0 &&
    (v[2] ?? 99) < 10
  ) {
    return a * 100 + (v[2] ?? 0);
  }
  if (v.length === 2 && isTensMultiple(a) && b > 0 && b < 10) return a + b;
  if (v.length === 2 && a < 10 && b < 10) return a * 10 + b;
  return null;
}

/** 0..999 as dollars, or null. Empty input is null. */
function below1000(t: string[]): number | null {
  if (t.length === 0) return null;
  const h = t.indexOf('hundred');
  if (h < 0) return colloquial(t);
  if (t.indexOf('hundred', h + 1) >= 0) return null;
  const left = t.slice(0, h);
  const right = t.slice(h + 1);
  const hundreds = left.length === 0 ? 1 : below100(left);
  if (hundreds === null) return null;
  if (right.length === 0) return hundreds * 100;
  const rest = below100(right);
  if (rest === null) return null;
  return hundreds * 100 + rest;
}

/** Whole dollars for a word sequence containing no scale k/grand and no "point". */
function integerWords(t: string[]): number | null {
  const th = t.indexOf('thousand');
  if (th < 0) {
    if (t.length === 1 && smallValue(t[0] ?? '') === 0) return 0;
    return below1000(t);
  }
  if (t.indexOf('thousand', th + 1) >= 0) return null;
  const left = t.slice(0, th);
  const right = t.slice(th + 1);
  const thousands = left.length === 0 ? 1 : below1000(left);
  if (thousands === null || thousands === 0) return null;
  if (right.length === 0) return thousands * 1000;
  const rest = below1000(right);
  if (rest === null) return null;
  return thousands * 1000 + rest;
}

/** "one point five k": value in dollars; at most three decimal digits. */
function decimalWords(t: string[]): number | null {
  const p = t.indexOf('point');
  const whole = integerWords(t.slice(0, p));
  const frac = t.slice(p + 1);
  const unit = frac[frac.length - 1];
  if (whole === null || unit === undefined || !THOUSAND_WORDS.has(unit)) return null;
  const digits = frac.slice(0, -1).map((w) => UNITS[w]);
  if (digits.length === 0 || digits.some((d) => d === undefined)) return null;
  const ds = digits.join('');
  if (ds.length > 3) return null; // finer than a whole dollar: not an amount we read
  return whole * 1000 + Number(ds.padEnd(3, '0'));
}

function prepare(seq: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of seq) {
    for (const part of raw.toLowerCase().split('-')) if (part !== '') out.push(part);
  }
  return out;
}

/** "a hundred" -> "one hundred", "a grand" -> "one grand". */
function expandArticle(t: string[]): string[] {
  const out = [...t];
  if (out[0] === 'a' && out[1] !== undefined && out[1] in SCALE) out[0] = 'one';
  return out;
}

/** Dollars for the whole token list after the "and a half" and scale handling, or null. */
function wordsDollars(input: string[]): number | null {
  let t = expandArticle(input.filter((w) => w !== 'and'));
  // "two and a half thousand" 2500, "three and a half k" 3500, "one and a half hundred" 150.
  // The filter above removed the "and"; the "a" before "half" is the marker.
  const half = t.indexOf('half');
  if (half >= 0) {
    const unit = t[t.length - 1];
    if (half !== t.length - 2 || t[half - 1] !== 'a' || unit === undefined || !(unit in SCALE))
      return null;
    const base = integerWords(t.slice(0, half - 1));
    if (base === null || base === 0) return null;
    return ((2 * base + 1) * (SCALE[unit] ?? 0)) / 2;
  }
  if (t.includes('point')) return decimalWords(t);
  let scale = 1;
  const last = t[t.length - 1];
  if (last === 'k' || last === 'grand') {
    scale = 1000;
    t = t.slice(0, -1);
    if (t.length === 0) return null;
    if (t.includes('thousand')) return null;
  }
  const v = integerWords(t);
  if (v === null) return null;
  return v * scale;
}

function toCents(dollars: number | null): number | null {
  if (dollars === null) return null;
  const c = Math.round(dollars * 100);
  return Number.isSafeInteger(c) && c <= MAX_CENTS ? c : null;
}

/** Words only (no digits). Returns integer cents or null. Hyphenated tokens are split. */
export function wordsValue(seq: string[]): number | null {
  const t = prepare(seq);
  if (t.length === 0) return null;
  if (t.some((w) => /\d/.test(w))) return null;
  return toCents(wordsDollars(t));
}

/** Decimal string times a whole-dollar multiplier, exact, in cents (half up). */
function numeralCents(text: string, multiplier: number): number | null {
  const [intPart = '', frac = ''] = text.replace(/,/g, '').split('.');
  if (intPart.length + frac.length > 15) return null;
  const n = BigInt(intPart + frac);
  const num = n * BigInt(multiplier) * 100n;
  const den = 10n ** BigInt(frac.length);
  // A sub-cent amount ("350.004") is not a bid amount: refuse it instead of rounding it away.
  if (num % den !== 0n) return null;
  const cents = num / den;
  return cents <= BigInt(MAX_CENTS) ? Number(cents) : null;
}

const NUMERAL_COMMA = /^\d{1,3}(,\d{3})+(\.\d+)?$/;
const NUMERAL_K = /^(\d+(?:\.\d+)?)k$/;

function isNumeralLike(t: string): boolean {
  return isNumeral(t) || NUMERAL_COMMA.test(t);
}

/**
 * A span of number tokens (words, numerals, "and") to integer cents or null.
 * Handles "350", "1,500", "1.5 k", "2k", "3 hundred" and pure word spans.
 */
export function spanValue(tokens: string[]): number | null {
  const t = prepare(tokens).filter((w) => w !== 'and');
  if (t.length === 0) return null;
  const only = t[0] ?? '';
  if (t.length === 1) {
    if (isNumeralLike(only)) return numeralCents(only, 1);
    const k = NUMERAL_K.exec(only);
    if (k) return numeralCents(k[1] ?? '', 1000);
  }
  if (t.length === 2 && isNumeralLike(only)) {
    const unit = t[1] ?? '';
    if (THOUSAND_WORDS.has(unit)) return numeralCents(only, 1000);
    if (unit === 'hundred' && /^\d+$/.test(only)) return numeralCents(only, 100);
  }
  if (t.some((w) => /\d/.test(w))) return null;
  return wordsValue(t);
}
