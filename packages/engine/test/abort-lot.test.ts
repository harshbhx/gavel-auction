import { describe, expect, it } from 'vitest';
import { parseCommand } from '../src/commands.js';
import { decide } from '../src/decide/index.js';
import { projectAuditor, projectPublic } from '../src/projections.js';
import { A, L1, L2, bid, errCode, id, lotConfig, mk, open, run, scene } from './decide-helpers.js';

const abort = (at: number, lotId = L1, commandId = id('AB1')) =>
  mk(at, { type: 'AbortLot', lotId, reason: 'kill switch', actor: 'host' }, commandId);

describe('decide AbortLot', () => {
  it('R-ENG-068 ENG-90 an OPEN lot with bids is cancelled with no winner', () => {
    let s = open(scene(), L1);
    s = bid(s, 200, A, 2000).state;
    const r = run(s, abort(300));
    expect(r.entries.map((e) => e.type)).toEqual(['LOT_ABORTED']);
    expect(r.entries[0]?.payload).toEqual({ lotId: L1, reason: 'kill switch', actor: 'host' });
    const lot = r.state.lots[L1];
    expect(lot?.status).toBe('DONE');
    expect(lot?.winnerId).toBeNull();
    expect(lot?.priceCents).toBeNull();
    expect(lot?.abortReason).toBe('kill switch');
    expect(lot?.unsoldReason).toBeNull();
  });

  it('R-ENG-068 ENG-90 a CLOSING lot and a PENDING lot can be aborted', () => {
    let s = open(scene(), L1);
    s = run(s, mk(20000, { type: 'Tick' })).state;
    expect(s.lots[L1]?.status).toBe('CLOSING');
    expect(run(s, abort(20001)).state.lots[L1]?.status).toBe('DONE');
    const p = scene({ lots: [lotConfig(L1), lotConfig(L2)] });
    expect(run(p, abort(5, L2)).state.lots[L2]?.status).toBe('DONE');
  });

  it('R-ENG-068 ENG-90 an aborted lot frees the room for the next lot and takes no bids', () => {
    let s = open(scene({ lots: [lotConfig(L1), lotConfig(L2)] }), L1);
    s = run(s, abort(300)).state;
    expect(errCode(() => bid(s, 400, A, 2000))).toBe('lot_done');
    expect(errCode(() => decide(s, mk(400, { type: 'Hammer', lotId: L1, actor: 'h' })))).toBe(
      'lot_done',
    );
    expect(errCode(() => decide(s, abort(400, L1, id('AB2'))))).toBe('lot_done');
    s = open(s, L2, 500);
    expect(s.lots[L2]?.status).toBe('OPEN');
  });

  it('R-ENG-068 ENG-90 a hammered lot cannot be aborted', () => {
    let s = open(scene(), L1);
    s = bid(s, 200, A, 2000).state;
    s = run(s, mk(300, { type: 'Hammer', lotId: L1, actor: 'host', early: true })).state;
    expect(errCode(() => decide(s, abort(400)))).toBe('lot_frozen');
  });

  it('R-ENG-068 ENG-90 unknown lot, closed auction and over-long text are refused', () => {
    const s = open(scene(), L1);
    expect(errCode(() => decide(s, abort(300, id('ZZ9'))))).toBe('bad_command');
    const long = mk(300, { type: 'AbortLot', lotId: L1, reason: 'x'.repeat(5000), actor: 'h' });
    expect(errCode(() => decide(s, long))).toBe('limit_exceeded');
  });

  it('R-ENG-068 ENG-90 a retried command is a duplicate and a changed body conflicts', () => {
    const s = run(open(scene(), L1), abort(300)).state;
    expect(decide(s, abort(400)).outcome.kind).toBe('duplicate');
    const other = mk(
      400,
      { type: 'AbortLot', lotId: L1, reason: 'other', actor: 'host' },
      id('AB1'),
    );
    expect(errCode(() => decide(s, other))).toBe('command_conflict');
  });

  it('R-ENG-068 ENG-90 the parser accepts the command and rejects unknown fields', () => {
    const base = { commandId: id('AB9'), at: 5, auctionId: id('AAA'), type: 'AbortLot' };
    const ok = { ...base, lotId: L1, reason: 'r', actor: 'a' };
    expect(parseCommand(ok)).toMatchObject({ type: 'AbortLot', lotId: L1 });
    expect(() => parseCommand({ ...ok, extra: 1 })).toThrow();
    expect(() => parseCommand({ ...ok, actor: undefined })).toThrow();
  });

  it('R-ENG-068 ENG-90 projections show the aborted lot', () => {
    let s = open(scene(), L1);
    const r = run(s, abort(300));
    s = r.state;
    const view = projectPublic(s, (x) => x).lots[0];
    expect(view).toMatchObject({ status: 'DONE', aborted: true, priceCents: null });
    expect(projectPublic(open(scene(), L1), (x) => x).lots[0]?.aborted).toBe(false);
    expect(projectAuditor(r.entries).map((e) => e.type)).toEqual(['LOT_ABORTED']);
  });
});
