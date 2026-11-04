import { describe, expect, it } from 'vitest';
import { assertFakeInvariants } from '../../src/fake/invariants.js';
import { runCapturePhase } from '../../src/saga/capture.js';
import {
  DEFAULT_UNKNOWN_DEADLINE_MS,
  UNKNOWN_REVIEW_REASON,
  unknownExpired,
  unknownTimeLeftMs,
} from '../../src/saga/unknown.js';
import { runSettlement } from '../../src/saga/void.js';
import { callsOf, makeRig, seed } from './rig.js';

describe('T-PAY-039 persistent unknown outcome stays pending', () => {
  it('never reaches the runner-up, however many times the capture times out', async () => {
    const rig = makeRig({ b1: 30000, b2: 25000, b3: 20000 });
    await seed(rig);
    const b1 = rig.auth['b1'] ?? '';
    // More failures than any retry budget: both timeout kinds, several times each.
    rig.core.inject('capture', 'timeout_before', b1, 4);
    for (let i = 0; i < 4; i += 1) {
      const out = await runCapturePhase(rig.deps, 'auc1');
      expect(out).toMatchObject({ status: 'pending', reason: 'capture_outcome_unknown' });
      if (out.status === 'pending') expect(out.journal.state).toBe('CAPTURING');
      rig.clock.advance(1000);
    }
    rig.core.inject('capture', 'timeout_after_success', b1, 4);
    for (let i = 0; i < 4; i += 1) {
      const out = await runCapturePhase(rig.deps, 'auc1');
      // The first of these applies the capture; the truth check then adopts it.
      if (out.status === 'captured') break;
      expect(out).toMatchObject({ status: 'pending', reason: 'capture_outcome_unknown' });
    }
    for (const b of ['b2', 'b3']) {
      expect(callsOf(rig, rig.auth[b] ?? '', 'capture')).toBe(0);
      expect(rig.core.calls.filter((c) => c.id === rig.auth[b])).toHaveLength(0);
    }
    assertFakeInvariants(rig.core);
  });

  it('keeps the unknown start time across runs', async () => {
    const rig = makeRig({ b1: 30000, b2: 25000 });
    await seed(
      rig,
      [
        ['b1', 22000],
        ['b2', 21000],
      ],
      { b1: 30000, b2: 25000 },
    );
    rig.core.inject('capture', 'timeout_before', rig.auth['b1'] ?? '', 3);
    const first = await runCapturePhase(rig.deps, 'auc1');
    const since = first.status === 'pending' ? first.journal.unknownSince : null;
    expect(since).not.toBeNull();
    rig.clock.advance(60_000);
    const second = await runCapturePhase(rig.deps, 'auc1');
    expect(second.status === 'pending' && second.journal.unknownSince).toBe(since);
  });
});

describe('T-PAY-040 resume reads the truth first', () => {
  it('adopts a capture that was applied while the answer was lost, with one capture', async () => {
    const rig = makeRig({ b1: 30000, b2: 25000, b3: 20000 });
    await seed(rig);
    const b1 = rig.auth['b1'] ?? '';
    rig.core.inject('capture', 'timeout_after_success', b1, 3);
    const first = await runCapturePhase(rig.deps, 'auc1');
    expect(first).toMatchObject({ status: 'pending', reason: 'capture_outcome_unknown' });
    const capturesBefore = rig.core.calls.filter((c) => c.id === b1 && c.op === 'capture').length;

    rig.core.calls.length = 0;
    const second = await runCapturePhase(rig.deps, 'auc1');
    expect(second.status).toBe('captured');
    // The truth was read before anything else, and no second capture was sent.
    expect(rig.core.calls[0]).toMatchObject({ op: 'get', id: b1 });
    expect(rig.core.calls.some((c) => c.op === 'capture')).toBe(false);
    expect(capturesBefore).toBe(1);
    expect(rig.core.getAuthorization(b1).captures).toHaveLength(1);
    assertFakeInvariants(rig.core);
  });

  it('retries a capture that never reached PayPal with the same request id, once', async () => {
    const rig = makeRig({ b1: 30000, b2: 25000, b3: 20000 });
    await seed(rig);
    const b1 = rig.auth['b1'] ?? '';
    rig.core.inject('capture', 'timeout_before', b1, 3);
    const first = await runCapturePhase(rig.deps, 'auc1');
    expect(first.status).toBe('pending');
    const intent = first.status === 'pending' ? first.journal.intent : null;
    expect(intent?.requestId).toBeTruthy();
    await runCapturePhase(rig.deps, 'auc1');
    await runCapturePhase(rig.deps, 'auc1');

    rig.core.calls.length = 0;
    const done = await runCapturePhase(rig.deps, 'auc1');
    expect(done.status).toBe('captured');
    expect(rig.core.calls[0]).toMatchObject({ op: 'get', id: b1 });
    const auth = rig.core.getAuthorization(b1);
    expect(auth.captures).toHaveLength(1);
    expect(auth.captureRequestIds).toEqual([intent?.requestId]);
    expect(callsOf(rig, rig.auth['b2'] ?? '', 'capture')).toBe(0);
    assertFakeInvariants(rig.core);
  });

  it('a settlement that was pending completes through the whole run after the fault clears', async () => {
    const rig = makeRig({ b1: 30000, b2: 25000, b3: 20000 });
    await seed(rig);
    rig.core.inject('capture', 'timeout_after_success', rig.auth['b1'] ?? '', 2);
    expect((await runSettlement(rig.deps, 'auc1')).status).toBe('pending');
    const out = await runSettlement(rig.deps, 'auc1');
    expect(out.status).toBe('settled');
    assertFakeInvariants(rig.core);
  });
});

describe('T-PAY-041 review deadline', () => {
  it('moves to FAILED_NEEDS_REVIEW after 601 s, with no fallback and no voids', async () => {
    const rig = makeRig({ b1: 30000, b2: 25000, b3: 20000 });
    await seed(rig);
    rig.core.inject('capture', 'timeout_before', rig.auth['b1'] ?? '', 10);
    expect((await runCapturePhase(rig.deps, 'auc1')).status).toBe('pending');
    rig.clock.advance(601_000);
    const out = await runCapturePhase(rig.deps, 'auc1');
    expect(out).toMatchObject({ status: 'failed', reason: UNKNOWN_REVIEW_REASON });
    expect(out.status === 'failed' && out.journal.state).toBe('FAILED_NEEDS_REVIEW');
    expect(out.status === 'failed' && out.journal.history.at(-1)?.label).toBe(
      `journaled:${UNKNOWN_REVIEW_REASON}`,
    );
    for (const b of ['b1', 'b2', 'b3']) {
      expect(rig.core.inspect(rig.auth[b] ?? '').voidEffects).toBe(0);
    }
    for (const b of ['b2', 'b3'])
      expect(rig.core.calls.some((c) => c.id === rig.auth[b])).toBe(false);
    // The settlement stays where it is on a later run.
    expect(await runCapturePhase(rig.deps, 'auc1')).toMatchObject({
      status: 'failed',
      reason: UNKNOWN_REVIEW_REASON,
    });
    assertFakeInvariants(rig.core);
  });

  it('a capture that did take effect is still adopted after the deadline', async () => {
    const rig = makeRig({ b1: 30000, b2: 25000 });
    await seed(
      rig,
      [
        ['b1', 22000],
        ['b2', 21000],
      ],
      { b1: 30000, b2: 25000 },
    );
    rig.core.inject('capture', 'timeout_after_success', rig.auth['b1'] ?? '', 1);
    expect((await runCapturePhase(rig.deps, 'auc1')).status).toBe('pending');
    rig.clock.advance(601_000);
    expect((await runCapturePhase(rig.deps, 'auc1')).status).toBe('captured');
    assertFakeInvariants(rig.core);
  });

  it('exactly at the deadline it is still pending', async () => {
    const rig = makeRig({ b1: 30000 }, {}, { unknownDeadlineMs: 1000 });
    await seed(rig, [['b1', 22000]], { b1: 30000 });
    rig.core.inject('capture', 'timeout_before', rig.auth['b1'] ?? '', 10);
    await runCapturePhase(rig.deps, 'auc1');
    rig.clock.advance(1000);
    expect((await runCapturePhase(rig.deps, 'auc1')).status).toBe('pending');
    rig.clock.advance(1);
    expect((await runCapturePhase(rig.deps, 'auc1')).status).toBe('failed');
  });
});

describe('deadline helpers', () => {
  it('default to ten minutes and compare strictly', () => {
    expect(DEFAULT_UNKNOWN_DEADLINE_MS).toBe(600_000);
    expect(unknownExpired(null, 10 ** 12)).toBe(false);
    expect(unknownExpired(1000, 1000 + 600_000)).toBe(false);
    expect(unknownExpired(1000, 1000 + 600_001)).toBe(true);
    expect(unknownExpired(1000, 1500, 400)).toBe(true);
  });

  it('reports the time left, never below zero', () => {
    expect(unknownTimeLeftMs({ unknownSince: null }, 5)).toBeNull();
    expect(unknownTimeLeftMs({ unknownSince: 1000 }, 1000 + 100_000)).toBe(500_000);
    expect(unknownTimeLeftMs({ unknownSince: 1000 }, 10 ** 9)).toBe(0);
  });
});
