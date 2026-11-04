import { describe, expect, it } from 'vitest';
import { buildLadder } from '../../src/ladder/ladderModel';
import type { Scenario } from '../../src/net/transport';
import { hold, settlementView } from '../../src/testing/scenarios/_kit';
import { failed_needs_review } from '../../src/testing/scenarios/failed_needs_review';
import { happy } from '../../src/testing/scenarios/happy';
import { winner_declined_fallback } from '../../src/testing/scenarios/winner_declined_fallback';
import type { SettlementView } from '../../src/wire';

function updates(s: Scenario): SettlementView[] {
  return s.steps.flatMap((step) =>
    step.emit?.t === 'settlement_update' ? [step.emit.settlement] : [],
  );
}

function last(s: Scenario): SettlementView {
  const all = updates(s);
  const view = all[all.length - 1];
  if (view === undefined) throw new Error('scenario has no settlement update');
  return view;
}

describe('buildLadder', () => {
  it('shows the WINNER_SELECTED skeleton before the first update', () => {
    const m = buildLadder(null);
    expect(m.waiting).toBe(true);
    expect(m.lanes).toEqual([]);
    expect(m.skeleton.map((r) => [r.state, r.status])).toEqual([
      ['HELD', 'done'],
      ['BIDDING', 'done'],
      ['WINNER_SELECTED', 'current'],
    ]);
    expect(m.invariants).toBeNull();
  });

  it('orders happy lanes: winner path to CAPTURED, others through VOIDING to SETTLED', () => {
    const m = buildLadder(last(happy));
    expect(m.waiting).toBe(false);
    const winner = m.lanes.find((l) => l.paddle === 12);
    expect(winner?.rungs.map((r) => r.state)).toEqual([
      'HELD',
      'BIDDING',
      'WINNER_SELECTED',
      'CAPTURING',
      'CAPTURED',
    ]);
    expect(winner?.rungs.map((r) => r.status)).toEqual(['done', 'done', 'done', 'done', 'current']);
    const other = m.lanes.find((l) => l.paddle === 7);
    expect(other?.rungs.map((r) => r.state)).toEqual(['HELD', 'BIDDING', 'VOIDING', 'SETTLED']);
    expect(other?.rungs.map((r) => r.status)).toEqual(['done', 'done', 'done', 'current']);
  });

  it('keeps integer-cent invariants green for the happy ending', () => {
    const inv = buildLadder(last(happy)).invariants;
    expect(inv).toMatchObject({
      holdsCents: 100_000,
      capturedCents: 35_000,
      releasedCents: 65_000,
      violated: false,
    });
  });

  it('allows the word released only for a SETTLED hold', () => {
    const [capturing] = updates(happy).filter((v) => v.phase === 'CAPTURING');
    const early = buildLadder(capturing ?? null);
    expect(early.lanes.every((l) => !l.canSayReleased)).toBe(true);
    const done = buildLadder(last(happy));
    expect(done.lanes.filter((l) => l.canSayReleased).map((l) => l.paddle)).toEqual([7, 9]);
    const winner = done.lanes.find((l) => l.paddle === 12);
    expect(winner?.canSayReleased).toBe(false);
    expect(winner?.remainderVoided).toBe(true);
  });

  it('adds a fallback branch with its reason and the runner-up as winner', () => {
    const m = buildLadder(last(winner_declined_fallback));
    const declined = m.lanes.find((l) => l.paddle === 12);
    expect(declined?.branch).toBe('fallback');
    expect(declined?.rungs.map((r) => r.state)).toEqual([
      'HELD',
      'BIDDING',
      'WINNER_SELECTED',
      'FALLBACK_RUNNER_UP',
    ]);
    expect(m.fallback).toEqual({ reason: 'hold expired', runnerUpPaddle: 7 });
    expect(m.lanes.find((l) => l.paddle === 7)?.isWinner).toBe(true);
    expect(m.lanes.find((l) => l.paddle === 7)?.state).toBe('CAPTURED');
    expect(m.invariants?.violated).toBe(false);
  });

  it('shows a failed branch and flags the server-reported violation', () => {
    const m = buildLadder(last(failed_needs_review));
    expect(m.failed).toEqual({ reason: 'capture failed' });
    expect(m.lanes.find((l) => l.paddle === 12)?.branch).toBe('failed');
    expect(m.invariants?.violated).toBe(true);
    expect(m.invariants?.serverViolations).toHaveLength(1);
  });

  it('flags mismatched totals (captured 35000 + released 200000 vs holds 250000)', () => {
    const view = settlementView('CAPTURED', 12, [
      hold(12, 'Priya', 150_000, 'CAPTURED', 35_000, 0),
      hold(7, 'Sam', 100_000, 'SETTLED', 0, 200_000),
    ]);
    const inv = buildLadder(view).invariants;
    expect(inv?.holdsCents).toBe(250_000);
    expect(inv?.totalsMatch).toBe(false);
    expect(inv?.violated).toBe(true);
  });

  it('flags a capture above the winning ceiling and non-integer cents', () => {
    const over = buildLadder(
      settlementView('CAPTURING', 12, [hold(12, 'Priya', 10_000, 'CAPTURING', 20_000, 0)]),
    );
    expect(over.invariants?.capturedWithinCeiling).toBe(false);
    expect(over.invariants?.violated).toBe(true);
    const frac = buildLadder(
      settlementView('CAPTURING', 12, [hold(12, 'Priya', 10_000.5, 'CAPTURING')]),
    );
    expect(frac.invariants?.integerCents).toBe(false);
    expect(frac.invariants?.violated).toBe(true);
  });

  it('does not require balanced totals while settlement is in progress', () => {
    const [capturing] = updates(happy).filter((v) => v.phase === 'CAPTURING');
    expect(buildLadder(capturing ?? null).invariants?.violated).toBe(false);
  });

  it('lists each verification event once, oldest first, and picks the latest per hold', () => {
    const e = (eventId: string, at: number) =>
      ({ eventId, kind: 'webhook', eventType: 'PAYMENT.CAPTURE.COMPLETED', at }) as const;
    const view = settlementView('CAPTURED', 12, [
      hold(12, 'Priya', 50_000, 'CAPTURED', 35_000, 15_000, {
        verifiedBy: [e('b', 20), e('a', 10), e('b', 20)],
      }),
    ]);
    const m = buildLadder(view);
    expect(m.events.map((x) => x.eventId)).toEqual(['a', 'b']);
    expect(m.lanes[0]?.verification).toMatchObject({ kind: 'webhook', eventId: 'b' });
    expect(
      buildLadder(settlementView('HELD', null, [hold(7, 'Sam', 1_000, 'HELD')])).lanes[0]
        ?.verification,
    ).toEqual({
      kind: 'pending',
    });
  });

  it('is pure: the same input gives equal output and the input is untouched', () => {
    const view = last(happy);
    const before = JSON.stringify(view);
    expect(buildLadder(view)).toEqual(buildLadder(view));
    expect(JSON.stringify(view)).toBe(before);
  });
});
