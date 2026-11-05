/** Number lexicon, ported from reference/python/parser.py. All keys are lower case. */

/** Prototype-free table, so lookups such as "constructor" never hit Object.prototype. */
function table<V>(entries: Record<string, V>): Readonly<Record<string, V>> {
  return Object.freeze(Object.assign(Object.create(null) as Record<string, V>, entries));
}

export const UNITS: Readonly<Record<string, number>> = table({
  zero: 0,
  oh: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
});

export const TEENS: Readonly<Record<string, number>> = table({
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
});

export const TENS: Readonly<Record<string, number>> = table({
  twenty: 20,
  thirty: 30,
  forty: 40,
  fourty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
});

export const SCALE: Readonly<Record<string, number>> = table({
  hundred: 100,
  thousand: 1000,
  grand: 1000,
  k: 1000,
});

/** Words that multiply the whole preceding value by 1000. */
export const THOUSAND_WORDS: ReadonlySet<string> = new Set(['k', 'grand', 'thousand']);

const NUMERAL = /^\d+(\.\d+)?$/;

export function isNumeral(token: string): boolean {
  return NUMERAL.test(token);
}

/** Value of a single unit, teen or tens word, or undefined. */
export function smallValue(word: string): number | undefined {
  return UNITS[word] ?? TEENS[word] ?? TENS[word];
}

/** A token that can be part of a number span (words, scale words, numerals, "point"). */
export function isNumberToken(token: string): boolean {
  return smallValue(token) !== undefined || token in SCALE || token === 'point' || isNumeral(token);
}

/** Words and symbols accepted as US dollars (R-VOX-039). "us dollars" works through "dollars". */
export const USD_WORDS: ReadonlySet<string> = new Set([
  '$',
  'dollar',
  'dollars',
  'buck',
  'bucks',
  'usd',
]);

/** Words after "N dollars" that mark the fractional part: "five dollars fifty cents". */
export const CENT_WORDS: ReadonlySet<string> = new Set(['cent', 'cents']);

/** Currencies that are recognised only to be refused: no conversion is ever done. */
export const NON_USD_WORDS: ReadonlySet<string> = new Set([
  'pound',
  'pounds',
  'quid',
  'gbp',
  'euro',
  'euros',
  'eur',
  'rupee',
  'rupees',
  'rs',
  'inr',
  'lakh',
  'lakhs',
  'lac',
  'lacs',
  'peso',
  'pesos',
  'yen',
  // Nationality prefixes and further currencies (R7-01): any non-USD currency is refused.
  'canadian',
  'australian',
  'aussie',
  'zealand',
  'hong',
  'kong',
  'singapore',
  'cad',
  'aud',
  'nzd',
  'hkd',
  'sgd',
  'jpy',
  'cny',
  'chf',
  'aed',
  'rmb',
  'renminbi',
  'yuan',
  'franc',
  'francs',
  'dirham',
  'dirhams',
  'baht',
  'ringgit',
  'rand',
  'krona',
  'kronor',
  'krone',
  'kroner',
  'dinar',
  'dinars',
  'shekel',
  'shekels',
  'real',
  'reais',
  'ruble',
  'rubles',
  'rouble',
  'roubles',
  'pence',
  'sterling',
  'c$',
  'a$',
  'ca$',
  'au$',
  'nz$',
  'hk$',
  'cdn',
  '£',
  '€',
  '₹',
  '¥',
]);

/** Words that introduce a paddle number, including the ASR forms "paddy" and "padel". */
export const PADDLE_WORDS: ReadonlySet<string> = new Set([
  'paddle',
  'bidder',
  'number',
  'seat',
  'card',
  'paddy',
  'padel',
]);

/** ASR confusions for a number word that directly follows a paddle word ("padel ate" is paddle 8). */
export const PADDLE_VALUE_ASR: Readonly<Record<string, string>> = table({
  to: 'two',
  too: 'two',
  tu: 'two',
  for: 'four',
  fore: 'four',
  free: 'three',
  tree: 'three',
  ate: 'eight',
  won: 'one',
});
