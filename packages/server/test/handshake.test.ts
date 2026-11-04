import { ManualClock, type JoinMsg } from '@gavel/shared';
import { describe, expect, it } from 'vitest';
import { Handshake } from '../src/transport/handshake';

const START = 1_789_000_000_000;
const JOIN = JSON.stringify({
  v: 1,
  t: 'join',
  token: 'placeholder-token',
  auctionId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
});

function setup() {
  const clock = new ManualClock(START);
  const sent: string[] = [];
  const closes: Array<{ code: number; reason: string }> = [];
  const joins: JoinMsg[] = [];
  const frames: string[] = [];
  let pings = 0;
  const hs = new Handshake({
    clock,
    send: (t) => sent.push(t),
    close: (code, reason) => closes.push({ code, reason }),
    ping: () => {
      pings += 1;
    },
    onJoin: (m) => {
      joins.push(m);
    },
    onFrame: (r) => {
      frames.push(r);
    },
  });
  return { clock, sent, closes, joins, frames, hs, pings: () => pings };
}

describe('T-RT-056 join handshake and heartbeat', () => {
  it('closes 4001 when no join arrives within 5 s', () => {
    const s = setup();
    s.clock.advanceTo(START + 4999);
    expect(s.closes).toEqual([]);
    s.clock.advanceTo(START + 5000);
    expect(s.closes).toEqual([{ code: 4001, reason: 'join_timeout' }]);
  });

  it('answers a frame before join with not_joined and keeps waiting', () => {
    const s = setup();
    s.hs.receive(JSON.stringify({ v: 1, t: 'bid', mid: 'x', amount: 1, source: 'manual' }));
    expect(JSON.parse(s.sent[0] ?? '{}')).toMatchObject({ t: 'error', code: 'not_joined' });
    expect(s.frames).toEqual([]);
    expect(s.closes).toEqual([]);
  });

  it('passes join, then later frames, and cancels the deadline', () => {
    const s = setup();
    s.hs.receive(JOIN);
    expect(s.joins).toHaveLength(1);
    expect(s.hs.hasJoined).toBe(true);
    s.hs.receive('later');
    expect(s.frames).toEqual(['later']);
    s.clock.advanceTo(START + 10_000);
    expect(s.closes).toEqual([]);
  });

  it('closes 1008 on a malformed join', () => {
    const s = setup();
    s.hs.receive(JSON.stringify({ v: 1, t: 'join' }));
    expect(s.closes[0]?.code).toBe(1008);
  });

  it('pings every 20 s, a pong resets, and 2 missed pongs drop', () => {
    const s = setup();
    s.hs.receive(JOIN);
    s.clock.advanceTo(START + 20_000);
    expect(s.pings()).toBe(1);
    s.hs.pong();
    s.clock.advanceTo(START + 40_000);
    expect(s.pings()).toBe(2);
    s.clock.advanceTo(START + 60_000);
    expect(s.pings()).toBe(3);
    expect(s.closes).toEqual([]);
    s.clock.advanceTo(START + 80_000);
    expect(s.closes).toEqual([{ code: 1001, reason: 'heartbeat_lost' }]);
    expect(s.pings()).toBe(3);
  });

  it('stop cancels timers', () => {
    const s = setup();
    s.hs.stop();
    s.clock.advanceTo(START + 100_000);
    expect(s.closes).toEqual([]);
    expect(s.pings()).toBe(0);
  });
});
