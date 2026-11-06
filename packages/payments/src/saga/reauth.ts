import { PayPalError } from '../errors.js';
import { auditedCall } from '../holds/audited.js';
import type { AuditSink, Clock, HoldStore, JournalStore, PaymentsGateway } from '../ports.js';
import { buildRequestId } from '../requestId.js';
import type { HoldTruth, JournalHold } from '../types.js';
import { sharedHoldQueue } from '../webhooks/merge.js';
import { withLease } from './create.js';
import { defaultLeaseOwner, runLeaseOwner } from './owner.js';
import { truthArgs } from './truth.js';

/**
 * Reauthorization policy and call path (SPEC 3.6, R-PAY-070 to R-PAY-072).
 *
 * EXPLICIT CALL ONLY. Nothing in the capture, void, create or hold phases calls this
 * module: the settlement saga never reauthorizes by itself, whatever `enabled` says
 * (R8-P08). `enabled` only gates `reauthorizeIfDue`, which an operator or a script calls
 * for a hold on request. A hold older than the honor period is flagged `stale`
 * (R-PAY-034) and captured as it is; a multi-day auction therefore needs the explicit
 * call before the capture, or PayPal may decline the capture and the saga falls back to
 * the next candidate.
 *
 * Off by default: the demo creates holds minutes before the capture, so the stale flag
 * (R-PAY-034) is the only control and nothing here runs. When `enabled` is set, a call
 * for a hold whose age is above `honorSafeMs` reauthorizes it once per generation, never
 * above its original ceiling. The result only says what happened; it never blocks a capture. A
 * stale, reauthorized or refused hold goes through the same capture path as a fresh one,
 * and a refusal is left to the normal definite-failure handling (R-PAY-072, R-PAY-053).
 *
 * UNVERIFIED (G3): the honor period, the day 4 to 29 reauthorize window and the 115% /
 * $75 limit. Fallback: keep `enabled` false; the explicit call is only made on request.
 */

const DAY_MS = 86_400_000;

/** Three days minus six hours: reauthorize before PayPal's honor period can run out. */
export const DEFAULT_HONOR_SAFE_MS = 3 * DAY_MS - 6 * 3_600_000;

export interface ReauthPolicy {
  enabled: boolean;
  honorSafeMs: number;
}

export const DEFAULT_REAUTH_POLICY: ReauthPolicy = {
  enabled: false,
  honorSafeMs: DEFAULT_HONOR_SAFE_MS,
};

/** The part of a journal hold the policy reads. */
export interface ReauthHold {
  holdId: string;
  authId: string;
  /** What the buyer approved; a reauthorization never asks for more. */
  ceilingCents: number;
  /** When the hold was created, or when it was last reauthorized. */
  startedAtMs: number;
  /** Number of reauthorizations already made; the next request id uses this. */
  generation: number;
}

export interface Reauthorized {
  status: 'reauthorized';
  /** R11-O06: the new authorization PayPal holds the funds under; capture and void use it. */
  authId: string;
  /** The authorization that was reauthorized; PayPal no longer holds the funds under it. */
  previousAuthId: string;
  ceilingCents: number;
  startedAtMs: number;
  generation: number;
}

/**
 * A reauthorization PayPal may or may not have made. `requestId` and `amountCents` are what
 * it was sent with: the same request replays it (RT4-saga-05).
 */
export interface ReauthUnknown {
  status: 'unknown';
  kind: string;
  requestId: string;
  amountCents: number;
}

export type ReauthResult =
  | { status: 'disabled' }
  | { status: 'not_due' }
  | Reauthorized
  | { status: 'refused'; kind: string }
  | ReauthUnknown;

export interface ReauthDeps {
  gateway: Pick<PaymentsGateway, 'reauthorize'>;
  audit: AuditSink;
  clock: Clock;
  boundary?: (label: string) => Promise<void> | void;
}

/** True when the policy would reauthorize a hold of this age. */
export function reauthDue(policy: ReauthPolicy, hold: ReauthHold, nowMs: number): boolean {
  return policy.enabled && nowMs - hold.startedAtMs > policy.honorSafeMs;
}

/**
 * Reauthorizes one hold when the policy asks for it. Returns the new authorization id,
 * `startedAtMs` and `generation` for the caller to persist with the hold
 * (`persistReauthorization`). Only a PayPal failure is turned into a result; any other
 * error is a bug and propagates.
 */
export async function reauthorizeIfDue(
  deps: ReauthDeps,
  auctionId: string,
  hold: ReauthHold,
  policy: ReauthPolicy = DEFAULT_REAUTH_POLICY,
): Promise<ReauthResult> {
  if (!policy.enabled) return { status: 'disabled' };
  const nowMs = deps.clock.nowMs();
  if (!reauthDue(policy, hold, nowMs)) return { status: 'not_due' };

  const generation = hold.generation + 1;
  const requestId = buildRequestId({
    auctionId,
    op: 'reauth',
    holdId: hold.holdId,
    amountCents: hold.ceilingCents,
    generation,
  });
  let error: PayPalError | undefined;
  let renewed: { authId: string } | undefined;
  try {
    await deps.boundary?.('before:reauth');
    renewed = await deps.gateway.reauthorize(hold.authId, {
      amountCents: hold.ceilingCents,
      requestId,
    });
    await deps.boundary?.('after:reauth');
  } catch (e) {
    if (!(e instanceof PayPalError)) throw e;
    error = e;
  }
  await deps.audit.append({
    kind: 'paypal_call',
    auctionId,
    holdId: hold.holdId,
    op: 'reauth',
    requestId,
    attempt: 1,
    outcome: error === undefined ? 'definite' : error.outcome,
    status: error === undefined ? 200 : error.status,
    ...(error?.debugId === undefined ? {} : { debugId: error.debugId }),
    label: error === undefined ? 'reauthorized' : error.kind,
    tsMs: deps.clock.nowMs(),
  });
  if (error === undefined && renewed !== undefined) {
    return {
      status: 'reauthorized',
      authId: renewed.authId,
      previousAuthId: hold.authId,
      ceilingCents: hold.ceilingCents,
      startedAtMs: deps.clock.nowMs(),
      generation,
    };
  }
  const sent = { requestId, amountCents: hold.ceilingCents };
  if (error === undefined) return { status: 'unknown', kind: 'server_error', ...sent };
  return error.outcome === 'unknown'
    ? { status: 'unknown', kind: error.kind, ...sent }
    : { status: 'refused', kind: error.kind };
}

export interface ReauthStoreDeps {
  journals: JournalStore;
  /** The hold records; the server keeps the authorization id there too. */
  holds?: HoldStore;
  clock: Clock;
  /** Lease owner prefix; every call adds its own random suffix. */
  owner?: string;
}

/**
 * R-PAY-071, R11-O06: stores what a reauthorization changed. The journal hold (when a
 * settlement exists) and the hold record get the new authorization id, so the capture,
 * the voids and every truth read use the id PayPal holds the funds under; the replaced
 * id moves to `priorAuthIds` for the audit. The journal is saved under the settlement
 * lease, so it cannot interleave with a capture; `busy` means a run holds it, try again.
 * Safe to repeat. Throws when the hold carries neither id of the result: it was changed
 * by something else and must not be overwritten.
 */
export async function persistReauthorization(
  deps: ReauthStoreDeps,
  auctionId: string,
  holdId: string,
  result: Reauthorized,
): Promise<'saved' | 'busy'> {
  const moved = (authId: string | undefined, prior: string[] | undefined): string[] | null =>
    movedAuthIds(holdId, result, authId, prior);
  const leased = await withLease(
    { journals: deps.journals, clock: deps.clock },
    auctionId,
    runLeaseOwner(deps.owner ?? defaultLeaseOwner('reauth')),
    async (renew) => {
      const j = await deps.journals.load(auctionId);
      const entry =
        j === null ? undefined : Object.entries(j.holds).find(([, h]) => h.holdId === holdId);
      if (j !== null && entry !== undefined) {
        const [bidderId, hold] = entry;
        const prior = moved(hold.authId, hold.priorAuthIds);
        if (prior !== null) {
          const next = structuredClone(j);
          next.holds[bidderId] = { ...hold, authId: result.authId, priorAuthIds: prior };
          next.version = j.version + 1;
          await renew();
          await deps.journals.save(next, j.version);
        }
      }
      if (deps.holds !== undefined) await moveHoldRecord(deps.holds, holdId, result);
    },
  );
  return leased.status === 'busy' ? 'busy' : 'saved';
}

/**
 * The `priorAuthIds` a hold on `authId` gets when it moves to the result's authorization, or
 * null when it is on that authorization already. Throws when it is on neither.
 */
function movedAuthIds(
  holdId: string,
  result: Pick<Reauthorized, 'authId' | 'previousAuthId'>,
  authId: string | undefined,
  prior: string[] | undefined,
): string[] | null {
  if (authId === result.authId) return null;
  if (authId !== result.previousAuthId) {
    throw new Error(`hold ${holdId} is not on authorization ${result.previousAuthId}`);
  }
  return [...(prior ?? []), result.previousAuthId];
}

/** Moves the hold record to the result's authorization. Safe to repeat. */
async function moveHoldRecord(
  records: HoldStore,
  holdId: string,
  result: Pick<Reauthorized, 'authId' | 'previousAuthId'>,
): Promise<void> {
  await sharedHoldQueue.run(holdId, async () => {
    const rec = await records.get(holdId);
    if (rec === null) return;
    const prior = movedAuthIds(holdId, result, rec.authId, rec.priorAuthIds);
    if (prior !== null) await records.put({ ...rec, authId: result.authId, priorAuthIds: prior });
  });
}

/** Truth that shows an authorization PayPal still holds or charged: it was not reauthorized (A11). */
const NOT_REPLACED: ReadonlySet<HoldTruth['status']> = new Set([
  'CREATED',
  'PENDING',
  'PARTIALLY_CAPTURED',
  'CAPTURED',
]);

/**
 * PayPal's definite refusals of a replayed reauthorization: no authorization was made under
 * its request id. Anything else keeps the hold in doubt: an unknown outcome, a request that
 * never left (kill switch, OAuth), or a request id PayPal knows with other parameters.
 */
const NO_REAUTH_KINDS: ReadonlySet<string> = new Set([
  'rejected',
  'not_found',
  'already_voided',
  'expired',
  'already_captured',
  'declined',
]);

export interface ReauthLookupDeps extends ReauthStoreDeps {
  gateway: Pick<PaymentsGateway, 'getHoldTruth' | 'reauthorize'>;
  audit: AuditSink;
}

/** A reauthorization that is still in doubt after a lookup, for the operator alert. */
export interface ReauthStillInDoubt {
  bidderId: string;
  holdId: string;
  orderId?: string;
  requestId: string;
}

export type ReauthLookupResult =
  | {
      status: 'done';
      /** Holds moved to the authorization PayPal made for them. */
      recorded: Array<{ bidderId: string; holdId: string; authId: string }>;
      /** Holds whose lookup PayPal did not answer; looked up again on the next call. */
      open: ReauthStillInDoubt[];
    }
  | { status: 'busy' };

/**
 * RT4-saga-05: settles the reauthorizations a settlement in review saved as in doubt
 * (`JournalHold.reauthInDoubt`). PayPal closes an authorization when it reauthorizes it
 * (A11), so for each such hold:
 *
 *   - the hold's authorization is read; when it is still live or charged, PayPal made no
 *     reauthorization and the hold stays as it is;
 *   - otherwise the reauthorization is sent again with its saved request id. A closed
 *     authorization cannot be reauthorized again, so this only replays the authorization
 *     PayPal made for that request: the hold moves to it in the journal and the hold
 *     record, the old id goes to `priorAuthIds`, and from then on the review keeps and
 *     releases it like any other hold. PayPal refusing the request means no
 *     authorization was made under that request id.
 *
 * Nothing is voided here. A read or a replay PayPal does not answer leaves the hold in
 * doubt (`open`), and the void phase does not release a hold in doubt. Under the
 * settlement lease; `busy` when a run holds it. Safe to repeat.
 */
export async function lookupUnknownReauths(
  deps: ReauthLookupDeps,
  auctionId: string,
): Promise<ReauthLookupResult> {
  const recorded: Array<{ bidderId: string; holdId: string; authId: string }> = [];
  const open: ReauthStillInDoubt[] = [];
  const moves: Array<{ holdId: string; authId: string; previousAuthId: string }> = [];
  const leased = await withLease(
    { journals: deps.journals, clock: deps.clock },
    auctionId,
    runLeaseOwner(deps.owner ?? defaultLeaseOwner('reauth')),
    async (renew) => {
      const j = await deps.journals.load(auctionId);
      if (j === null) return;
      const next = structuredClone(j);
      let changed = false;
      for (const bidderId of Object.keys(j.holds).sort()) {
        const hold = j.holds[bidderId];
        const doubt = hold?.reauthInDoubt;
        if (hold === undefined || doubt === undefined) continue;
        const stillOpen: ReauthStillInDoubt = {
          bidderId,
          holdId: hold.holdId,
          ...(hold.orderId === undefined ? {} : { orderId: hold.orderId }),
          requestId: doubt.requestId,
        };
        const found = await replayedAuthorization(deps, auctionId, hold, doubt);
        if (found.kind === 'unknown') {
          open.push(stillOpen);
          continue;
        }
        const settled: JournalHold = { ...hold };
        delete settled.reauthInDoubt;
        if (found.kind === 'made') {
          settled.authId = found.authId;
          settled.priorAuthIds = [...(hold.priorAuthIds ?? []), hold.authId];
          recorded.push({ bidderId, holdId: hold.holdId, authId: found.authId });
          moves.push({ holdId: hold.holdId, authId: found.authId, previousAuthId: hold.authId });
        }
        next.holds[bidderId] = settled;
        changed = true;
      }
      if (!changed) return;
      next.version = j.version + 1;
      await renew();
      await deps.journals.save(next, j.version);
      const records = deps.holds;
      if (records === undefined) return;
      for (const m of moves) await moveHoldRecord(records, m.holdId, m);
    },
  );
  return leased.status === 'busy' ? { status: 'busy' } : { status: 'done', recorded, open };
}

/** What PayPal says about a reauthorization in doubt. */
type Replayed = { kind: 'made'; authId: string } | { kind: 'none' } | { kind: 'unknown' };

/**
 * The authorization PayPal made for a reauthorization in doubt (`made`), `none` when PayPal
 * made none, or `unknown` when PayPal did not answer.
 */
async function replayedAuthorization(
  deps: ReauthLookupDeps,
  auctionId: string,
  hold: JournalHold,
  doubt: { requestId: string; amountCents: number },
): Promise<Replayed> {
  let truth: HoldTruth;
  try {
    truth = await deps.gateway.getHoldTruth(truthArgs(hold));
  } catch (e) {
    if (e instanceof PayPalError) return { kind: 'unknown' };
    throw e;
  }
  if (NOT_REPLACED.has(truth.status)) return { kind: 'none' };
  try {
    const renewed = await auditedCall(
      { audit: deps.audit, clock: deps.clock },
      { auctionId, holdId: hold.holdId, op: 'reauth', requestId: doubt.requestId },
      () =>
        deps.gateway.reauthorize(hold.authId, {
          amountCents: doubt.amountCents,
          requestId: doubt.requestId,
        }),
    );
    return renewed.authId === hold.authId
      ? { kind: 'none' }
      : { kind: 'made', authId: renewed.authId };
  } catch (e) {
    if (!(e instanceof PayPalError)) throw e;
    return NO_REAUTH_KINDS.has(e.kind) ? { kind: 'none' } : { kind: 'unknown' };
  }
}
