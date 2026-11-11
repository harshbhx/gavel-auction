import { describe, expect, it } from 'vitest';
import {
  REPLAY_BUNDLE_VERSION,
  REPLAY_EXPORT_VERSION,
  hashPublicEntry,
  type ReplayBundle,
  type ReplayEvent,
} from '@gavel/shared';
import {
  SIMULATED_NOTE,
  buildRecording,
  hostingProblems,
  ledgerProblems,
  summarizeRecording,
  type Frame,
} from '../src/replay/judge-recording';

// Pure parts of the judge-room replay recording (inventory row 41). The recording itself happens
// only in the dispatch workflow.

const frame = (atMs: number, t: string, extra: Record<string, unknown> = {}): Frame => ({
  atMs,
  msg: { t, ...extra },
});
const accept = (m: unknown): Frame['msg'] | null =>
  typeof m === 'object' && m !== null && (m as { t?: unknown }).t !== 'junk'
    ? (m as Frame['msg'])
    : null;
const input = (frames: Frame[]) => ({
  title: 'Judge room auction (simulated holds)',
  recordedAt: '2026-11-09T00:00:00.000Z',
  frames,
  decode: accept,
});

describe('buildRecording', () => {
  it('starts offsets at the first state frame and never goes backwards', () => {
    const { bundle } = buildRecording(
      input([
        frame(5000, 'price'),
        frame(1000, 'ping'),
        frame(2000, 'state'),
        frame(2500, 'price', { leaderId: 'b1' }),
        frame(2400, 'price'),
      ]),
    );
    expect(bundle.events.map((e) => e.msg.t)).toEqual(['state', 'price', 'price', 'price']);
    expect(bundle.events.map((e) => e.t)).toEqual([0, 400, 500, 3000]);
  });
  it('drops frames the decoder refuses and counts them', () => {
    const r = buildRecording(input([frame(0, 'state'), frame(10, 'junk'), frame(20, 'price')]));
    expect(r.dropped).toBe(1);
    expect(r.bundle.events).toHaveLength(2);
  });
  it('throws when there is no state frame', () => {
    expect(() => buildRecording(input([frame(0, 'price')]))).toThrow(/state/);
  });
  it('labels the bundle as simulated in the title, a flag and a note', () => {
    const { bundle } = buildRecording(input([frame(0, 'state')]));
    expect(bundle.version).toBe(1);
    expect(bundle.title).toContain('simulated holds');
    expect(bundle.simulatedHolds).toBe(true);
    expect(bundle.note).toBe(SIMULATED_NOTE);
    expect(bundle.note).toContain('no PayPal call');
  });
});

describe('summarizeRecording and hostingProblems', () => {
  const bundle = buildRecording(
    input([
      frame(0, 'state'),
      frame(100, 'price', { leaderId: null }),
      frame(200, 'price', { leaderId: 'a' }),
      frame(300, 'price', { leaderId: 'b' }),
      frame(400, 'hammer'),
      frame(500, 'settlement_update'),
    ]),
  ).bundle;
  it('counts frames by type, lead changes and the hammer', () => {
    const s = summarizeRecording(bundle);
    expect(s.events).toBe(6);
    expect(s.durationMs).toBe(500);
    expect(s.leadChanges).toBe(2);
    expect(s.hammered).toBe(true);
    expect(s.settlementUpdates).toBe(1);
    expect(hostingProblems(s)).toEqual([]);
  });
  it('says why a thin recording is not worth hosting', () => {
    const thin = summarizeRecording(buildRecording(input([frame(0, 'state')])).bundle);
    expect(hostingProblems(thin)).toEqual([
      'only 0 bid(s) took the lead, need at least 2',
      'no hammer frame was recorded',
    ]);
  });
});

// INTEGRATION-RT-22: the frames are tied to the hash-chained ledger the bundle carries.
describe('ledgerProblems', () => {
  /** A sealed public chain: one created entry, then one LOT_HAMMERED entry per price. */
  function ledgerWith(prices: number[]): ReplayBundle {
    const events: ReplayEvent[] = [];
    let prev = '0'.repeat(64);
    const add = (type: string, payload: Record<string, unknown>): void => {
      const body = {
        v: 4 as const,
        auctionId: 'A1',
        seq: events.length + 1,
        at: 1000,
        type,
        cmd: null,
        payload,
        redacted: [] as string[],
        fullHash: null,
        prev,
      };
      const hash = hashPublicEntry(body);
      events.push({ ...body, hash });
      prev = hash;
    };
    add('AUCTION_CREATED', { note: 'x' });
    for (const priceCents of prices) add('LOT_HAMMERED', { lotId: 'L1', priceCents });
    return {
      version: REPLAY_BUNDLE_VERSION,
      exportVersion: REPLAY_EXPORT_VERSION,
      auctionId: 'A1',
      generatedAt: 5000,
      count: events.length,
      headHash: prev,
      closed: false,
      events,
    };
  }
  const recorded = (price: number, ledger?: unknown) =>
    buildRecording({
      ...input([frame(0, 'state'), frame(100, 'hammer', { price })]),
      ...(ledger === undefined ? {} : { ledger }),
    }).bundle;

  it('passes a recording whose hammer frame shows the sealed price', () => {
    const bundle = recorded(35_000, ledgerWith([35_000]));
    expect(bundle.ledger?.count).toBe(2);
    expect(ledgerProblems(bundle)).toEqual([]);
  });
  it('refuses a recording without a ledger, or with one that is not a bundle', () => {
    expect(ledgerProblems(recorded(35_000))).toEqual(['the recording carries no ledger export']);
    const junk = recorded(35_000, { version: 9 });
    expect(junk.ledger).toBeUndefined();
    expect(ledgerProblems(junk)).toEqual(['the recording carries no ledger export']);
  });
  it('refuses a ledger with an edited entry', () => {
    const ledger = ledgerWith([35_000]);
    const entry = ledger.events[1];
    if (entry === undefined) throw new Error('no entry');
    entry.payload = { ...entry.payload, priceCents: 1 };
    expect(ledgerProblems(recorded(1, ledger))).toEqual([
      'the ledger chain is broken at index 1 (bad_hash)',
    ]);
  });
  it('refuses a ledger with a dropped last entry', () => {
    const ledger = ledgerWith([35_000]);
    const cut = { ...ledger, events: ledger.events.slice(0, 1), count: 1 };
    expect(ledgerProblems(recorded(35_000, cut))).toEqual([
      'the ledger chain is broken at index 1 (truncated)',
    ]);
  });
  it('refuses frames edited to another hammer price, or a hammer the ledger does not have', () => {
    expect(ledgerProblems(recorded(10_000, ledgerWith([35_000])))).toEqual([
      'hammer 1 in the frames does not match the ledger',
    ]);
    expect(ledgerProblems(recorded(35_000, ledgerWith([])))).toEqual([
      'hammer 1 in the frames does not match the ledger',
    ]);
  });
});
