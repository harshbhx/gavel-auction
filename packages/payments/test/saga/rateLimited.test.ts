import { describe, expect, it } from 'vitest';
import { assertFakeInvariants } from '../../src/fake/invariants.js';
import { runCapturePhase } from '../../src/saga/capture.js';
import { UNKNOWN_REVIEW_REASON } from '../../src/saga/unknown.js';
import { callsOf, makeRig, seed } from './rig.js';

async function rigWithOneWinner() {
  const rig = makeRig({ b1: 30000, b2: 25000 });
  await seed(
    rig,
    [
      ['b1', 22000],
      ['b2', 21000],
    ],
    { b1: 30000, b2: 25000 },
  );
  return rig;
}

describe('capture rate limited by PayPal (HTTP 429)', () => {
  it('starts no unknown clock and keeps the capture intent', async () => {
    const rig = await rigWithOneWinner();
    rig.core.inject('capture', 'http_429', rig.auth['b1'] ?? '', 1);
    const out = await runCapturePhase(rig.deps, 'auc1');
    expect(out).toMatchObject({ status: 'pending', reason: 'rate_limited' });
    if (out.status === 'pending') {
      expect(out.journal.unknownSince).toBeNull();
      expect(out.journal.intent?.requestId).toBeTruthy();
    }
    expect(callsOf(rig, rig.auth['b2'] ?? '', 'capture')).toBe(0);
    assertFakeInvariants(rig.core);
  });

  it('a 429 then success captures once with the same request id', async () => {
    const rig = await rigWithOneWinner();
    const b1 = rig.auth['b1'] ?? '';
    rig.core.inject('capture', 'http_429', b1, 2);
    const first = await runCapturePhase(rig.deps, 'auc1');
    const requestId = first.status === 'pending' ? first.journal.intent?.requestId : undefined;
    expect((await runCapturePhase(rig.deps, 'auc1')).status).toBe('pending');
    const done = await runCapturePhase(rig.deps, 'auc1');
    expect(done.status).toBe('captured');
    const auth = rig.core.getAuthorization(b1);
    expect(auth.captures).toHaveLength(1);
    expect(auth.captureRequestIds).toEqual([requestId]);
    expect(callsOf(rig, rig.auth['b2'] ?? '', 'capture')).toBe(0);
    assertFakeInvariants(rig.core);
  });

  it('a restart past the unknown deadline recovers instead of going to review', async () => {
    const rig = await rigWithOneWinner();
    const b1 = rig.auth['b1'] ?? '';
    rig.core.inject('capture', 'http_429', b1, 1);
    expect((await runCapturePhase(rig.deps, 'auc1')).status).toBe('pending');
    // The process is down for longer than the unknown deadline (even days).
    rig.clock.advance(2 * 86_400_000);
    const out = await runCapturePhase(rig.deps, 'auc1');
    expect(out.status).toBe('captured');
    expect(rig.core.getAuthorization(b1).captures).toHaveLength(1);
    assertFakeInvariants(rig.core);
  });

  it('a lost answer where the capture happened is adopted, never captured again', async () => {
    const rig = await rigWithOneWinner();
    const b1 = rig.auth['b1'] ?? '';
    rig.core.inject('capture', 'timeout_after_success', b1, 1);
    expect(await runCapturePhase(rig.deps, 'auc1')).toMatchObject({
      status: 'pending',
      reason: 'capture_outcome_unknown',
    });
    rig.clock.advance(2 * 86_400_000);
    rig.core.calls.length = 0;
    expect((await runCapturePhase(rig.deps, 'auc1')).status).toBe('captured');
    expect(rig.core.calls[0]).toMatchObject({ op: 'get', id: b1 });
    expect(rig.core.calls.some((c) => c.op === 'capture')).toBe(false);
    expect(rig.core.getAuthorization(b1).captures).toHaveLength(1);
    assertFakeInvariants(rig.core);
  });

  it('a 429 after an ambiguous timeout keeps the earlier unknown clock', async () => {
    const rig = await rigWithOneWinner();
    const b1 = rig.auth['b1'] ?? '';
    rig.core.inject('capture', 'timeout_before', b1, 1);
    const first = await runCapturePhase(rig.deps, 'auc1');
    const since = first.status === 'pending' ? first.journal.unknownSince : null;
    expect(since).not.toBeNull();
    rig.core.inject('capture', 'http_429', b1, 1);
    const second = await runCapturePhase(rig.deps, 'auc1');
    expect(second.status === 'pending' && second.journal.unknownSince).toBe(since);
  });
});

describe('a definite refusal after a 429 stall is classified like a first refusal', () => {
  const DAY = 86_400_000;

  it('429 then 422 declined: the runner-up is charged, no unknown clock ever starts', async () => {
    const rig = await rigWithOneWinner();
    const b1 = rig.auth['b1'] ?? '';
    rig.core.inject('capture', 'http_429', b1, 1);
    rig.core.inject('capture', 'capture_declined', b1, 1);
    expect(await runCapturePhase(rig.deps, 'auc1')).toMatchObject({
      status: 'pending',
      reason: 'rate_limited',
    });
    const out = await runCapturePhase(rig.deps, 'auc1');
    expect(out.status).toBe('captured');
    if (out.status !== 'captured') return;
    expect(out.journal.unknownSince).toBeNull();
    expect(out.journal.failed).toEqual([{ bidderId: 'b1', reason: 'declined' }]);
    expect(out.journal.winner).toMatchObject({ bidderId: 'b2' });
    expect(rig.core.getAuthorization(b1).captures).toHaveLength(0);
    expect(rig.core.getAuthorization(rig.auth['b2'] ?? '').captures).toHaveLength(1);
    assertFakeInvariants(rig.core);
  });

  it('429 then 422 declined after a long restart gap: rejected right away, not review', async () => {
    const rig = await rigWithOneWinner();
    const b1 = rig.auth['b1'] ?? '';
    rig.core.inject('capture', 'http_429', b1, 1);
    rig.core.inject('capture', 'capture_declined', b1, 1);
    expect((await runCapturePhase(rig.deps, 'auc1')).status).toBe('pending');
    rig.clock.advance(2 * DAY);
    const out = await runCapturePhase(rig.deps, 'auc1');
    expect(out.status).toBe('captured');
    if (out.status !== 'captured') return;
    expect(out.journal.failed).toEqual([{ bidderId: 'b1', reason: 'declined' }]);
    expect(out.journal.winner).toMatchObject({ bidderId: 'b2' });
    assertFakeInvariants(rig.core);
  });

  it('429 then a capture past the honor period (422): falls back to the runner-up', async () => {
    const rig = makeRig({ b1: 30000 }, { afterHonorCapture: 'fail' });
    rig.clock.advance(2 * DAY);
    rig.auth['b2'] = rig.core.createAuthorization('payer-b2', 25000).id;
    await seed(
      rig,
      [
        ['b1', 22000],
        ['b2', 21000],
      ],
      { b1: 30000, b2: 25000 },
    );
    const b1 = rig.auth['b1'] ?? '';
    rig.core.inject('capture', 'http_429', b1, 1);
    expect(await runCapturePhase(rig.deps, 'auc1')).toMatchObject({
      status: 'pending',
      reason: 'rate_limited',
    });
    // The first authorization is now past its honor period; the runner-up's is not.
    rig.clock.advance(DAY + DAY / 2);
    const out = await runCapturePhase(rig.deps, 'auc1');
    expect(out.status).toBe('captured');
    if (out.status !== 'captured') return;
    expect(out.journal.unknownSince).toBeNull();
    expect(out.journal.failed).toEqual([{ bidderId: 'b1', reason: 'honor_period_expired' }]);
    expect(out.journal.winner).toMatchObject({ bidderId: 'b2' });
    expect(rig.core.getAuthorization(b1).captures).toHaveLength(0);
    assertFakeInvariants(rig.core);
  });

  it('a first-attempt honor-period refusal is classified the same way', async () => {
    const rig = makeRig({ b1: 30000 }, { afterHonorCapture: 'fail' });
    rig.clock.advance(4 * DAY);
    rig.auth['b2'] = rig.core.createAuthorization('payer-b2', 25000).id;
    await seed(
      rig,
      [
        ['b1', 22000],
        ['b2', 21000],
      ],
      { b1: 30000, b2: 25000 },
    );
    const out = await runCapturePhase(rig.deps, 'auc1');
    expect(out.status).toBe('captured');
    if (out.status !== 'captured') return;
    expect(out.journal.unknownSince).toBeNull();
    expect(out.journal.failed).toEqual([{ bidderId: 'b1', reason: 'honor_period_expired' }]);
    assertFakeInvariants(rig.core);
  });

  for (const fault of ['http_500', 'timeout_before'] as const) {
    it(`429 then ${fault} still keeps the ten minute unknown deadline`, async () => {
      const rig = await rigWithOneWinner();
      const b1 = rig.auth['b1'] ?? '';
      rig.core.inject('capture', 'http_429', b1, 1);
      rig.core.inject('capture', fault, b1, 1);
      expect(await runCapturePhase(rig.deps, 'auc1')).toMatchObject({ reason: 'rate_limited' });
      const second = await runCapturePhase(rig.deps, 'auc1');
      expect(second).toMatchObject({ status: 'pending', reason: 'capture_outcome_unknown' });
      if (second.status !== 'pending') return;
      expect(second.journal.unknownSince).not.toBeNull();
      expect(callsOf(rig, rig.auth['b2'] ?? '', 'capture')).toBe(0);
      rig.clock.advance(601_000);
      const out = await runCapturePhase(rig.deps, 'auc1');
      expect(out).toMatchObject({ status: 'failed', reason: UNKNOWN_REVIEW_REASON });
      expect(callsOf(rig, rig.auth['b2'] ?? '', 'capture')).toBe(0);
      assertFakeInvariants(rig.core);
    });
  }
});
