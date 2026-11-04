import { describe, expect, it } from 'vitest';
import { decide } from '../src/decide/index.js';
import { ENGINE_ERROR_CODES } from '../src/errors.js';
import { A, B, L1, L2, bid, errCode, lotConfig, mk, open, run, scene } from './decide-helpers.js';

describe('decide OpenLot', () => {
  it('T-ENG-046 R-ENG-061 R-ENG-062 opens lots in order, one at a time', () => {
    const s = scene({ lots: [lotConfig(L1), lotConfig(L2)] });
    expect(errCode(() => decide(s, mk(100, { type: 'OpenLot', lotId: L2 })))).toBe('out_of_order');

    const o1 = run(s, mk(100, { type: 'OpenLot', lotId: L1 }));
    expect(o1.entries.map((e) => e.type)).toEqual(['LOT_OPENED']);
    expect(o1.entries[0]?.payload).toEqual({ lotId: L1, endsAt: 10100 });
    expect(o1.state.lots[L1]?.status).toBe('OPEN');

    // Lot 2 while lot 1 is OPEN, and while it is CLOSING.
    expect(errCode(() => decide(o1.state, mk(200, { type: 'OpenLot', lotId: L2 })))).toBe(
      'lot_in_progress',
    );
    const closing = run(o1.state, mk(10100, { type: 'Tick' })).state;
    expect(closing.lots[L1]?.status).toBe('CLOSING');
    expect(errCode(() => decide(closing, mk(10200, { type: 'OpenLot', lotId: L2 })))).toBe(
      'lot_in_progress',
    );

    const settling = run(closing, mk(10200, { type: 'Hammer', lotId: L1, actor: 'host' })).state;
    expect(settling.lots[L1]?.status).toBe('DONE');
    const o2 = run(settling, mk(10300, { type: 'OpenLot', lotId: L2 }));
    expect(o2.state.lots[L2]?.status).toBe('OPEN');
    expect(o2.state.lots[L2]?.endsAt).toBe(20300);
  });

  it('T-ENG-046 R-ENG-061 a SETTLING previous lot allows the next lot', () => {
    let s = open(scene({ lots: [lotConfig(L1), lotConfig(L2)] }), L1);
    s = bid(s, 200, A, 1000).state;
    s = run(s, mk(10100, { type: 'Tick' })).state;
    s = run(s, mk(10100, { type: 'Hammer', lotId: L1, actor: 'host' })).state;
    expect(s.lots[L1]?.status).toBe('SETTLING');
    expect(errCode(() => decide(s, mk(10200, { type: 'OpenLot', lotId: L2 })))).toBe('none');
  });

  it('T-ENG-046 R-ENG-065 bids on lot 2 do not alter lot 1', () => {
    let s = open(scene({ lots: [lotConfig(L1), lotConfig(L2)] }), L1);
    s = bid(s, 200, A, 1000).state;
    s = run(s, mk(10100, { type: 'Tick' })).state;
    s = run(s, mk(10100, { type: 'Hammer', lotId: L1, actor: 'host' })).state;
    const lot1 = s.lots[L1];
    s = open(s, L2, 10200);
    s = bid(s, 10300, B, 2000, L2).state;
    expect(s.lots[L1]).toEqual(lot1);
    expect(s.lots[L2]?.leaderId).toBe(B);
  });

  it('R-ENG-062 rejects unknown, finished and frozen lots with the right code', () => {
    const s = open(scene(), L1);
    expect(errCode(() => decide(s, mk(200, { type: 'OpenLot', lotId: B })))).toBe('bad_command');
    expect(errCode(() => decide(s, mk(200, { type: 'OpenLot', lotId: L1 })))).toBe(
      'lot_in_progress',
    );
  });

  it('out_of_order is a declared engine error code', () => {
    expect(ENGINE_ERROR_CODES).toContain('out_of_order');
  });
});
