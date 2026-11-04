import { describe, expect, it } from 'vitest';
import { parseCommand } from '../src/commands.js';
import { EngineError } from '../src/errors.js';
import { LEDGER_EVENT_TYPES } from '../src/events.js';

const A = '01JC0000000000000000000001';
const C = '01JC0000000000000000000A01';
const B = '01JC0000000000000000000BD2';
const L = '01JC00000000000000000002M1';
const base = { commandId: C, at: 1000, auctionId: A };
const bid = {
  ...base,
  type: 'PlaceBid',
  lotId: L,
  bidderId: B,
  amountCents: 1500,
  source: 'voice',
  audit: { confidenceBps: 9000 },
};

function code(f: () => unknown): string {
  try {
    f();
  } catch (e) {
    if (e instanceof EngineError) return e.code;
    throw e;
  }
  return 'none';
}

describe('commands', () => {
  it('T-ENG-063 (R-ENG-089): unknown type and extra field are bad_command', () => {
    expect(code(() => parseCommand({ ...base, type: 'Withdraw' }))).toBe('bad_command');
    expect(code(() => parseCommand({ ...bid, foo: 1 }))).toBe('bad_command');
    expect(code(() => parseCommand({ ...bid, audit: { x: 1 } }))).toBe('bad_command');
    expect(code(() => parseCommand(null))).toBe('bad_command');
  });

  it('R-ENG-084: source must be voice, manual or qr', () => {
    expect(parseCommand({ ...bid, source: 'qr' }).type).toBe('PlaceBid');
    expect(code(() => parseCommand({ ...bid, source: 'phone' }))).toBe('bad_command');
  });

  it('R-ENG-083: confidenceBps 10001 fails', () => {
    expect(code(() => parseCommand({ ...bid, audit: { confidenceBps: 10001 } }))).toBe(
      'bad_command',
    );
  });

  it('parses every simple command and rejects bad ids', () => {
    expect(parseCommand({ ...base, type: 'Tick' }).type).toBe('Tick');
    expect(parseCommand({ ...base, type: 'CloseAuction' }).type).toBe('CloseAuction');
    expect(
      parseCommand({ ...base, type: 'Hammer', lotId: L, early: true, actor: 'host' }),
    ).toMatchObject({ early: true });
    expect(code(() => parseCommand({ ...bid, bidderId: 'nope' }))).toBe('bad_command');
    expect(
      code(() =>
        parseCommand({
          ...base,
          type: 'RecordSettlement',
          lotId: L,
          from: 'HELD',
          to: 'X',
          ref: 'r',
        }),
      ),
    ).toBe('bad_command');
  });

  it('R-ENG-070: the ledger has 19 event types', () => {
    expect(new Set(LEDGER_EVENT_TYPES).size).toBe(19);
  });
});
