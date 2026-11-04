import { describe, expect, it } from 'vitest';
import { spanValue, wordsValue } from '../../src/parser/numbers.js';

const words = (s: string): string[] => (s === '' ? [] : s.split(' '));

/** [input, expected cents]. */
const TABLE: Array<[string, number]> = [
  ['zero', 0],
  ['oh', 0],
  ['one', 100],
  ['five', 500],
  ['ten', 1000],
  ['twelve', 1200],
  ['nineteen', 1900],
  ['twenty', 2000],
  ['twenty one', 2100],
  ['fifty five', 5500],
  ['seventy five', 7500],
  ['ninety nine', 9900],
  ['forty', 4000],
  ['fourty', 4000],
  ['hundred', 10000],
  ['a hundred', 10000],
  ['one hundred', 10000],
  ['two hundred', 20000],
  ['four hundred and fifty', 45000],
  ['a hundred and twenty', 12000],
  ['one hundred and five', 10500],
  ['seven hundred and twenty five', 72500],
  ['nine hundred ninety nine', 99900],
  ['three fifty', 35000],
  ['three-fifty', 35000],
  ['two fifty five', 25500],
  ['two-fifty-five', 25500],
  ['twelve fifty', 125000],
  ['one twenty', 12000],
  ['two fifteen', 21500],
  ['nine twenty five', 92500],
  ['three seventy five', 37500],
  ['one fifty five', 15500],
  ['two oh five', 20500],
  ['one oh five', 10500],
  ['twelve oh five', 120500],
  ['fifteen hundred', 150000],
  ['nineteen hundred', 190000],
  ['twenty five hundred', 250000],
  ['a thousand', 100000],
  ['one thousand', 100000],
  ['thousand', 100000],
  ['a grand', 100000],
  ['two grand', 200000],
  ['two k', 200000],
  ['ten k', 1000000],
  ['two thousand', 200000],
  ['two thousand five hundred', 250000],
  ['one thousand two hundred and fifty', 125000],
  ['two thousand three fifty', 235000],
  ['two thousand five', 200500],
  ['two and a half thousand', 250000],
  ['three and a half k', 350000],
  ['one and a half hundred', 15000],
  ['one point five k', 150000],
  ['three point five k', 350000],
  ['two point two five k', 225000],
  ['fifty thousand', 5000000],
  ['two hundred fifty thousand', 25000000],
  ['a hundred thousand', 10000000],
  ['Two Hundred', 20000],
];

const REJECTED = [
  '',
  'banana',
  'constructor',
  'two twenty fifty',
  'five hundred five hundred',
  'hundred hundred',
  'twenty twenty',
  'two point five',
  'three and a half',
  'a half thousand',
  'two thousand k',
  'point five k',
  '350',
];

describe('T-VOX-037 number words (R-VOX-037)', () => {
  it('has at least 60 rows', () => {
    expect(TABLE.length).toBeGreaterThanOrEqual(60);
  });

  for (const [input, cents] of TABLE) {
    it(`"${input}" is ${cents} cents`, () => {
      expect(wordsValue(words(input))).toBe(cents);
    });
  }

  for (const input of REJECTED) {
    it(`rejects "${input}"`, () => {
      expect(wordsValue(words(input))).toBeNull();
    });
  }

  it('accepts a hyphenated token as one element', () => {
    expect(wordsValue(['two-fifty-five'])).toBe(25500);
    expect(wordsValue(['twenty-five', 'hundred'])).toBe(250000);
  });
});

describe('spanValue', () => {
  const rows: Array<[string[], number | null]> = [
    [['350'], 35000],
    [['1,500'], 150000],
    [['1500'], 150000],
    [['1.5', 'k'], 150000],
    [['2k'], 200000],
    [['10k'], 1000000],
    [['2.5k'], 250000],
    [['2.5', 'k'], 250000],
    [['350.00'], 35000],
    [['350.50'], 35050],
    [['3', 'hundred'], 30000],
    [['two', 'hundred', 'and', 'fifty'], 25000],
    [['a', 'grand'], 100000],
    [['two', 'and', 'a', 'half', 'thousand'], 250000],
    [['5', 'apples'], null],
    [['3', 'fifty'], null],
    [[], null],
  ];
  for (const [tokens, cents] of rows) {
    it(`${JSON.stringify(tokens)} -> ${String(cents)}`, () => {
      expect(spanValue(tokens)).toBe(cents);
    });
  }
});
