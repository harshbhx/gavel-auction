import { describe, expect, it } from 'vitest';
import { decide, decideDev, deepFreeze } from '../src/decide/index.js';
import { evolve } from '../src/evolve.js';
import { commandBody, entryBody } from '../src/state.js';
import type { Command } from '../src/commands.js';
import { initialState } from '../src/state.js';
import {
  A,
  AU,
  L1,
  bid,
  errCode,
  id,
  lotConfig,
  mk,
  open,
  run,
  scene,
  seal,
} from './decide-helpers.js';

const CID = id('DUPLICATE');

const placeBid = (amount: number, at = 200): Command =>
  mk(
    at,
    { type: 'PlaceBid', lotId: L1, bidderId: A, amountCents: amount, source: 'manual', audit: {} },
    CID,
  );

describe('decide wrapper', () => {
  it('T-ENG-061 R-ENG-087 a repeated command is a duplicate and appends nothing', () => {
    const s = open(scene(), L1);
    const first = run(s, placeBid(1000));
    expect(first.result.outcome.kind).toBe('accepted');
    const again = run(first.state, placeBid(1000));
    expect(again.result).toEqual({ events: [], outcome: { kind: 'duplicate' } });
    expect(again.state).toBe(first.state);
    expect(first.state.commands[CID]?.seq).toBe(first.entries[0]?.seq);
    // A retry stamped later is still the same command.
    expect(decide(first.state, placeBid(1000, 900)).outcome.kind).toBe('duplicate');
  });

  it('T-ENG-061 R-ENG-087 a duplicate of an implicit close does not close twice', () => {
    const s = open(scene(), L1);
    const first = run(s, placeBid(1000, 10100));
    expect(first.entries.map((e) => e.type)).toEqual(['LOT_CLOSING', 'BID_REJECTED']);
    expect(decide(first.state, placeBid(1000, 10100)).outcome.kind).toBe('duplicate');
    expect(errCode(() => decide(first.state, placeBid(1100, 10100)))).toBe('command_conflict');
  });

  it('T-ENG-062 R-ENG-088 the same id with another body is a conflict', () => {
    const s = open(scene(), L1);
    const first = run(s, placeBid(1500));
    expect(errCode(() => decide(first.state, placeBid(1600)))).toBe('command_conflict');
    const other = mk(300, { type: 'OpenLot', lotId: L1 }, CID);
    expect(errCode(() => decide(first.state, other))).toBe('command_conflict');
  });

  it('R-ENG-087 R-ENG-088 setup commands dedupe by id too', () => {
    let s = initialState;
    const c = mk(1, { type: 'CreateAuction', title: 'Gala', config: {} }, id('CREATE'));
    s = run(s, c).state;
    expect(decide(s, c).outcome.kind).toBe('duplicate');
    const changed = mk(1, { type: 'CreateAuction', title: 'Other', config: {} }, id('CREATE'));
    expect(errCode(() => decide(s, changed))).toBe('command_conflict');
    const lot = mk(2, { type: 'AddLot', lot: lotConfig(L1) }, id('ADDLOT'));
    s = run(s, lot).state;
    expect(decide(s, lot).outcome.kind).toBe('duplicate');
  });

  it('R-ENG-087 the index survives replay: entry digests equal command digests', () => {
    const s = open(scene(), L1);
    const cmds: Command[] = [
      mk(150, {
        type: 'RegisterBidder',
        bidderId: A,
        ceilingCents: 95000,
      }),
      placeBid(1000),
      mk(10200, { type: 'Hammer', lotId: L1, actor: 'h', early: true }),
    ];
    let st = s;
    for (const c of cmds) {
      const r = decide(st, c);
      const entries = seal(st, c, r);
      const body = commandBody(c);
      expect(entries.some((e) => entryBody(e) === body)).toBe(true);
      st = entries.reduce(evolve, st);
      expect(st.commands[c.commandId]?.body).toBe(body);
    }
  });

  it('T-ENG-064 R-ENG-090 decide is pure on frozen inputs', () => {
    const s = open(scene(), L1);
    const cmd = placeBid(1000);
    const frozenState = deepFreeze(structuredClone(s));
    const frozenCmd = deepFreeze(structuredClone(cmd));
    const one = decide(frozenState, frozenCmd);
    const two = decide(frozenState, frozenCmd);
    expect(one).toEqual(two);
    expect(decideDev(s, cmd)).toEqual(one);
  });

  it('R-ENG-089 commands that are not implemented yet fail bad_command', () => {
    const s = scene();
    expect(errCode(() => decide(s, mk(5, { type: 'CloseAuction' })))).toBe('bad_command');
  });
});
