import type {
  Journal,
  JournalFailure,
  JournalHistoryEntry,
  JournalWinner,
  SettlementState,
} from '../types.js';

/**
 * Settlement state machine (SPEC 6.1, R-PAY-040, R-PAY-041, R-PAY-043).
 * `step(journal, event)` is pure: no I/O, no clock, no randomness. The caller
 * supplies the timestamp in the event. It returns a new journal (the input is
 * never mutated, version + 1, one history entry) and the effects the runner must
 * execute after persisting that journal.
 */

export const EVENT_TYPES = [
  'start_auction',
  'cancel',
  'hammer',
  'no_candidate',
  'begin',
  'capture_ok',
  'adopted',
  'definite_fail',
  'next_candidate',
  'no_candidates_left',
  'begin_void',
  'all_released',
  'invariant',
  'unknown_deadline',
  'mismatch',
  'void_budget_exhausted',
] as const;
export type SettlementEventType = (typeof EVENT_TYPES)[number];

interface Base {
  /** Timestamp for the history entry, from the runner's injected clock. */
  tsMs: number;
  /** Crash label for the history entry; defaults to `journaled:<type>`. */
  label?: string;
}

export type SettlementEvent =
  | (Base & { type: 'capture_ok' | 'adopted'; winner: JournalWinner })
  | (Base & { type: 'definite_fail'; failure: JournalFailure })
  | (Base & {
      type: Exclude<SettlementEventType, 'capture_ok' | 'adopted' | 'definite_fail'>;
    });

export type SettlementEffect =
  | {
      op: 'capture';
      cursor: number;
      bidderId: string;
      holdId: string;
      authId: string;
      amountCents: number;
    }
  | { op: 'void_holds'; holdIds: string[] }
  | { op: 'flag_review'; reason: string };

export interface StepResult {
  journal: Journal;
  effects: SettlementEffect[];
}

/** Allowed (event -> from -> to), the explicit table of SPEC 6.1. */
const TRANSITIONS: Readonly<
  Record<SettlementEventType, Partial<Record<SettlementState, SettlementState>>>
> = {
  start_auction: { HELD: 'BIDDING' },
  cancel: { HELD: 'VOIDING', BIDDING: 'VOIDING' },
  hammer: { BIDDING: 'WINNER_SELECTED' },
  no_candidate: { WINNER_SELECTED: 'VOIDING' },
  begin: { WINNER_SELECTED: 'CAPTURING' },
  capture_ok: { CAPTURING: 'CAPTURED' },
  adopted: { CAPTURING: 'CAPTURED' },
  definite_fail: { CAPTURING: 'FALLBACK_RUNNER_UP' },
  next_candidate: { FALLBACK_RUNNER_UP: 'CAPTURING' },
  no_candidates_left: { FALLBACK_RUNNER_UP: 'VOIDING' },
  begin_void: { CAPTURED: 'VOIDING' },
  all_released: { VOIDING: 'SETTLED' },
  invariant: {
    WINNER_SELECTED: 'FAILED_NEEDS_REVIEW',
    CAPTURING: 'FAILED_NEEDS_REVIEW',
    FALLBACK_RUNNER_UP: 'FAILED_NEEDS_REVIEW',
  },
  unknown_deadline: { CAPTURING: 'FAILED_NEEDS_REVIEW' },
  mismatch: { CAPTURING: 'FAILED_NEEDS_REVIEW', CAPTURED: 'FAILED_NEEDS_REVIEW' },
  void_budget_exhausted: { VOIDING: 'FAILED_NEEDS_REVIEW' },
};

export const TERMINAL_STATES: readonly SettlementState[] = ['SETTLED', 'FAILED_NEEDS_REVIEW'];

export class IllegalTransition extends Error {
  from: SettlementState;
  event: SettlementEventType;
  constructor(from: SettlementState, event: SettlementEventType, reason?: string) {
    super(`illegal transition: ${event} from ${from}${reason === undefined ? '' : ` (${reason})`}`);
    this.name = 'IllegalTransition';
    this.from = from;
    this.event = event;
  }
}

/** The state an event leads to from a state, or null when the pair is not allowed. */
export function nextState(
  from: SettlementState,
  event: SettlementEventType,
): SettlementState | null {
  return TRANSITIONS[event][from] ?? null;
}

/** All allowed (from, event, to) triples; the exhaustive test compares them to SPEC 6.1. */
export function allowedTransitions(): Array<{
  from: SettlementState;
  event: SettlementEventType;
  to: SettlementState;
}> {
  const out: Array<{ from: SettlementState; event: SettlementEventType; to: SettlementState }> = [];
  for (const event of EVENT_TYPES) {
    for (const [from, to] of Object.entries(TRANSITIONS[event])) {
      if (to !== undefined) out.push({ from: from as SettlementState, event, to });
    }
  }
  return out;
}

function captureEffect(
  j: Journal,
  cursor: number,
  from: SettlementState,
  event: SettlementEventType,
): SettlementEffect {
  const cand = j.plan.candidates[cursor];
  if (cand === undefined) throw new IllegalTransition(from, event, 'no candidate at cursor');
  const hold = j.holds[cand.bidderId];
  if (hold === undefined) throw new IllegalTransition(from, event, 'candidate has no hold');
  return {
    op: 'capture',
    cursor,
    bidderId: cand.bidderId,
    holdId: hold.holdId,
    authId: hold.authId,
    amountCents: cand.priceCents,
  };
}

/** Holds to void on entering VOIDING: every hold except the winner's, sorted by id. */
function voidTargets(j: Journal): string[] {
  const winnerHold = j.winner?.holdId;
  return Object.values(j.holds)
    .map((h) => h.holdId)
    .filter((id) => id !== winnerHold)
    .sort();
}

/** The candidate at the cursor, the one every capture or failure event must refer to. */
function currentCandidate(
  journal: Journal,
  event: SettlementEvent,
): { bidderId: string; priceCents: number } {
  const cand = journal.plan.candidates[journal.cursor];
  if (cand === undefined) {
    throw new IllegalTransition(journal.state, event.type, 'no candidate at the cursor');
  }
  return cand;
}

/**
 * Checks a winner payload against the journal (R-PAY-040, R-PAY-052, R-PAY-061):
 * the candidate at the cursor, its own hold, within that hold's ceiling and, for a
 * fresh capture, at exactly the planned price.
 */
function checkWinner(journal: Journal, event: SettlementEvent & { winner: JournalWinner }): void {
  const cand = currentCandidate(journal, event);
  const refuse = (why: string): never => {
    throw new IllegalTransition(journal.state, event.type, why);
  };
  const w = event.winner;
  if (w.bidderId !== cand.bidderId) refuse('winner is not the candidate at the cursor');
  const hold = journal.holds[w.bidderId];
  if (hold === undefined || hold.holdId !== w.holdId) refuse('winner hold does not match');
  if (!Number.isSafeInteger(w.amountCents) || w.amountCents <= 0) refuse('bad winner amount');
  if (w.amountCents > (hold?.ceilingCents ?? 0)) refuse('winner amount above the hold ceiling');
  if (event.type === 'capture_ok' && w.amountCents !== cand.priceCents) {
    refuse('captured amount differs from the planned price');
  }
}

/** Applies one event. Throws IllegalTransition for any pair outside SPEC 6.1. */
export function step(journal: Journal, event: SettlementEvent): StepResult {
  const from = journal.state;
  const to = nextState(from, event.type);
  if (to === null) throw new IllegalTransition(from, event.type);

  const next = structuredClone(journal);
  const effects: SettlementEffect[] = [];

  switch (event.type) {
    case 'begin':
      effects.push(captureEffect(next, next.cursor, from, event.type));
      break;
    case 'capture_ok':
    case 'adopted':
      checkWinner(journal, event);
      next.winner = { ...event.winner };
      next.intent = null;
      next.unknownSince = null;
      break;
    case 'definite_fail':
      if (event.failure.bidderId !== currentCandidate(journal, event).bidderId) {
        throw new IllegalTransition(
          from,
          event.type,
          'failure is not for the candidate at the cursor',
        );
      }
      next.failed.push({ ...event.failure });
      next.intent = null;
      next.unknownSince = null;
      break;
    case 'next_candidate':
      next.cursor += 1;
      effects.push(captureEffect(next, next.cursor, from, event.type));
      break;
    case 'invariant':
    case 'unknown_deadline':
    case 'mismatch':
    case 'void_budget_exhausted':
      effects.push({ op: 'flag_review', reason: event.type });
      break;
    default:
      break;
  }

  if (to === 'VOIDING') effects.push({ op: 'void_holds', holdIds: voidTargets(next) });

  const entry: JournalHistoryEntry = {
    seq: next.history.length + 1,
    tsMs: event.tsMs,
    from,
    to,
    label: event.label ?? `journaled:${event.type}`,
  };
  next.history.push(entry);
  next.state = to;
  next.version = journal.version + 1;
  return { journal: next, effects };
}
