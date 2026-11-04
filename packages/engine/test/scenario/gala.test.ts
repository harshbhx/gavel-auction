import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Command } from '../../src/commands.js';
import { ManualClock } from '../../src/clock.js';
import type { LedgerEntry } from '../../src/events.js';
import { verifyChain } from '../../src/ledger/chain.js';
import { InMemoryLedgerStore } from '../../src/ledger/memory-store.js';
import { projectAuditor, projectBidder, projectPublic } from '../../src/projections.js';
import { AuctionRuntime } from '../../src/runtime.js';
import { galaCommands, galaIds, playScript, runScript } from '../../src/testing/replay-driver.js';
import type { GalaFixture } from '../../src/testing/replay-driver.js';
import type { Ulid } from '../../src/types.js';

const fixture = JSON.parse(
  readFileSync(new URL('../../fixtures/golden/demo-gala.json', import.meta.url), 'utf8'),
) as GalaFixture;
const ids = galaIds(fixture.gala);
const alias = (bidderId: string): string => `bidder-${bidderId.slice(-2)}`;

const rejects = (entries: readonly LedgerEntry[]): string[] =>
  entries.flatMap((e) => (e.type === 'BID_REJECTED' ? [e.payload.reason] : []));
const count = (entries: readonly LedgerEntry[], type: LedgerEntry['type']): number =>
  entries.filter((e) => e.type === type).length;

describe('demo gala fixture', () => {
  it('T-ENG-083 R-ENG-115: replays to the pinned head hash', () => {
    const { timed, state } = playScript(fixture);
    const entries = timed.map((t) => t.entry);
    const head = entries[entries.length - 1];
    console.log(`demo-gala head: seq=${head?.seq} hash=${head?.hash}`);
    expect(verifyChain(entries).ok).toBe(true);
    expect({ seq: head?.seq, hash: head?.hash }).toEqual(fixture.galaExpect.head);
    expect(state.closed).toBe(true);
  });

  it('T-ENG-083 R-ENG-115: three lots, one extension, one ceiling and one unconfirmed rejection, one fallback', () => {
    const entries = playScript(fixture).timed.map((t) => t.entry);
    expect(fixture.gala.lots).toHaveLength(3);
    expect(count(entries, 'LOT_HAMMERED')).toBe(3);
    expect(count(entries, 'END_EXTENDED')).toBe(1);
    expect(count(entries, 'FALLBACK_PROMOTED')).toBe(1);
    expect(count(entries, 'LOT_SETTLED')).toBe(3);
    expect(rejects(entries)).toEqual(fixture.galaExpect.rejects);
    expect(rejects(entries)).toContain('over_ceiling');
    expect(rejects(entries)).toContain('unconfirmed');
    expect(entries[entries.length - 1]?.type).toBe('AUCTION_CLOSED');
  });

  it('T-ENG-083 R-ENG-115: winners and the settlement table match the fixture', () => {
    const { state } = playScript(fixture);
    for (const [lotKey, want] of Object.entries(fixture.galaExpect.winners)) {
      const lot = state.lots[ids.lots.get(lotKey) as Ulid];
      expect(lot?.winnerId).toBe(ids.bidders.get(want.bidder));
      expect(lot?.priceCents).toBe(want.priceCents);
      expect(lot?.capturedCents).toBe(want.priceCents);
    }
    for (const [lotKey, want] of Object.entries(fixture.galaExpect.settlement)) {
      expect(state.lots[ids.lots.get(lotKey) as Ulid]?.settlement).toBe(want);
    }
  });
});

describe('scripted replay driver', () => {
  const collect = async (opts: Parameters<typeof runScript>[1]): Promise<number[]> => {
    const out: number[] = [];
    for await (const t of runScript(fixture, opts)) out.push(t.offsetMs);
    return out;
  };

  it('T-ENG-083 R-ENG-115: yields every entry with non-decreasing offsets from zero', async () => {
    const offsets = await collect({});
    expect(offsets).toHaveLength(playScript(fixture).timed.length);
    expect(offsets[0]).toBe(0);
    for (let i = 1; i < offsets.length; i += 1) {
      expect(offsets[i] ?? 0).toBeGreaterThanOrEqual(offsets[i - 1] ?? 0);
    }
  });

  it('T-ENG-083 R-ENG-115: speed scales the offsets and sleep waits the virtual time', async () => {
    const normal = await collect({});
    const fast = await collect({ speed: 2 });
    expect(fast[fast.length - 1]).toBe(Math.round((normal[normal.length - 1] ?? 0) / 2));
    const waits: number[] = [];
    await collect({
      speed: 4,
      sleep: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
    });
    expect(waits.every((w) => w > 0)).toBe(true);
    expect(waits.reduce((a, b) => a + b, 0)).toBe(Math.round((normal[normal.length - 1] ?? 0) / 4));
  });

  it('T-ENG-083 R-ENG-115: a bad speed or an unknown key is refused', async () => {
    await expect(collect({ speed: 0 })).rejects.toThrow(RangeError);
    await expect(collect({ speed: Number.NaN })).rejects.toThrow(RangeError);
    const broken = {
      ...fixture,
      gala: { ...fixture.gala, steps: [{ at: 1, do: 'open', lot: 'nope' }] },
    } as GalaFixture;
    expect(() => galaCommands(broken.gala)).toThrow(RangeError);
  });
});

/** A stand-in for the payment side: it captures a held amount or declines it, and logs the calls. */
class FakeSettlement {
  readonly calls: string[] = [];
  constructor(private readonly declines: ReadonlySet<string>) {}
  capture(lotId: string, bidderId: string, cents: number): { ok: boolean } {
    const ok = !this.declines.has(`${lotId}:${bidderId}`);
    this.calls.push(`${ok ? 'captured' : 'declined'} ${lotId} ${bidderId} ${cents}`);
    return { ok };
  }
}

describe('gala through the runtime', () => {
  it('T-ENG-083 R-ENG-115: the runtime reaches the same head and settlement as the driver', async () => {
    const store = new InMemoryLedgerStore();
    const seen: LedgerEntry[] = [];
    const runtime = new AuctionRuntime({
      store,
      clock: new ManualClock(1_000_000),
      onEntries: (_id, entries) => seen.push(...entries),
    });
    const chefId = ids.lots.get('chef') as Ulid;
    const benId = ids.bidders.get('ben') as Ulid;
    const pay = new FakeSettlement(new Set([`${chefId}:${benId}`]));
    const auctionId = ids.auction;

    for (const cmd of galaCommands(fixture.gala) as Command[]) {
      if (cmd.type === 'CompleteLot') {
        const lot = (await runtime.state(auctionId)).lots[cmd.lotId];
        expect(lot?.winnerId).toBe(cmd.bidderId);
        expect(lot?.priceCents).toBe(cmd.capturedCents);
        expect(pay.capture(cmd.lotId, cmd.bidderId, cmd.capturedCents).ok).toBe(true);
      }
      if (cmd.type === 'PromoteRunnerUp') {
        const lot = (await runtime.state(auctionId)).lots[cmd.lotId];
        const attempt = pay.capture(cmd.lotId, cmd.disqualifiedBidderId, lot?.priceCents ?? 0);
        expect(attempt.ok).toBe(false);
      }
      await runtime.dispatch(cmd);
    }

    const stored = await store.read(auctionId, 1);
    expect(stored).toEqual(seen);
    expect(verifyChain(stored).ok).toBe(true);
    const head = stored[stored.length - 1];
    expect({ seq: head?.seq, hash: head?.hash }).toEqual(fixture.galaExpect.head);
    expect(pay.calls.filter((c) => c.startsWith('declined'))).toHaveLength(1);

    const state = await runtime.state(auctionId);
    for (const [lotKey, want] of Object.entries(fixture.galaExpect.settlement)) {
      expect(state.lots[ids.lots.get(lotKey) as Ulid]?.settlement).toBe(want);
    }
    // The settlement entries the saga recorded, in ledger order, for the three lots.
    const saga = stored.flatMap((e) => (e.type === 'SETTLEMENT_STATE' ? [e.payload.to] : []));
    expect(saga).toHaveLength(11);
    expect(saga.filter((s) => s === 'FALLBACK_RUNNER_UP')).toHaveLength(1);

    const view = projectPublic(state, alias);
    expect(view.closed).toBe(true);
    expect(view.lots.map((l) => l.status)).toEqual(['DONE', 'DONE', 'DONE']);
    expect(view.lots.map((l) => l.priceCents)).toEqual([13000, 30000, 17000]);

    const ben = projectBidder(state, benId, alias);
    expect(ben.lots.every((l) => l.own.committedCents === 13000)).toBe(true);
    const cara = projectBidder(state, ids.bidders.get('cara') as Ulid, alias);
    expect(cara.lots.every((l) => l.own.committedCents === 17000)).toBe(true);

    expect(projectAuditor(stored)).toHaveLength(stored.length);
  });
});
