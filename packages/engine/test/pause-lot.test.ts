import { describe, expect, it } from 'vitest';
import { parseCommand } from '../src/commands.js';
import { decide, nextDeadline } from '../src/decide/index.js';
import { A, L1, bid, errCode, id, mk, open, run, scene } from './decide-helpers.js';

const pause = (at: number, commandId = id('PA1')) =>
  mk(at, { type: 'PauseLot', lotId: L1, actor: 'host' }, commandId);
const resume = (at: number, commandId = id('RE1')) =>
  mk(at, { type: 'ResumeLot', lotId: L1, actor: 'host' }, commandId);
const extend = (at: number, extraMs: number, commandId = id('EX1')) =>
  mk(at, { type: 'ExtendLot', lotId: L1, extraMs, reason: 'tech issue', actor: 'host' }, commandId);

describe('decide PauseLot, ResumeLot and ExtendLot', () => {
  it('T-ENG-039 R-RT-048 pause then resume restores the time that was left', () => {
    let s = open(scene(), L1);
    const endsAt = s.lots[L1]?.endsAt ?? 0;
    const pauseAt = endsAt - 5000;
    const p = run(s, pause(pauseAt));
    expect(p.entries.map((e) => e.type)).toEqual(['LOT_PAUSED']);
    expect(p.entries[0]?.payload).toEqual({ lotId: L1, actor: 'host', remainingMs: 5000 });
    s = p.state;
    expect(s.lots[L1]?.pausedRemainingMs).toBe(5000);
    expect(nextDeadline(s)).toBeNull();
    // Long after the old deadline a Tick still does nothing while paused.
    const t = run(s, mk(endsAt + 60000, { type: 'Tick' }));
    expect(t.entries).toEqual([]);
    const r = run(s, resume(endsAt + 60000));
    expect(r.entries.map((e) => e.type)).toEqual(['LOT_RESUMED']);
    expect(r.entries[0]?.payload).toEqual({
      lotId: L1,
      actor: 'host',
      endsAtBefore: endsAt,
      endsAtAfter: endsAt + 60000 + 5000,
    });
    expect(r.state.lots[L1]?.endsAt).toBe(endsAt + 65000);
    expect(r.state.lots[L1]?.pausedRemainingMs).toBeUndefined();
    expect('pausedRemainingMs' in (r.state.lots[L1] ?? {})).toBe(false);
  });

  it('T-ENG-039 R-RT-048 a paused lot rejects bids and early hammers', () => {
    let s = open(scene(), L1);
    s = run(s, pause(500)).state;
    const b = bid(s, 600, A, 2000);
    expect(b.entries.map((e) => e.type)).toEqual(['BID_REJECTED']);
    expect(b.entries[0]?.payload).toMatchObject({
      reason: 'lot_not_open',
      detail: { paused: true },
    });
    expect(
      errCode(() => decide(s, mk(700, { type: 'Hammer', lotId: L1, actor: 'h', early: true }))),
    ).toBe('cannot_hammer');
    s = run(s, resume(800)).state;
    expect(bid(s, 900, A, 2000).entries.map((e) => e.type)).toEqual(['BID_RECORDED']);
  });

  it('T-ENG-039 R-RT-048 pause and resume are refused in the wrong state', () => {
    let s = open(scene(), L1);
    expect(errCode(() => decide(s, resume(300)))).toBe('bad_command');
    s = run(s, pause(300)).state;
    expect(errCode(() => decide(s, pause(400, id('PA2'))))).toBe('bad_command');
    const endsAt = s.lots[L1]?.endsAt ?? 0;
    const fresh = open(scene(), L1);
    expect(errCode(() => decide(fresh, pause(endsAt)))).toBe('lot_not_open');
    const pending = scene();
    expect(errCode(() => decide(pending, pause(50)))).toBe('lot_not_open');
  });

  it('T-ENG-039 R-RT-049 extend moves the deadline and a Tick waits for it', () => {
    let s = open(scene(), L1);
    const endsAt = s.lots[L1]?.endsAt ?? 0;
    const r = run(s, extend(endsAt - 1000, 30000));
    expect(r.entries.map((e) => e.type)).toEqual(['LOT_EXTENDED']);
    expect(r.entries[0]?.payload).toEqual({
      lotId: L1,
      actor: 'host',
      reason: 'tech issue',
      extraMs: 30000,
      endsAtBefore: endsAt,
      endsAtAfter: endsAt + 30000,
    });
    s = r.state;
    expect(s.lots[L1]?.endsAt).toBe(endsAt + 30000);
    expect(s.lots[L1]?.extensions).toBe(0);
    expect(run(s, mk(endsAt + 1, { type: 'Tick' })).entries).toEqual([]);
    expect(run(s, mk(endsAt + 30000, { type: 'Tick' })).entries.map((e) => e.type)).toEqual([
      'LOT_CLOSING',
    ]);
  });

  it('T-ENG-039 R-RT-049 extend is refused when paused or past the deadline', () => {
    let s = open(scene(), L1);
    const endsAt = s.lots[L1]?.endsAt ?? 0;
    expect(errCode(() => decide(s, extend(endsAt, 1000)))).toBe('lot_not_open');
    s = run(s, pause(300)).state;
    expect(errCode(() => decide(s, extend(400, 1000)))).toBe('bad_command');
  });

  it('T-ENG-039 R-RT-049 parseCommand bounds the extension', () => {
    const body = {
      type: 'ExtendLot',
      commandId: id('EX9'),
      at: 5,
      auctionId: id('AAA'),
      lotId: L1,
      extraMs: 1000,
      reason: 'r',
      actor: 'a',
    };
    expect(parseCommand(body).type).toBe('ExtendLot');
    expect(errCode(() => parseCommand({ ...body, extraMs: 0 }))).toBe('bad_command');
    expect(errCode(() => parseCommand({ ...body, extraMs: 600001 }))).toBe('bad_command');
    const plain = {
      commandId: body.commandId,
      at: body.at,
      auctionId: body.auctionId,
      lotId: body.lotId,
      actor: body.actor,
    };
    expect(parseCommand({ ...plain, type: 'PauseLot' }).type).toBe('PauseLot');
    expect(parseCommand({ ...plain, type: 'ResumeLot' }).type).toBe('ResumeLot');
  });

  it('T-ENG-039 R-RT-048 a duplicate pause is deduplicated', () => {
    let s = open(scene(), L1);
    const r1 = run(s, pause(300));
    s = r1.state;
    expect(run(s, pause(300)).entries).toEqual([]);
    const r2 = run(s, resume(900));
    const r3 = run(r2.state, extend(950, 10000, id('EX2')));
    const entries = [...r1.entries, ...r2.entries, ...r3.entries];
    expect(entries.map((e) => e.type)).toEqual(['LOT_PAUSED', 'LOT_RESUMED', 'LOT_EXTENDED']);
  });
});
