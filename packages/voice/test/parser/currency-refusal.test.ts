import { describe, expect, it } from 'vitest';
import { parseBid } from '../../src/parser/parse.js';

const ctx = { speakerBidderId: '7' };

describe('R7-01 any non-USD currency is refused, never read as dollars', () => {
  for (const text of [
    'paddle twelve three hundred canadian dollars',
    'paddle twelve three hundred australian dollars',
    'paddle twelve three hundred aussie dollars',
    'paddle twelve three hundred hong kong dollars',
    'paddle twelve three hundred singapore dollars',
    'paddle twelve three hundred new zealand dollars',
    'paddle twelve three hundred swiss francs',
    'paddle twelve three hundred dirhams',
    'paddle twelve three hundred yuan',
    'paddle twelve three hundred cad',
    'paddle twelve three hundred aud',
    'paddle twelve three hundred chf',
    'paddle twelve three hundred aed',
    'paddle twelve three hundred pence',
    'paddle twelve three hundred baht',
    'paddle twelve three hundred ringgit',
    'paddle twelve three hundred rand',
    'paddle twelve three hundred swedish krona',
    'paddle twelve three hundred dinar',
    'paddle twelve three hundred shekels',
    'paddle twelve three hundred rubles',
    'paddle twelve three hundred pounds sterling',
  ]) {
    it(`"${text}" is confirm unsupported_currency`, () => {
      const r = parseBid(text, ctx);
      expect(r.status).toBe('confirm');
      expect(r.reason).toBe('unsupported_currency');
      expect(r.amountCents).toBeNull();
    });
  }

  it('plain dollars still parse as a bid', () => {
    const r = parseBid('paddle twelve three hundred dollars', ctx);
    expect(r.status).toBe('bid');
    expect(r.amountCents).toBe(30000);
  });
});
