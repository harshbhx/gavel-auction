import { describe, expect, it } from 'vitest';
import {
  MAX_PROMPT_CHARS,
  formatUsd,
  promptText,
  type PromptData,
} from '../../src/decide/wording.js';

const TEMPLATES: Array<[PromptData, string]> = [
  [{ kind: 'single', amountCents: 35000, paddle: '12' }, 'Did you mean $350 for paddle 12?'],
  [{ kind: 'device_mic', amountCents: 35000 }, 'Bid $350?'],
  [
    { kind: 'two_amounts', amountACents: 35000, amountBCents: 40000, paddle: '7' },
    '$350 or $400 for paddle 7?',
  ],
  [
    { kind: 'two_bidders', paddleA: '7', amountACents: 35000, paddleB: '12', amountBCents: 40000 },
    'Paddle 7 $350 or paddle 12 $400?',
  ],
  [{ kind: 'unknown_bidder', amountCents: 150000 }, 'Which paddle bid $1,500?'],
  [
    { kind: 'unregistered', paddle: '99', amountCents: 35000 },
    'Paddle 99 is not registered. Who bid $350?',
  ],
  [
    { kind: 'homophone', text: 'to fifty', amountACents: 5000, amountBCents: 25000 },
    'Heard "to fifty". $50 or $250?',
  ],
  [{ kind: 'correction', paddle: '7', amountCents: 40000 }, 'Change paddle 7 to $400?'],
  [
    { kind: 'correction', paddle: '7', amountCents: 40000, fromCents: 35000 },
    'Change paddle 7 from $350 to $400?',
  ],
  [{ kind: 'currency', amountCents: 35000 }, 'Heard $350 in another currency. Bid $350 USD?'],
  [{ kind: 'large_jump', times: 5, amountCents: 500000 }, 'That is 5 times the price. Bid $5,000?'],
  [{ kind: 'fractional', amountCents: 250050, exact: '$2,500.50' }, 'Bid $2,500.50 ($2,500.50)?'],
  [
    { kind: 'currency_unparsed' },
    'That amount was not understood in USD. Please say it in dollars.',
  ],
  [{ kind: 'low_confidence' }, 'Did not catch that.'],
];

describe('T-VOX-074 confirm wording (R-VOX-066)', () => {
  it.each(TEMPLATES)('%j', (data, expected) => {
    expect(promptText(data)).toBe(expected);
  });

  it('formats amounts', () => {
    expect(formatUsd(35000)).toBe('$350');
    expect(formatUsd(150000)).toBe('$1,500');
    expect(formatUsd(250050)).toBe('$2,500.50');
    expect(formatUsd(5)).toBe('$0.05');
    expect(formatUsd(123456789)).toBe('$1,234,567.89');
  });

  it('stays within 90 characters for 1000 random amounts and paddles', () => {
    let seed = 12345;
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed;
    };
    for (let i = 0; i < 1000; i++) {
      const a = next() % 1000000000;
      const b = next() % 1000000000;
      const p = String(next() % 10000);
      const q = String(next() % 10000);
      const items: PromptData[] = [
        { kind: 'single', amountCents: a, paddle: p },
        { kind: 'device_mic', amountCents: a },
        { kind: 'two_amounts', amountACents: a, amountBCents: b, paddle: p },
        { kind: 'two_bidders', paddleA: p, amountACents: a, paddleB: q, amountBCents: b },
        { kind: 'unknown_bidder', amountCents: a },
        { kind: 'unregistered', paddle: p, amountCents: a },
        { kind: 'homophone', text: 'x'.repeat(next() % 200), amountACents: a, amountBCents: b },
        { kind: 'correction', paddle: p, amountCents: a, fromCents: b },
        { kind: 'currency', amountCents: a },
        { kind: 'currency_unparsed' },
        { kind: 'large_jump', times: (next() % 1000) / 10, amountCents: a },
        { kind: 'fractional', amountCents: a, exact: formatUsd(b) },
      ];
      for (const d of items) {
        expect(promptText(d).length).toBeLessThanOrEqual(MAX_PROMPT_CHARS);
      }
    }
  });

  it('never implies a charge', () => {
    for (const [d] of TEMPLATES) {
      expect(promptText(d).toLowerCase()).not.toMatch(/charg|pay|paid|captur/);
    }
  });
});
