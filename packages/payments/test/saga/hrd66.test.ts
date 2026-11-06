import { describe, expect, it } from 'vitest';
import { classifyError } from '../../src/errorMap.js';
import { PayPalError } from '../../src/errors.js';
import { DAY_MS } from '../../src/fake/core.js';
import { assertFakeInvariants } from '../../src/fake/invariants.js';
import type { AuditSink } from '../../src/ports.js';
import { voidAllLiveHolds } from '../../src/saga/killswitch.js';
import { step } from '../../src/saga/machine.js';
import {
  DEFAULT_HONOR_SAFE_MS,
  lookupUnknownReauths,
  reauthorizeIfDue,
  type ReauthHold,
  type ReauthUnknown,
} from '../../src/saga/reauth.js';
import { runSettlement, runVoidPhase } from '../../src/saga/void.js';
import type { Journal, PaymentAudit } from '../../src/types.js';
import { CEILINGS, START_MS, callsOf, makeRig, seed, withGateway, type Rig } from './rig.js';

const AUCTION = 'auc1';

class Crash extends Error {
  constructor(where: string) {
    super(`crash at ${where}`);
    this.name = 'Crash';
  }
}

async function journalOf(rig: Rig): Promise<Journal> {
  const j = await rig.journals.load(AUCTION);
  if (j === null) throw new Error('no journal');
  return j;
}

function rows(rig: Rig): PaymentAudit[] {
  return rig.audits.filter((a) => a.kind === 'state_change');
}

/** The rows as the history says they must be, in order. */
function expectedRows(j: Journal): unknown[][] {
  return j.history.map((h) => [h.seq, h.from, h.to, h.label]);
}

function rowTuples(rig: Rig): unknown[][] {
  return rows(rig).map((r) => [r.seq, r.from, r.to, r.label]);
}

/**
 * The rig's sink, except that the process dies once when the row of the transition into `to`
 * is appended: the transition is saved, its row is not.
 */
function diesBeforeRow(rig: Rig, to: string): AuditSink {
  let armed = true;
  return {
    append: async (e) => {
      if (armed && e.kind === 'state_change' && e.to === to) {
        armed = false;
        throw new Crash(`row of ${to}`);
      }
      rig.audits.push(e);
    },
  };
}

describe('RT4-saga-04 a crash between a transition and its state_change row', () => {
  it('capture phase: the next run writes the lost CAPTURED row, once and in order', async () => {
    const rig = makeRig(CEILINGS);
    await seed(rig);
    await expect(
      runSettlement({ ...rig.deps, audit: diesBeforeRow(rig, 'CAPTURED') }, AUCTION),
    ).rejects.toThrow(Crash);
    expect((await journalOf(rig)).state).toBe('CAPTURED');
    expect(rows(rig).map((r) => r.to)).not.toContain('CAPTURED');

    const out = await runSettlement(rig.deps, AUCTION);
    expect(out.status).toBe('settled');
    const j = await journalOf(rig);
    expect(rowTuples(rig)).toEqual(expectedRows(j));
    expect(j.auditedSeq).toBe(j.history.length);
    if (out.status === 'settled') expect(out.journal).toEqual(j);
    assertFakeInvariants(rig.core);
  });

  it('void phase: the next run writes the lost SETTLED row', async () => {
    const rig = makeRig(CEILINGS);
    await seed(rig);
    await expect(
      runSettlement({ ...rig.deps, audit: diesBeforeRow(rig, 'SETTLED') }, AUCTION),
    ).rejects.toThrow(Crash);
    expect((await journalOf(rig)).state).toBe('SETTLED');

    await runSettlement(rig.deps, AUCTION);
    const j = await journalOf(rig);
    expect(rowTuples(rig)).toEqual(expectedRows(j));
    expect(j.auditedSeq).toBe(j.history.length);
  });

  it('a crash after the row writes the same row again with the same seq', async () => {
    const rig = makeRig(CEILINGS);
    await seed(rig);
    let armed = true;
    const boundary = (label: string): void => {
      if (armed && label === 'journaled:capture_ok') {
        armed = false;
        throw new Crash(label);
      }
    };
    await expect(runSettlement({ ...rig.deps, boundary }, AUCTION)).rejects.toThrow(Crash);
    await runSettlement(rig.deps, AUCTION);
    const j = await journalOf(rig);
    const captured = rows(rig).filter((r) => r.to === 'CAPTURED');
    expect(captured).toHaveLength(2);
    expect(captured[1]).toEqual(captured[0]);
    // Keyed on auction and seq, as the server's sink keeps them, the trail is the history.
    const keyed = new Map(rows(rig).map((r) => [`${r.auctionId}#${r.seq}`, r]));
    expect([...keyed.values()].map((r) => [r.seq, r.from, r.to, r.label])).toEqual(expectedRows(j));
  });

  it('runs after the settlement write no row and save nothing', async () => {
    const rig = makeRig(CEILINGS);
    await seed(rig);
    await runSettlement(rig.deps, AUCTION);
    const before = await journalOf(rig);
    const count = rows(rig).length;
    expect(count).toBe(before.history.length);
    await runSettlement(rig.deps, AUCTION);
    await runSettlement(rig.deps, AUCTION);
    expect(rows(rig)).toHaveLength(count);
    expect((await journalOf(rig)).version).toBe(before.version);
  });

  it('a journal saved before auditedSeq existed is not written again', async () => {
    const rig = makeRig(CEILINGS);
    await seed(rig);
    await expect(
      runSettlement({ ...rig.deps, audit: diesBeforeRow(rig, 'SETTLED') }, AUCTION),
    ).rejects.toThrow(Crash);
    const saved = await journalOf(rig);
    const legacy = structuredClone(saved);
    delete legacy.auditedSeq;
    legacy.version = saved.version + 1;
    await rig.journals.save(legacy, saved.version);
    const count = rows(rig).length;
    await runSettlement(rig.deps, AUCTION);
    expect(rows(rig)).toHaveLength(count);
  });
});

const ON = { enabled: true, honorSafeMs: DEFAULT_HONOR_SAFE_MS };

function oldAuth(rig: Rig): string {
  return rig.auth['b1'] ?? '';
}

function b1(rig: Rig): ReauthHold {
  return {
    holdId: 'hold-b1',
    authId: oldAuth(rig),
    ceilingCents: CEILINGS.b1,
    startedAtMs: START_MS,
    generation: 0,
  };
}

/** b1's reauthorization past PayPal's honor period, with its answer lost. */
async function unknownReauth(rig: Rig): Promise<ReauthUnknown> {
  rig.clock.advance(3 * DAY_MS + 3_600_000);
  const out = await reauthorizeIfDue(rig.deps, AUCTION, b1(rig), ON);
  if (out.status !== 'unknown') throw new Error(`expected unknown, got ${out.status}`);
  return out;
}

/** Sends the settlement to review from the capture phase, b1's reauthorization in doubt. */
async function reviewWithDoubt(rig: Rig, out: ReauthUnknown): Promise<void> {
  let j = await journalOf(rig);
  for (const type of ['start_auction', 'hammer', 'invariant'] as const) {
    const next = step(j, { type, tsMs: rig.clock.nowMs() }).journal;
    const hold = next.holds['b1'];
    if (type === 'invariant' && hold !== undefined) {
      next.holds['b1'] = {
        ...hold,
        reauthInDoubt: { requestId: out.requestId, amountCents: out.amountCents },
      };
    }
    await rig.journals.save(next, j.version);
    j = next;
  }
}

function reauthCalls(rig: Rig): number {
  return rig.core.calls.filter((c) => c.op === 'reauthorize').length;
}

describe('RT4-saga-05 a review after a reauthorization that stayed unknown', () => {
  it('records the authorization PayPal made and releases it like a known hold', async () => {
    const rig = makeRig(CEILINGS);
    await seed(rig);
    rig.core.inject('reauthorize', 'timeout_after_success', oldAuth(rig), 1);
    const out = await unknownReauth(rig);
    expect(out.amountCents).toBe(CEILINGS.b1);
    await reviewWithDoubt(rig, out);
    const [, made] = rig.core.reauthorizationChain(oldAuth(rig));
    if (made === undefined) throw new Error('PayPal made no reauthorization');

    // The operator releases the review: b1's old authorization reads closed, but its funds are
    // held under `made`, so nothing is recorded for b1 yet.
    const release = { ...rig.deps, releaseAllReviewHolds: true };
    const first = await runVoidPhase(release, AUCTION);
    expect(first.status).toBe('failed');
    let j = await journalOf(rig);
    expect(j.voids['b1']).toBeUndefined();
    expect(rig.core.getAuthorization(made).status).toBe('CREATED');
    expect(j.voids['b2']).toBe('voided');

    const found = await lookupUnknownReauths(rig.deps, AUCTION);
    expect(found).toEqual({
      status: 'done',
      recorded: [{ bidderId: 'b1', holdId: 'hold-b1', authId: made }],
      open: [],
    });
    j = await journalOf(rig);
    expect(j.holds['b1']).toMatchObject({ authId: made, priorAuthIds: [oldAuth(rig)] });
    expect(j.holds['b1']?.reauthInDoubt).toBeUndefined();
    const replay = rig.audits.filter((a) => a.kind === 'paypal_call' && a.op === 'reauth');
    expect(replay.at(-1)).toMatchObject({ requestId: out.requestId, label: 'ok' });

    await runVoidPhase(release, AUCTION);
    j = await journalOf(rig);
    expect(rig.core.getAuthorization(made).status).toBe('VOIDED');
    expect(j.voids['b1']).toBe('voided');
    expect(rig.core.calls.filter((c) => c.op === 'capture')).toEqual([]);
    assertFakeInvariants(rig.core);
  });

  it('keeps the hold on its authorization when PayPal made no reauthorization', async () => {
    const rig = makeRig(CEILINGS);
    await seed(rig);
    rig.core.inject('reauthorize', 'timeout_before', oldAuth(rig), 1);
    const out = await unknownReauth(rig);
    await reviewWithDoubt(rig, out);
    expect(rig.core.getAuthorization(oldAuth(rig)).status).toBe('CREATED');

    const found = await lookupUnknownReauths(rig.deps, AUCTION);
    expect(found).toEqual({ status: 'done', recorded: [], open: [] });
    const j = await journalOf(rig);
    expect(j.holds['b1']?.authId).toBe(oldAuth(rig));
    expect(j.holds['b1']?.reauthInDoubt).toBeUndefined();
    // A live authorization is never sent to PayPal again: that would reauthorize it now.
    expect(reauthCalls(rig)).toBe(1);

    await runVoidPhase({ ...rig.deps, releaseAllReviewHolds: true }, AUCTION);
    expect(rig.core.getAuthorization(oldAuth(rig)).status).toBe('VOIDED');
    assertFakeInvariants(rig.core);
  });

  it('a lookup PayPal does not answer keeps the hold in doubt and names order and request', async () => {
    const rig = makeRig(CEILINGS);
    await seed(rig);
    rig.core.inject('reauthorize', 'timeout_after_success', oldAuth(rig), 2);
    const out = await unknownReauth(rig);
    await reviewWithDoubt(rig, out);
    const before = await journalOf(rig);

    const found = await lookupUnknownReauths(rig.deps, AUCTION);
    expect(found).toEqual({
      status: 'done',
      recorded: [],
      open: [{ bidderId: 'b1', holdId: 'hold-b1', orderId: 'order-b1', requestId: out.requestId }],
    });
    expect(await journalOf(rig)).toEqual(before);
    const [, made] = rig.core.reauthorizationChain(oldAuth(rig));
    expect(made === undefined ? undefined : rig.core.getAuthorization(made).status).toBe('CREATED');
  });

  it('a replay the kill switch stops is not taken as PayPal making no authorization', async () => {
    const rig = makeRig(CEILINGS);
    await seed(rig);
    rig.core.inject('reauthorize', 'timeout_after_success', oldAuth(rig), 1);
    const out = await unknownReauth(rig);
    await reviewWithDoubt(rig, out);
    const engaged = withGateway(rig, {
      reauthorize: async () => {
        throw new PayPalError({
          kind: 'kill_switch_engaged',
          status: 0,
          name: 'KILL_SWITCH_ENGAGED',
          message: 'payments kill switch is engaged',
          outcome: 'definite',
        });
      },
    });
    const found = await lookupUnknownReauths(engaged, AUCTION);
    expect(found).toMatchObject({ status: 'done', recorded: [], open: [{ holdId: 'hold-b1' }] });
    expect((await journalOf(rig)).holds['b1']?.reauthInDoubt?.requestId).toBe(out.requestId);
  });

  // HTTP 409 (the same request still in progress) and 408 are `rejected` with an unknown
  // outcome: PayPal did not say whether it made the authorization.
  it.each([409, 408])(
    'a replay answered HTTP %i keeps the hold in doubt and the lot in review',
    async (status) => {
      const rig = makeRig(CEILINGS);
      await seed(rig);
      rig.core.inject('reauthorize', 'timeout_after_success', oldAuth(rig), 1);
      const out = await unknownReauth(rig);
      await reviewWithDoubt(rig, out);
      const [, made] = rig.core.reauthorizationChain(oldAuth(rig));
      if (made === undefined) throw new Error('PayPal made no reauthorization');
      const answer = classifyError(status, undefined, '');
      expect(answer).toMatchObject({ kind: 'rejected', outcome: 'unknown' });
      const unanswered = withGateway(rig, {
        reauthorize: async () => {
          throw answer;
        },
      });
      const before = await journalOf(rig);

      const found = await lookupUnknownReauths(unanswered, AUCTION);
      expect(found).toEqual({
        status: 'done',
        recorded: [],
        open: [
          { bidderId: 'b1', holdId: 'hold-b1', orderId: 'order-b1', requestId: out.requestId },
        ],
      });
      expect(await journalOf(rig)).toEqual(before);
      const replay = rig.audits.filter((a) => a.kind === 'paypal_call' && a.op === 'reauth');
      expect(replay.at(-1)).toMatchObject({
        requestId: out.requestId,
        outcome: 'unknown',
        status,
        label: 'rejected',
      });

      // The review release reads the old authorization closed, but records nothing for b1
      // and leaves the new authorization alone.
      const release = await runVoidPhase({ ...rig.deps, releaseAllReviewHolds: true }, AUCTION);
      expect(release.status).toBe('failed');
      let j = await journalOf(rig);
      expect(j.state).toBe('FAILED_NEEDS_REVIEW');
      expect(j.voids['b1']).toBeUndefined();
      expect(j.holds['b1']).toMatchObject({
        authId: oldAuth(rig),
        reauthInDoubt: { requestId: out.requestId },
      });
      expect(rig.core.getAuthorization(made).status).toBe('CREATED');
      expect(callsOf(rig, oldAuth(rig), 'void') + callsOf(rig, made, 'void')).toBe(0);

      // Once PayPal answers, the hold moves to the new authorization and the release frees it.
      expect(await lookupUnknownReauths(rig.deps, AUCTION)).toMatchObject({
        recorded: [{ bidderId: 'b1', authId: made }],
      });
      await runVoidPhase({ ...rig.deps, releaseAllReviewHolds: true }, AUCTION);
      j = await journalOf(rig);
      expect(j.voids['b1']).toBe('voided');
      expect(rig.core.getAuthorization(made).status).toBe('VOIDED');
      assertFakeInvariants(rig.core);
    },
  );

  it('void all leaves a hold in doubt to the lookup, so its new authorization is released', async () => {
    const rig = makeRig(CEILINGS);
    await seed(rig);
    rig.core.inject('reauthorize', 'timeout_after_success', oldAuth(rig), 1);
    const out = await unknownReauth(rig);
    await reviewWithDoubt(rig, out);
    const [, made] = rig.core.reauthorizationChain(oldAuth(rig));
    if (made === undefined) throw new Error('PayPal made no reauthorization');

    // The operator voids every hold while the lookup is still unanswered: b1's old
    // authorization reads closed, so voiding it would release nothing.
    const all = await voidAllLiveHolds(rig.deps, AUCTION, 'ops');
    expect(all).toMatchObject({
      status: 'done',
      holds: { b1: 'pending', b2: 'voided', b3: 'voided' },
    });
    let j = await journalOf(rig);
    expect(j.voids['b1']).toBeUndefined();
    expect(j.holds['b1']?.reauthInDoubt?.requestId).toBe(out.requestId);
    expect(callsOf(rig, oldAuth(rig), 'void')).toBe(0);
    expect(rig.core.getAuthorization(made).status).toBe('CREATED');

    // The lookup finds the new authorization; the review release then voids it.
    expect(await lookupUnknownReauths(rig.deps, AUCTION)).toMatchObject({
      recorded: [{ bidderId: 'b1', authId: made }],
    });
    await runVoidPhase({ ...rig.deps, releaseAllReviewHolds: true }, AUCTION);
    j = await journalOf(rig);
    expect(j.holds['b1']?.authId).toBe(made);
    expect(j.voids['b1']).toBe('voided');
    expect(rig.core.getAuthorization(made).status).toBe('VOIDED');
    assertFakeInvariants(rig.core);
  });
});
