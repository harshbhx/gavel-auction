import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { EngineError } from '../../src/errors.js';
import type { SoftClose } from '../../src/types.js';
import { A, B, C, L1, bid, lotConfig, open, scene } from '../decide-helpers.js';

// Seeded like the other property files; set GAVEL_PROPERTY_SEED / GAVEL_PROPERTY_RUNS to replay.
const SEED = Number(process.env['GAVEL_PROPERTY_SEED'] ?? 20261104);
const NUM_RUNS = Number(process.env['GAVEL_PROPERTY_RUNS'] ?? 300);
const params = { seed: SEED, numRuns: NUM_RUNS };

const bidders = [A, B, C] as const;
const OPENED_AT = 100;

const config = fc
  .record({
    durationMs: fc.integer({ min: 1000, max: 20000 }),
    windowMs: fc.integer({ min: 0, max: 10000 }),
    extensionMs: fc.integer({ min: 0, max: 10000 }),
    maxExtensions: fc.integer({ min: 0, max: 5 }),
    hardExtra: fc.option(fc.integer({ min: 0, max: 20000 }), { nil: undefined }),
  })
  .map(({ durationMs, windowMs, extensionMs, maxExtensions, hardExtra }) => {
    const softClose: SoftClose = {
      windowMs,
      extensionMs,
      maxExtensions,
      ...(hardExtra === undefined ? {} : { hardCloseMs: durationMs + hardExtra }),
    };
    return { durationMs, softClose };
  });

const stream = fc.array(fc.integer({ min: 0, max: 5000 }), { minLength: 1, maxLength: 40 });

interface Observed {
  at: number;
  accepted: boolean;
  endsBefore: number;
  endsAfter: number;
  extBefore: number;
  extAfter: number;
}

/** Plays a stream of strictly rising bids from rotating bidders at increasing times. */
function play(
  c: { durationMs: number; softClose: SoftClose },
  gaps: readonly number[],
): Observed[] {
  const lot = lotConfig(L1, { durationMs: c.durationMs, softClose: c.softClose });
  let s = open(scene({ lots: [lot] }), L1, OPENED_AT);
  const seen: Observed[] = [];
  let at = OPENED_AT;
  gaps.forEach((gap, i) => {
    at += gap;
    const before = s.lots[L1];
    try {
      const r = bid(s, at, bidders[i % 3] ?? A, 1000 + 100 * i);
      s = r.state;
      const after = s.lots[L1];
      seen.push({
        at,
        accepted: r.result.outcome.kind === 'accepted',
        endsBefore: before?.endsAt ?? 0,
        endsAfter: after?.endsAt ?? 0,
        extBefore: before?.extensions ?? 0,
        extAfter: after?.extensions ?? 0,
      });
    } catch (e) {
      // Once the lot is DONE the engine refuses further bids in its own terms.
      if (!(e instanceof EngineError)) throw e;
    }
  });
  return seen;
}

describe('soft close properties', () => {
  it('T-ENG-028 R-ENG-036 endsAt never decreases and never passes the hard close; extensions stay within the cap', () => {
    fc.assert(
      fc.property(config, stream, (c, gaps) => {
        const hardEnd =
          c.softClose.hardCloseMs === undefined ? Infinity : OPENED_AT + c.softClose.hardCloseMs;
        let last = OPENED_AT + c.durationMs;
        for (const o of play(c, gaps)) {
          expect(o.endsAfter).toBeGreaterThanOrEqual(o.endsBefore);
          expect(o.endsAfter).toBeGreaterThanOrEqual(last);
          expect(o.endsAfter).toBeLessThanOrEqual(hardEnd);
          expect(o.extAfter).toBeLessThanOrEqual(c.softClose.maxExtensions);
          expect(o.extAfter - o.extBefore).toBeLessThanOrEqual(1);
          last = o.endsAfter;
        }
      }),
      params,
    );
  });

  it('T-ENG-027 R-ENG-034 an accepted bid inside the window moves endsAt to max(endsAt, at + extensionMs) and counts one extension', () => {
    fc.assert(
      fc.property(config, stream, (c, gaps) => {
        const sc = c.softClose;
        const enabled = sc.windowMs > 0 && sc.extensionMs > 0;
        for (const o of play(c, gaps)) {
          if (!o.accepted) {
            // A rejected bid never extends the lot (R-ENG-039).
            expect(o.endsAfter).toBe(o.endsBefore);
            expect(o.extAfter).toBe(o.extBefore);
            continue;
          }
          const inWindow = o.at >= o.endsBefore - sc.windowMs;
          if (!enabled || !inWindow || o.extBefore >= sc.maxExtensions) {
            expect(o.endsAfter).toBe(o.endsBefore);
            expect(o.extAfter).toBe(o.extBefore);
            continue;
          }
          let want = Math.max(o.endsBefore, o.at + sc.extensionMs);
          if (sc.hardCloseMs !== undefined) {
            want = Math.min(want, Math.max(o.endsBefore, OPENED_AT + sc.hardCloseMs));
          }
          expect(o.endsAfter).toBe(want);
          expect(o.extAfter).toBe(o.extBefore + (want > o.endsBefore ? 1 : 0));
        }
      }),
      params,
    );
  });
});
