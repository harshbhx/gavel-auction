import type { ConnId } from '@gavel/shared';
import { describe, expect, it } from 'vitest';
import { MemoryTransport } from '../src/room/memory-transport';
import { MAX_REPLAY_EVENTS, SUPERSEDED_REASON, planResync } from '../src/room/resync';
import { setup } from './room-harness';

describe('planResync (R-RT-057)', () => {
  it('replays a gap of up to 200 events and sends state only beyond that', () => {
    expect(planResync(10, 14)).toEqual({ kind: 'replay', from: 11, to: 14 });
    expect(planResync(0, MAX_REPLAY_EVENTS)).toEqual({ kind: 'replay', from: 1, to: 200 });
    expect(planResync(0, MAX_REPLAY_EVENTS + 1)).toEqual({ kind: 'state-only' });
    expect(planResync(14, 14)).toEqual({ kind: 'state-only' });
    expect(planResync(99, 14)).toEqual({ kind: 'state-only' });
    expect(planResync(undefined, 14)).toEqual({ kind: 'state-only' });
  });
});

describe('join with lastSeq (T-RT-048, T-RT-049)', () => {
  it('replays the missed audit frames in order, then state', async () => {
    const t = await setup();
    const before = t.room.lastSeq;
    const c1 = await t.connect('bidder', t.b1);
    const c2 = await t.connect('bidder', t.b2);
    await t.room.submitBid(c1.conn, t.bid(10000));
    await t.room.submitBid(c2.conn, t.bid(10500));
    const boss = await t.connect('auctioneer');
    const late = new MemoryTransport();
    await t.room.attach(
      { ...boss.conn, id: t.ids.mint<'ConnId'>() as ConnId, transport: late },
      before,
    );
    const types = late.messages().map((m) => m.t);
    expect(types.at(-1)).toBe('state');
    const audits = late.messages('audit_event').map((m) => m.seq as number);
    expect(audits).toEqual([before + 1, before + 2]);
  });

  it('sends state only when the client is current', async () => {
    const t = await setup();
    const late = new MemoryTransport();
    const c1 = await t.connect('bidder', t.b1);
    await t.room.attach(
      { ...c1.conn, id: t.ids.mint<'ConnId'>() as ConnId, transport: late },
      t.room.lastSeq,
    );
    expect(late.messages().map((m) => m.t)).toEqual(['state']);
  });

  it('closes the oldest of four connections on one token as superseded', async () => {
    const t = await setup();
    const conns = [];
    for (let i = 0; i < 4; i += 1) conns.push(await t.connect('bidder', t.b1));
    expect(conns[0]?.transport.closed?.reason).toBe(SUPERSEDED_REASON);
    for (const c of conns.slice(1)) expect(c.transport.closed).toBeUndefined();
    expect(t.room.connectionCount).toBe(3);
  });
});
