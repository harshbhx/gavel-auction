/**
 * Test hook for crash and resume runs: the environment variable GAVEL_CHECKPOINT_KILL names a
 * point of the settlement run at which the process kills itself. The points map onto the
 * settlement crash boundaries the service already reports, so no extra code runs on the
 * normal path. The hook is refused in production.
 */

import { isProductionLike } from '../config';

export const CHECKPOINT_ENV = 'GAVEL_CHECKPOINT_KILL';

export type CheckpointKillSpec =
  | 'after_winner_selected'
  | 'before_capture_request'
  | 'after_capture_request_before_response'
  | 'after_capture_recorded'
  | `during_void_loop:${number}`
  | 'before_final_ledger';

/** Crash boundary label that fires each named checkpoint. */
const LABELS = {
  after_winner_selected: 'journaled:hammer',
  before_capture_request: 'before:capture',
  after_capture_request_before_response: 'after:capture',
  after_capture_recorded: 'journaled:capture_ok',
  before_final_ledger: 'journaled:all_released',
} as const;

const VOID_LABEL = 'after:void';
const VOID_LOOP = /^during_void_loop:([1-9]\d{0,2})$/;

/** The checkpoint named by a variable value, or null when it is empty or not a known name. */
export function parseCheckpoint(raw: string | undefined): CheckpointKillSpec | null {
  if (raw === undefined || raw === '') return null;
  if (Object.prototype.hasOwnProperty.call(LABELS, raw)) return raw as CheckpointKillSpec;
  return VOID_LOOP.test(raw) ? (raw as CheckpointKillSpec) : null;
}

/**
 * A crash-boundary callback that calls `kill` once, the first time the named checkpoint is
 * reached. `during_void_loop:N` fires after the N-th void of the run (counted from 1).
 */
export function checkpointBoundary(
  spec: CheckpointKillSpec,
  kill: () => Promise<void> | void,
): (label: string) => Promise<void> {
  const loop = VOID_LOOP.exec(spec);
  const wantedVoids = loop === null ? 0 : Number(loop[1]);
  const label = loop === null ? LABELS[spec as keyof typeof LABELS] : VOID_LABEL;
  let voids = 0;
  let fired = false;
  return async (seen) => {
    if (fired || seen !== label) return;
    if (wantedVoids > 0 && (voids += 1) < wantedVoids) return;
    fired = true;
    await kill();
  };
}

/**
 * The boundary callback for this process, or undefined when the variable is unset. A bad value
 * or a production-like environment throws, so a misspelled checkpoint never runs unarmed.
 */
export function boundaryFromEnv(
  env: Readonly<Record<string, string | undefined>>,
  kill: () => Promise<void> | void,
  config?: { NODE_ENV: string; PUBLIC_URL: string },
): ((label: string) => Promise<void>) | undefined {
  const raw = env[CHECKPOINT_ENV];
  if (raw === undefined || raw === '') return undefined;
  // The parsed config also treats a public https host as production when NODE_ENV is unset.
  const probe = config ?? { NODE_ENV: env['NODE_ENV'] ?? '', PUBLIC_URL: env['PUBLIC_URL'] ?? '' };
  if (isProductionLike(probe)) {
    throw new Error(`${CHECKPOINT_ENV} is not allowed in production or on a public host`);
  }
  const spec = parseCheckpoint(raw);
  if (spec === null) throw new Error(`${CHECKPOINT_ENV} names an unknown checkpoint`);
  return checkpointBoundary(spec, kill);
}

/** SIGKILL this process; the returned promise never settles. */
export function killSelf(): Promise<void> {
  process.kill(process.pid, 'SIGKILL');
  return new Promise<void>(() => undefined);
}
