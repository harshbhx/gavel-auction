import type { RemainderState, SettlementState } from '../wire';

export interface HoldVerification {
  eventId: string;
  kind: 'webhook' | 'lookup';
  eventType?: string;
  at: number;
}

/** One hold in the settlement ladder. The shared wire protocol carries only the phase, so the per-hold detail comes from the settlement view endpoint. */
export interface HoldView {
  paddle: number;
  name: string;
  ceilingCents: number;
  state: SettlementState;
  capturedCents: number;
  releasedCents: number;
  reason?: string;
  verifiedBy: HoldVerification[];
  /** Last 6 characters only. */
  idSuffix: string;
  /** What the server says happened to the part of the hold beyond the price. Absent when unknown. */
  remainder?: RemainderState;
}

export interface SettlementView {
  lotId: string;
  phase: SettlementState;
  winnerPaddle: number | null;
  /** The price the hammer fell at. When present, the winning lane must be charged exactly this. */
  hammerPriceCents?: number;
  holds: HoldView[];
  /** `unreported` is set when the server sent no invariants: the check result is then unknown, not ok. */
  invariants: { ok: boolean; violations: string[]; unreported?: boolean };
}

export type RungStatus = 'done' | 'current' | 'pending';

export interface Rung {
  state: SettlementState;
  status: RungStatus;
}

export type Verification =
  | { kind: 'webhook'; eventId: string; eventType: string | null; at: number }
  | { kind: 'lookup'; eventId: string; at: number }
  | { kind: 'pending' };

export interface LadderLane {
  paddle: number;
  name: string;
  ceilingCents: number;
  capturedCents: number;
  releasedCents: number;
  /** The state the server reported for this hold. */
  state: SettlementState;
  /** True for the lane the server currently treats as the winner. */
  isWinner: boolean;
  rungs: Rung[];
  /** Set when this lane ends in a branch off the main path. */
  branch: 'fallback' | 'failed' | null;
  reason: string | null;
  verification: Verification;
  /** The word "released" may be shown for this hold only when the server reports it voided or released. */
  canSayReleased: boolean;
  /** Winner lane whose uncaptured remainder the server reports as released. Shown as "Remainder voided". */
  remainderVoided: boolean;
  /** The server's remainder state for this hold, when it sent one. */
  remainder: RemainderState | null;
}

export interface LadderInvariants {
  holdsCents: number;
  capturedCents: number;
  releasedCents: number;
  winningCeilingCents: number | null;
  capturedWithinCeiling: boolean;
  /** Always true until the phase is final; totals only have to balance once everything has settled. */
  totalsMatch: boolean;
  serverOk: boolean;
  /** True when the server sent no invariants; there is no result to show, green or red. */
  unreported: boolean;
  integerCents: boolean;
  /** Any violated invariant. Drives the red "Needs review" banner. */
  violated: boolean;
  serverViolations: string[];
}

export interface LadderEvent {
  eventId: string;
  paddle: number;
  kind: 'webhook' | 'lookup';
  eventType: string | null;
  at: number;
}

export interface LadderModel {
  /** True until the first settlement_update arrives (R-WEB-090). */
  waiting: boolean;
  lotId: string | null;
  phase: SettlementState | null;
  winnerPaddle: number | null;
  lanes: LadderLane[];
  /** Shown while waiting: the WINNER_SELECTED skeleton. */
  skeleton: Rung[];
  invariants: LadderInvariants | null;
  fallback: { reason: string | null; runnerUpPaddle: number | null } | null;
  failed: { reason: string | null } | null;
  /** Webhook and lookup confirmations, one per eventId, oldest first. */
  events: LadderEvent[];
}

const WINNER_PATH: readonly SettlementState[] = [
  'HELD',
  'BIDDING',
  'WINNER_SELECTED',
  'CAPTURING',
  'CAPTURED',
];
const LOSER_PATH: readonly SettlementState[] = ['HELD', 'BIDDING', 'VOIDING', 'SETTLED'];
const WINNER_TRACK_STATES: readonly SettlementState[] = [
  'WINNER_SELECTED',
  'CAPTURING',
  'CAPTURED',
  'FALLBACK_RUNNER_UP',
  'FAILED_NEEDS_REVIEW',
];
export const FINAL_PHASES: readonly SettlementState[] = ['CAPTURED', 'SETTLED'];

function pathRungs(path: readonly SettlementState[], current: SettlementState): Rung[] {
  const at = path.indexOf(current);
  return path.map((state, i) => ({
    state,
    status: i < at ? 'done' : i === at ? 'current' : 'pending',
  }));
}

/** Branch rungs replace the tail of the main path: everything before the branch point is done. */
function branchRungs(
  path: readonly SettlementState[],
  branchPoint: SettlementState,
  branch: SettlementState,
): Rung[] {
  const upTo = path.slice(0, path.indexOf(branchPoint) + 1);
  return [
    ...upTo.map((state) => ({ state, status: 'done' as const })),
    { state: branch, status: 'current' as const },
  ];
}

function lanePath(hold: HoldView): { rungs: Rung[]; branch: LadderLane['branch'] } {
  if (hold.state === 'FALLBACK_RUNNER_UP') {
    return {
      rungs: branchRungs(WINNER_PATH, 'WINNER_SELECTED', 'FALLBACK_RUNNER_UP'),
      branch: 'fallback',
    };
  }
  if (hold.state === 'FAILED_NEEDS_REVIEW') {
    return {
      rungs: branchRungs(WINNER_PATH, 'CAPTURING', 'FAILED_NEEDS_REVIEW'),
      branch: 'failed',
    };
  }
  if (WINNER_TRACK_STATES.includes(hold.state)) {
    return { rungs: pathRungs(WINNER_PATH, hold.state), branch: null };
  }
  return { rungs: pathRungs(LOSER_PATH, hold.state), branch: null };
}

function verificationOf(hold: HoldView): Verification {
  const last = hold.verifiedBy.reduce<HoldView['verifiedBy'][number] | null>(
    (best, v) => (best === null || v.at >= best.at ? v : best),
    null,
  );
  if (last === null) return { kind: 'pending' };
  if (last.kind === 'webhook') {
    return {
      kind: 'webhook',
      eventId: last.eventId,
      eventType: last.eventType ?? null,
      at: last.at,
    };
  }
  return { kind: 'lookup', eventId: last.eventId, at: last.at };
}

function buildLane(hold: HoldView, winnerPaddle: number | null): LadderLane {
  const { rungs, branch } = lanePath(hold);
  const onWinnerTrack = WINNER_TRACK_STATES.includes(hold.state);
  const isWinner = hold.paddle === winnerPaddle && hold.state !== 'FALLBACK_RUNNER_UP';
  return {
    paddle: hold.paddle,
    name: hold.name,
    ceilingCents: hold.ceilingCents,
    capturedCents: hold.capturedCents,
    releasedCents: hold.releasedCents,
    state: hold.state,
    isWinner,
    rungs,
    branch,
    reason: hold.reason ?? null,
    verification: verificationOf(hold),
    canSayReleased: hold.state === 'SETTLED',
    remainder: hold.remainder ?? null,
    remainderVoided:
      onWinnerTrack &&
      hold.state === 'CAPTURED' &&
      hold.releasedCents > 0 &&
      hold.capturedCents + hold.releasedCents === hold.ceilingCents,
  };
}

function sum(values: number[]): number {
  return values.reduce((n, v) => n + v, 0);
}

function buildInvariants(view: SettlementView): LadderInvariants {
  const { holds } = view;
  const holdsCents = sum(holds.map((h) => h.ceilingCents));
  const capturedCents = sum(holds.map((h) => h.capturedCents));
  const releasedCents = sum(holds.map((h) => h.releasedCents));
  const winner = holds.find((h) => h.paddle === view.winnerPaddle);
  const winningCeilingCents = winner === undefined ? null : winner.ceilingCents;
  const integerCents = holds.every(
    (h) =>
      Number.isSafeInteger(h.ceilingCents) &&
      Number.isSafeInteger(h.capturedCents) &&
      Number.isSafeInteger(h.releasedCents),
  );
  const capturedWithinCeiling =
    winningCeilingCents === null
      ? capturedCents === 0
      : view.hammerPriceCents === undefined
        ? capturedCents <= winningCeilingCents
        : // Only the winning price may be charged, never the ceiling (R-WEB-091). Until the capture
          // lands nothing is captured yet, which is not a violation.
          capturedCents === 0 || capturedCents === view.hammerPriceCents;
  const unreported = view.invariants.unreported === true;
  const totalsMatch =
    !FINAL_PHASES.includes(view.phase) || capturedCents + releasedCents === holdsCents;
  return {
    holdsCents,
    capturedCents,
    releasedCents,
    winningCeilingCents,
    capturedWithinCeiling,
    totalsMatch,
    serverOk: view.invariants.ok,
    unreported,
    integerCents,
    // Without a server result and per-hold data the totals cannot be judged either way.
    violated:
      !unreported &&
      (!view.invariants.ok || !integerCents || !capturedWithinCeiling || !totalsMatch),
    serverViolations: [...view.invariants.violations],
  };
}

function buildEvents(holds: HoldView[]): LadderEvent[] {
  const seen = new Map<string, LadderEvent>();
  for (const hold of holds) {
    for (const v of hold.verifiedBy) {
      if (seen.has(v.eventId)) continue;
      seen.set(v.eventId, {
        eventId: v.eventId,
        paddle: hold.paddle,
        kind: v.kind,
        eventType: v.eventType ?? null,
        at: v.at,
      });
    }
  }
  return [...seen.values()].sort((a, b) => a.at - b.at);
}

const SKELETON: readonly Rung[] = pathRungs(WINNER_PATH.slice(0, 3), 'WINNER_SELECTED');

/** Pure derivation of the ladder from the latest settlement view. Never reads hammer (R-WEB-090). */
export function buildLadder(view: SettlementView | null): LadderModel {
  if (view === null) {
    return {
      waiting: true,
      lotId: null,
      phase: null,
      winnerPaddle: null,
      lanes: [],
      skeleton: SKELETON.map((r) => ({ ...r })),
      invariants: null,
      fallback: null,
      failed: null,
      events: [],
    };
  }
  const lanes = view.holds.map((h) => buildLane(h, view.winnerPaddle));
  const fallbackLane = lanes.find((l) => l.branch === 'fallback');
  const failedLane = lanes.find((l) => l.branch === 'failed');
  return {
    waiting: false,
    lotId: view.lotId,
    phase: view.phase,
    winnerPaddle: view.winnerPaddle,
    lanes,
    skeleton: [],
    invariants: buildInvariants(view),
    fallback:
      fallbackLane === undefined
        ? null
        : { reason: fallbackLane.reason, runnerUpPaddle: view.winnerPaddle },
    failed:
      failedLane === undefined && view.phase !== 'FAILED_NEEDS_REVIEW'
        ? null
        : { reason: failedLane?.reason ?? null },
    events: buildEvents(view.holds),
  };
}
