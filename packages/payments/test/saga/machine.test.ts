import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  allowedTransitions,
  EVENT_TYPES,
  IllegalTransition,
  step,
  TERMINAL_STATES,
  type SettlementEvent,
  type SettlementEventType,
} from '../../src/saga/machine.js';
import {
  SETTLEMENT_STATES,
  type Journal,
  type JournalWinner,
  type SettlementState,
} from '../../src/types.js';

/** SPEC 6.1 explicit table, written out independently of the implementation. */
const SPEC_TABLE: Record<SettlementState, SettlementState[]> = {
  HELD: ['BIDDING', 'VOIDING'],
  BIDDING: ['WINNER_SELECTED', 'VOIDING'],
  WINNER_SELECTED: ['CAPTURING', 'VOIDING', 'FAILED_NEEDS_REVIEW'],
  CAPTURING: ['CAPTURED', 'FALLBACK_RUNNER_UP', 'FAILED_NEEDS_REVIEW'],
  FALLBACK_RUNNER_UP: ['CAPTURING', 'VOIDING', 'FAILED_NEEDS_REVIEW'],
  CAPTURED: ['VOIDING', 'FAILED_NEEDS_REVIEW'],
  VOIDING: ['SETTLED', 'FAILED_NEEDS_REVIEW'],
  SETTLED: [],
  FAILED_NEEDS_REVIEW: [],
};

function deepFreeze<T>(v: T): T {
  if (v !== null && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const child of Object.values(v as Record<string, unknown>)) deepFreeze(child);
  }
  return v;
}

function journalIn(state: SettlementState): Journal {
  return {
    v: 1,
    auctionId: 'a1',
    version: 7,
    state,
    plan: {
      reserveCents: 5000,
      candidates: [
        { bidderId: 'b1', priceCents: 22000 },
        { bidderId: 'b2', priceCents: 21000 },
      ],
    },
    holds: {
      b1: { holdId: 'h1', authId: 'AUTH-1', ceilingCents: 30000, stale: false },
      b2: { holdId: 'h2', authId: 'AUTH-2', ceilingCents: 25000, stale: false },
    },
    cursor: 0,
    intent: null,
    unknownSince: null,
    winner: null,
    failed: [],
    voids: {},
    resumes: 0,
    history: [],
  };
}

function eventOf(type: SettlementEventType, tsMs = 1000): SettlementEvent {
  if (type === 'capture_ok' || type === 'adopted') {
    return {
      type,
      tsMs,
      winner: { bidderId: 'b1', holdId: 'h1', captureId: 'CAP-1', amountCents: 22000 },
    };
  }
  if (type === 'definite_fail') {
    return { type, tsMs, failure: { bidderId: 'b1', reason: 'declined' } };
  }
  return { type, tsMs };
}

describe('T-PAY-030 transition table', () => {
  it('every (state, event) pair: allowed pairs match 6.1, all others throw IllegalTransition', () => {
    const reached = new Map<SettlementState, Set<SettlementState>>();
    for (const state of SETTLEMENT_STATES) reached.set(state, new Set());

    for (const state of SETTLEMENT_STATES) {
      for (const type of EVENT_TYPES) {
        const input = deepFreeze(journalIn(state));
        const ev = eventOf(type);
        let result: ReturnType<typeof step> | undefined;
        let error: unknown;
        try {
          result = step(input, ev);
        } catch (e) {
          error = e;
        }
        if (result === undefined) {
          expect(error, `${state} + ${type}`).toBeInstanceOf(IllegalTransition);
        } else {
          expect(SPEC_TABLE[state], `${state} + ${type}`).toContain(result.journal.state);
          reached.get(state)?.add(result.journal.state);
        }
      }
    }

    for (const state of SETTLEMENT_STATES) {
      expect([...(reached.get(state) ?? [])].sort()).toEqual([...SPEC_TABLE[state]].sort());
    }
  });

  it('allowedTransitions agrees with the SPEC table', () => {
    for (const t of allowedTransitions()) expect(SPEC_TABLE[t.from]).toContain(t.to);
    expect(allowedTransitions().length).toBeGreaterThanOrEqual(
      Object.values(SPEC_TABLE).reduce((n, tos) => n + tos.length, 0),
    );
  });

  it('terminal states reject every event', () => {
    for (const state of TERMINAL_STATES) {
      for (const type of EVENT_TYPES) {
        expect(() => step(journalIn(state), eventOf(type))).toThrow(IllegalTransition);
      }
    }
  });

  it('step is pure: repeated calls deep-equal and the input is untouched', () => {
    let compared = 0;
    for (const state of SETTLEMENT_STATES) {
      for (const type of EVENT_TYPES) {
        const input = deepFreeze(journalIn(state));
        const ev = deepFreeze(eventOf(type));
        let a: ReturnType<typeof step>;
        try {
          a = step(input, ev);
        } catch (e) {
          // Only a rejected transition may be skipped; any other failure is a defect.
          expect(e, `${state} + ${type}`).toBeInstanceOf(IllegalTransition);
          continue;
        }
        compared += 1;
        const b = step(input, ev);
        expect(b).toEqual(a);
        expect(a.journal).not.toBe(input);
        expect(input).toEqual(journalIn(state));
      }
    }
    expect(compared).toBe(allowedTransitions().length);
    expect(compared).toBeGreaterThan(0);
  });

  it('records version, history and timestamps', () => {
    const { journal } = step(journalIn('HELD'), {
      type: 'start_auction',
      tsMs: 42,
      label: 'journaled:go',
    });
    expect(journal.version).toBe(8);
    expect(journal.state).toBe('BIDDING');
    expect(journal.history).toEqual([
      { seq: 1, tsMs: 42, from: 'HELD', to: 'BIDDING', label: 'journaled:go' },
    ]);
    const second = step(journal, { type: 'hammer', tsMs: 43 });
    expect(second.journal.history.map((h) => [h.seq, h.label])).toEqual([
      [1, 'journaled:go'],
      [2, 'journaled:hammer'],
    ]);
  });
});

describe('effects are data', () => {
  it('begin captures the first candidate at its price', () => {
    const { effects } = step(journalIn('WINNER_SELECTED'), eventOf('begin'));
    expect(effects).toEqual([
      {
        op: 'capture',
        cursor: 0,
        bidderId: 'b1',
        holdId: 'h1',
        authId: 'AUTH-1',
        amountCents: 22000,
      },
    ]);
  });

  it('capture_ok records the winner; begin_void voids every other hold', () => {
    const captured = step(journalIn('CAPTURING'), eventOf('capture_ok')).journal;
    expect(captured.winner?.captureId).toBe('CAP-1');
    const { effects, journal } = step(captured, eventOf('begin_void'));
    expect(journal.state).toBe('VOIDING');
    expect(effects).toEqual([{ op: 'void_holds', holdIds: ['h2'] }]);
  });

  it('definite_fail then next_candidate moves the cursor to the runner-up', () => {
    const failed = step(journalIn('CAPTURING'), eventOf('definite_fail')).journal;
    expect(failed.failed).toEqual([{ bidderId: 'b1', reason: 'declined' }]);
    const { journal, effects } = step(failed, eventOf('next_candidate'));
    expect(journal.state).toBe('CAPTURING');
    expect(journal.cursor).toBe(1);
    expect(effects).toEqual([
      {
        op: 'capture',
        cursor: 1,
        bidderId: 'b2',
        holdId: 'h2',
        authId: 'AUTH-2',
        amountCents: 21000,
      },
    ]);
  });

  it('refuses a winner that is not the candidate at the cursor, with another hold or a wrong amount', () => {
    const base = journalIn('CAPTURING');
    const win = (w: Partial<JournalWinner>, type: 'capture_ok' | 'adopted' = 'capture_ok') => ({
      type,
      tsMs: 1,
      winner: { bidderId: 'b1', holdId: 'h1', captureId: 'CAP-1', amountCents: 22000, ...w },
    });
    expect(() => step(base, win({ bidderId: 'b2', holdId: 'h2', amountCents: 21000 }))).toThrow(
      IllegalTransition,
    );
    expect(() => step(base, win({ holdId: 'h2' }))).toThrow(IllegalTransition);
    expect(() => step(base, win({ amountCents: 99999 }))).toThrow(IllegalTransition);
    expect(() => step(base, win({ amountCents: 21000 }))).toThrow(IllegalTransition);
    expect(() => step(base, win({ amountCents: 30001 }, 'adopted'))).toThrow(IllegalTransition);
    // an adopted capture must also be at exactly the planned price
    expect(() => step(base, win({ amountCents: 21000 }, 'adopted'))).toThrow(IllegalTransition);
    expect(() => step(base, win({ amountCents: 25000 }, 'adopted'))).toThrow(IllegalTransition);
    expect(step(base, win({ amountCents: 22000 }, 'adopted')).journal.winner?.amountCents).toBe(
      22000,
    );
  });

  it('refuses a failure for a bidder other than the candidate at the cursor', () => {
    expect(() =>
      step(journalIn('CAPTURING'), {
        type: 'definite_fail',
        tsMs: 1,
        failure: { bidderId: 'b2', reason: 'declined' },
      }),
    ).toThrow(IllegalTransition);
  });

  it('no sale voids all holds', () => {
    const { effects } = step(journalIn('FALLBACK_RUNNER_UP'), eventOf('no_candidates_left'));
    expect(effects).toEqual([{ op: 'void_holds', holdIds: ['h1', 'h2'] }]);
  });

  it('failure events flag the settlement for review', () => {
    const { effects } = step(journalIn('CAPTURING'), eventOf('unknown_deadline'));
    expect(effects).toEqual([{ op: 'flag_review', reason: 'unknown_deadline' }]);
  });

  it('next_candidate past the last candidate is illegal', () => {
    const j = { ...journalIn('FALLBACK_RUNNER_UP'), cursor: 1 };
    expect(() => step(j, eventOf('next_candidate'))).toThrow(IllegalTransition);
  });
});

const eventArb: fc.Arbitrary<SettlementEvent> = fc
  .tuple(fc.constantFrom(...EVENT_TYPES), fc.integer({ min: 0, max: 1_000_000 }))
  .map(([type, ts]) => eventOf(type, ts));

describe('T-PAY-031 random event sequences', () => {
  it('state stays in the nine values and terminal states never leave', () => {
    fc.assert(
      fc.property(fc.array(eventArb, { maxLength: 40 }), (events) => {
        let j = journalIn('HELD');
        let terminalSeen: SettlementState | null = null;
        let applied = 0;
        for (const ev of events) {
          const before = JSON.stringify(j);
          try {
            j = step(j, ev).journal;
            applied += 1;
          } catch (e) {
            if (!(e instanceof IllegalTransition)) throw e;
            if (JSON.stringify(j) !== before) return false;
          }
          if (!SETTLEMENT_STATES.includes(j.state)) return false;
          if (terminalSeen !== null && j.state !== terminalSeen) return false;
          if (TERMINAL_STATES.includes(j.state)) terminalSeen = j.state;
        }
        return j.version === 7 + applied && j.history.length === applied;
      }),
      { numRuns: 300 },
    );
  });

  it('every applied step follows the SPEC table', () => {
    fc.assert(
      fc.property(fc.array(eventArb, { maxLength: 40 }), (events) => {
        let j = journalIn('HELD');
        for (const ev of events) {
          try {
            const next = step(j, ev).journal;
            if (!SPEC_TABLE[j.state].includes(next.state)) return false;
            j = next;
          } catch (e) {
            if (!(e instanceof IllegalTransition)) throw e;
          }
        }
        return true;
      }),
      { numRuns: 300 },
    );
  });
});
