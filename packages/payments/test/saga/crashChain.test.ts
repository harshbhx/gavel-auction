import { describe, expect, it } from 'vitest';
import { THREE_BIDDERS, assertEquivalent, drive, enumerate } from '../helpers/crashHarness.js';

/**
 * Double crash chain (R-PAY-060, T-PAY-047): crash at boundary i, resume, crash at
 * a later boundary j, resume. Boundaries are counted across runs, so j > i names a
 * point of the resumed run. Every pair for the three-bidder plan.
 */

const labels = await enumerate(THREE_BIDDERS);
const base = await drive(THREE_BIDDERS);

describe('T-PAY-047 double crash chain', () => {
  it('has enough boundaries to be worth pairing', () => {
    expect(labels.length).toBeGreaterThan(10);
  });

  it.each(labels.map((label, i): [number, string] => [i, label]))(
    'crash at %i %s, then at every later boundary',
    async (i) => {
      // j runs past the dry-run count: a resume passes some boundaries again.
      for (let j = i + 1; j < labels.length + 4; j += 1) {
        await assertEquivalent(THREE_BIDDERS, [i, j], {}, base);
      }
    },
  );

  it('the same pairs with forget_idempotency before each resume', async () => {
    for (let i = 0; i < labels.length; i += 1) {
      for (let j = i + 1; j < labels.length + 4; j += 3) {
        await assertEquivalent(THREE_BIDDERS, [i, j], { forgetIdempotency: true }, base);
      }
    }
  });
});
