import { amount, errorName, field, str } from './gateUtil.js';
import type { GateContext, Json } from './runner.js';
import type { Decision } from './summarize.js';

/**
 * Timed part of gate G3 (SPEC R-PAY-145, T-PAY-092): the checks that run 3.5, 4 and 5 days
 * after the three authorizations were created. The scheduling and the decision are pure
 * functions, so they are tested without any clock or network.
 */

export const DAY_MS = 86_400_000;

export const CHECKPOINTS = [
  { id: 'd3.5', afterMs: 3.5 * DAY_MS },
  { id: 'd4', afterMs: 4 * DAY_MS },
  { id: 'd5', afterMs: 5 * DAY_MS },
] as const;

export type CheckpointId = (typeof CHECKPOINTS)[number]['id'];

/** Written by the day 0 run; the timed runs read it back from the run file. */
export interface DayZeroState {
  createdMs: number;
  /** Authorization id per checkpoint. */
  auths: Record<CheckpointId, string>;
}

/** Checkpoints whose time has come and that have no result yet, in order. */
export function dueCheckpoints(
  createdMs: number,
  nowMs: number,
  done: readonly string[],
): CheckpointId[] {
  return CHECKPOINTS.filter((c) => nowMs - createdMs >= c.afterMs && !done.includes(c.id)).map(
    (c) => c.id,
  );
}

/** Time of the next checkpoint that is not done, or undefined when all are done. */
export function nextDueMs(createdMs: number, done: readonly string[]): number | undefined {
  const next = CHECKPOINTS.find((c) => !done.includes(c.id));
  return next === undefined ? undefined : createdMs + next.afterMs;
}

export interface CheckpointResult {
  id: CheckpointId;
  statusBefore: string;
  captureHttp: number;
  captureName: string;
  reauthHttp: number;
  reauthName: string;
  statusAfter: string;
}

export interface ImmediateProbe {
  http: number;
  name: string;
}

export interface G3Verdict {
  decision: Decision;
  /** The rule for R-PAY-034 and R-PAY-070, in plain words. */
  rule: string;
  fallback: string;
  flippedTags: string[];
}

function ok(status: number): boolean {
  return status >= 200 && status < 300;
}

/** Decision of SPEC 7.3 for G3. */
export function decideG3(results: readonly CheckpointResult[]): G3Verdict {
  const flippedTags = ['R-PAY-034', 'R-PAY-070', 'R-PAY-071'];
  const failed = results.filter((r) => !ok(r.captureHttp));
  if (failed.length === 0) {
    return {
      decision: 'PASS',
      rule: 'capture still succeeds at 3.5, 4 and 5 days: no reauthorization, keep the stale flag',
      fallback: '',
      flippedTags,
    };
  }
  const failedIds = failed.map((r) => r.id).join(', ');
  if (failed.some((r) => ok(r.reauthHttp))) {
    return {
      decision: 'PASS-WITH-FALLBACK',
      rule: `capture failed at ${failedIds} but reauthorization worked: enable R-PAY-070`,
      fallback: 'enable reauthorization (R-PAY-070)',
      flippedTags,
    };
  }
  return {
    decision: 'FAIL',
    rule: `capture and reauthorization both failed at ${failedIds}: create holds minutes before capture`,
    fallback: 'create holds minutes before capture and document it',
    flippedTags,
  };
}

/** One checkpoint: read, try a 1.00 partial capture, try a reauthorization, read again. */
export async function runCheckpoint(
  ctx: GateContext,
  token: string,
  id: CheckpointId,
  authId: string,
  reauthCents: number,
): Promise<CheckpointResult> {
  const auth = { Authorization: `Bearer ${token}` };
  const run = ctx.runId.replace(/[^A-Za-z0-9]/g, '').slice(-14);
  const step = (name: string): string => `G3.${id} ${name}`;
  const read = async (name: string): Promise<string> => {
    const res = await ctx.http.request(step(name), {
      method: 'GET',
      path: `/v2/payments/authorizations/${authId}`,
      headers: auth,
    });
    return str(field(res.json, 'status'));
  };
  const statusBefore = await read('read before');
  const cap = await ctx.http.request(step('capture 1.00'), {
    method: 'POST',
    path: `/v2/payments/authorizations/${authId}/capture`,
    headers: { ...auth, 'PayPal-Request-Id': `g3-${run}-${id}-capture` },
    body: { amount: amount(100), final_capture: false },
  });
  const re = await ctx.http.request(step('reauthorize'), {
    method: 'POST',
    path: `/v2/payments/authorizations/${authId}/reauthorize`,
    headers: { ...auth, 'PayPal-Request-Id': `g3-${run}-${id}-reauth` },
    body: { amount: amount(reauthCents) },
  });
  const statusAfter = await read('read after');
  const result: CheckpointResult = {
    id,
    statusBefore,
    captureHttp: cap.status,
    captureName: errorName(cap.json),
    reauthHttp: re.status,
    reauthName: errorName(re.json),
    statusAfter,
  };
  ctx.http.note(step('observation'), `capture and reauthorize at ${id}`, {
    capture: result.captureHttp,
    captureName: result.captureName,
    reauthorize: result.reauthHttp,
    reauthName: result.reauthName,
  });
  return result;
}

export function toJson(r: CheckpointResult): Json {
  return { ...r };
}
