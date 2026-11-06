import { describe, expect, it } from 'vitest';
import { confidenceToBps, parseCommand } from '../src/commands.js';
import { A, AU, B, L1, bid, errCode, nextId, open, scene } from './decide-helpers.js';

const base = {
  commandId: nextId(),
  auctionId: AU,
  at: 100,
  type: 'PlaceBid',
  lotId: L1,
  bidderId: A,
  amountCents: 1000,
  source: 'voice',
};

describe('bid audit record carries the parsed amount', () => {
  it('T-ENG-083 R-ENG-083 rounds float confidence to integer basis points once', () => {
    for (const c of [0.07, 0.14, 0.17, 0.28, 0.34, 0.56]) {
      expect(Number.isInteger(confidenceToBps(c))).toBe(true);
    }
    expect(confidenceToBps(0.07)).toBe(700);
  });

  it('T-ENG-083 R-ENG-083 parseCommand keeps parsedCents and rejects a negative one', () => {
    const ok = parseCommand({
      ...base,
      audit: { parsedCents: 1200, audioStartMs: 5, audioEndMs: 9 },
    });
    expect(ok.type === 'PlaceBid' && ok.audit.parsedCents).toBe(1200);
    expect(() => parseCommand({ ...base, audit: { parsedCents: -1 } })).toThrow();
    expect(() => parseCommand({ ...base, audit: { parsedCents: 1.5 } })).toThrow();
  });

  it('T-ENG-083 R-ENG-083 the engine records parsedCents next to a different bid amount', () => {
    const s = open(scene(), L1);
    const r = bid(s, 200, A, 2000, undefined, { audit: { parsedCents: 2500 } });
    const ev = r.entries.find((e) => e.type === 'BID_RECORDED');
    expect(ev?.type === 'BID_RECORDED' && ev.payload.audit.parsedCents).toBe(2500);
    expect(ev?.type === 'BID_RECORDED' && ev.payload.amountCents).toBe(2000);
  });

  it('T-ENG-083 R-ENG-083 rejects a negative parsedCents in a typed command', () => {
    const s = open(scene(), L1);
    expect(errCode(() => bid(s, 200, B, 2000, undefined, { audit: { parsedCents: -5 } }))).toBe(
      'bad_command',
    );
  });
});
