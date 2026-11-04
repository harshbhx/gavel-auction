import { describe, expect, it } from 'vitest';
import { canonicalize } from '../src/canonical.js';
import { confidenceToBps, parseCommand } from '../src/commands.js';
import type { Command } from '../src/commands.js';
import { decide } from '../src/decide/index.js';
import { InMemoryLedgerStore } from '../src/ledger/memory-store.js';
import type { LedgerStore } from '../src/ledger/store.js';
import { AuctionRuntime } from '../src/runtime.js';
import { A, AU, B, L1, bid, errCode, id, mk, open, run, scene } from './decide-helpers.js';

describe('red-team round 2 hardening (engine)', () => {
  it('ENG-R2-03: a changed body under the same id conflicts for money and revoke commands', () => {
    let s = open(scene(), L1);
    s = bid(s, 200, A, 1000).state;
    s = run(s, mk(300, { type: 'Hammer', lotId: L1, actor: 'host', early: true })).state;
    const price = s.lots[L1]?.priceCents ?? 0;
    const done = mk(
      400,
      { type: 'CompleteLot', lotId: L1, capturedCents: price, ref: 'pi_1' },
      id('R3C1'),
    );
    s = run(s, done).state;
    const other = mk(
      400,
      { type: 'CompleteLot', lotId: L1, capturedCents: price, ref: 'pi_2' },
      id('R3C1'),
    );
    expect(errCode(() => decide(s, other))).toBe('command_conflict');
    expect(decide(s, done).outcome.kind).toBe('duplicate');

    const revoke = mk(500, { type: 'RevokeCeiling', bidderId: B, reason: 'declined' }, id('R3R1'));
    s = run(s, revoke).state;
    const revokeOther = mk(
      500,
      { type: 'RevokeCeiling', bidderId: A, reason: 'declined' },
      id('R3R1'),
    );
    expect(errCode(() => decide(s, revokeOther))).toBe('command_conflict');
    expect(decide(s, revoke).outcome.kind).toBe('duplicate');
  });

  it('ENG-R2-04: raising a held ceiling needs a different holdRef', () => {
    let s = scene();
    const reg = (ceilingCents: number, holdRef: string) =>
      mk(10, { type: 'RegisterBidder', bidderId: id('BZ'), ceilingCents, holdRef });
    s = run(s, reg(10000, 'H1')).state;
    expect(errCode(() => decide(s, reg(100000, 'H1')))).toBe('bad_command');
    expect(decide(s, reg(100000, 'H2')).events.map((e) => e.type)).toEqual(['CEILING_RAISED']);
  });

  const bidBody = (audit: Record<string, unknown>) => ({
    type: 'PlaceBid',
    commandId: id('R5B1'),
    auctionId: AU,
    at: 5,
    lotId: L1,
    bidderId: A,
    amountCents: 1000,
    source: 'voice',
    audit,
  });

  it('ENG-R2-05: the untrusted parser rejects audit.confirmed', () => {
    expect(errCode(() => parseCommand(bidBody({ confidenceBps: 100, confirmed: true })))).toBe(
      'bad_command',
    );
  });

  it('INTEGRATION-R2-05: a 0..1 confidence is converted to basis points at the boundary', () => {
    const cmd = parseCommand(bidBody({ confidence: 0.92 }));
    expect(cmd.type === 'PlaceBid' && cmd.audit.confidenceBps).toBe(9200);
    expect(confidenceToBps(1)).toBe(10000);
    expect(confidenceToBps(0)).toBe(0);
    expect(errCode(() => parseCommand(bidBody({ confidence: 1.5 })))).toBe('bad_command');
    expect(errCode(() => parseCommand(bidBody({ confidence: 0.5, confidenceBps: 5000 })))).toBe(
      'bad_command',
    );
  });

  it('ENG-R2-08: a throwing onEntries observer does not fail a stored command', async () => {
    const errors: unknown[] = [];
    const rt = new AuctionRuntime({
      store: new InMemoryLedgerStore(),
      onEntries: () => {
        throw new Error('socket closed');
      },
      onObserverError: (e) => errors.push(e),
    });
    const r = await rt.dispatch(mk(0, { type: 'CreateAuction', title: 'Gala', config: {} }));
    expect(r.outcome.kind).toBe('accepted');
    expect(r.entries).toHaveLength(1);
    expect(errors).toHaveLength(1);
  });

  it('ENG-R2-09: a duplicate returns the entries of the first application', async () => {
    const rt = new AuctionRuntime({ store: new InMemoryLedgerStore() });
    const create = mk(0, { type: 'CreateAuction', title: 'Gala', config: {} });
    const first = await rt.dispatch(create);
    await rt.dispatch(mk(1, { type: 'RegisterBidder', bidderId: A, ceilingCents: 5000 }));
    const again = await rt.dispatch(create);
    expect(again.outcome.kind).toBe('duplicate');
    expect(again.entries).toEqual(first.entries);
  });

  it('ENG-R2-07: an auction id with no ledger is not cached', async () => {
    const inner = new InMemoryLedgerStore();
    let reads = 0;
    const store: LedgerStore = {
      append: (a, e, h) => inner.append(a, e, h),
      read: (a, f) => {
        reads += 1;
        return inner.read(a, f);
      },
      head: (a) => inner.head(a),
    };
    const rt = new AuctionRuntime({ store });
    await rt.state(AU);
    await rt.state(AU);
    expect(reads).toBe(2);
  });

  it('ENG-R2-12: decide bounds the promote reason and the bid audit shape', () => {
    const s = open(scene(), L1);
    const long: Command = mk(300, {
      type: 'PromoteRunnerUp',
      lotId: L1,
      disqualifiedBidderId: A,
      reason: 'x'.repeat(5000),
    });
    expect(errCode(() => decide(s, long))).toBe('limit_exceeded');
    const extra = mk(300, {
      type: 'PlaceBid',
      lotId: L1,
      bidderId: A,
      amountCents: 1000,
      source: 'manual',
      audit: { blob: 'x'.repeat(100000) } as never,
    });
    expect(errCode(() => decide(s, extra))).toBe('bad_command');
    const nested = mk(300, {
      type: 'PlaceBid',
      lotId: L1,
      bidderId: A,
      amountCents: 1000,
      source: 'manual',
      audit: { utteranceId: { deep: 1 } } as never,
    });
    expect(errCode(() => decide(s, nested))).toBe('bad_command');
  });

  it('ENG-R2-14: canonical keys sort by code point like Python', () => {
    expect(canonicalize({ '\u{10000}': 2, '￿': 1 })).toBe('{"\\uffff":1,"\\ud800\\udc00":2}');
  });
});
