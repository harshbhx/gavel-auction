import { t } from '../../copy/t';
import { formatUsdCompact } from '../../util/money';

/** The simulated run on the stage. Money is integer cents and formatted only when shown. */

export type PadPhase = 'idle' | 'placing' | 'held' | 'lead' | 'win' | 'released';
export type StageStep = 0 | 1 | 2 | 3;
export type StageStatus = 'idle' | 'running' | 'done';

export interface Pad {
  readonly no: number;
  readonly name: string;
  readonly via: 'try.via.voice' | 'try.via.qr' | 'try.via.manual';
  readonly phase: PadPhase;
  readonly cents: number | null;
}

export interface StageState {
  readonly status: StageStatus;
  /** Index of the tracker step in progress. At `done` every step is complete. */
  readonly step: StageStep;
  readonly priceCents: number;
  readonly leader: number | null;
  readonly pads: readonly Pad[];
  readonly narration: string;
  readonly clockRunning: boolean;
  readonly hammered: boolean;
  readonly printed: boolean;
  /** Bumped when the price changes so the numerals can animate. */
  readonly bump: number;
}

export const OPENING_CENTS = 4000;
export const WINNING_CENTS = 11000;
export const LOT_NUMBER = 7;

const PADS: readonly Pad[] = [
  { no: 12, name: 'Asha', via: 'try.via.voice', phase: 'idle', cents: null },
  { no: 27, name: 'Ben', via: 'try.via.qr', phase: 'idle', cents: null },
  { no: 31, name: 'Chi', via: 'try.via.manual', phase: 'idle', cents: null },
];

export function initialStage(): StageState {
  return {
    status: 'idle',
    step: 0,
    priceCents: OPENING_CENTS,
    leader: null,
    pads: PADS,
    narration: t('try.say.ready'),
    clockRunning: false,
    hammered: false,
    printed: false,
    bump: 0,
  };
}

function setPad(
  state: StageState,
  index: number,
  phase: PadPhase,
  cents: number | null,
): StageState {
  const pads = state.pads.map((pad, i) =>
    i === index ? { ...pad, phase, cents: cents ?? pad.cents } : pad,
  );
  return { ...state, pads };
}

function demote(state: StageState, index: number): StageState {
  const pad = state.pads[index];
  return pad !== undefined && pad.phase === 'lead' ? setPad(state, index, 'held', null) : state;
}

function price(state: StageState, cents: number, leader: number): StageState {
  return { ...state, priceCents: cents, leader, bump: state.bump + 1 };
}

export interface StageEvent {
  /** Milliseconds after the run starts. Slow on purpose: each step stays on screen to be read. */
  readonly at: number;
  readonly apply: (state: StageState) => StageState;
}

const usd = formatUsdCompact;

/** The timeline. Asha 60, Ben 75, Chi 90, Ben 110, then the hammer. */
export const STAGE_EVENTS: readonly StageEvent[] = [
  {
    at: 0,
    apply: (s) => ({
      ...s,
      status: 'running',
      step: 0,
      narration: t('try.say.s1', { amount: usd(6000) }),
    }),
  },
  { at: 1500, apply: (s) => setPad(s, 0, 'placing', null) },
  {
    at: 3200,
    apply: (s) => ({
      ...price(setPad(s, 0, 'lead', 6000), 6000, 0),
      narration: t('try.say.s1ok', { amount: usd(6000) }),
    }),
  },
  {
    at: 6500,
    apply: (s) => ({
      ...setPad(s, 1, 'placing', null),
      step: 1,
      narration: t('try.say.s2', { amount: usd(7500) }),
    }),
  },
  {
    at: 8200,
    apply: (s) => price(setPad(demote(s, 0), 1, 'lead', 7500), 7500, 1),
  },
  {
    at: 10500,
    apply: (s) => ({
      ...setPad(s, 2, 'placing', null),
      narration: t('try.say.s2b', { amount: usd(9000) }),
    }),
  },
  {
    at: 12200,
    apply: (s) => ({
      ...price(setPad(demote(s, 1), 2, 'lead', 9000), 9000, 2),
      narration: t('try.say.three'),
    }),
  },
  {
    at: 15000,
    apply: (s) => ({
      ...price(setPad(demote(s, 2), 1, 'lead', WINNING_CENTS), WINNING_CENTS, 1),
      narration: t('try.say.raise', { amount: usd(WINNING_CENTS) }),
    }),
  },
  {
    at: 18500,
    apply: (s) => ({ ...s, step: 2, clockRunning: true, narration: t('try.say.s3') }),
  },
  {
    at: 22500,
    apply: (s) => ({
      ...setPad(setPad(setPad(s, 1, 'win', null), 0, 'released', null), 2, 'released', null),
      step: 3,
      clockRunning: false,
      hammered: true,
      narration: t('try.say.sold', { no: 27, amount: usd(WINNING_CENTS) }),
    }),
  },
  { at: 24000, apply: (s) => ({ ...s, printed: true }) },
  {
    at: 27500,
    apply: (s) => ({ ...s, status: 'done', narration: t('try.say.done') }),
  },
];

/** The state after the whole run, for reduced motion and for a replay that skips the waiting. */
export function finalStage(): StageState {
  return STAGE_EVENTS.reduce<StageState>((state, event) => event.apply(state), initialStage());
}

/** Total run time in ms, so the tracker can say how long a step lasts. */
export const RUN_MS = STAGE_EVENTS[STAGE_EVENTS.length - 1]?.at ?? 0;
