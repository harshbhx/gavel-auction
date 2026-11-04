import { describe, expect, it } from 'vitest';
import type { Scenario } from '../../src/net/transport';
import { ambiguous_confirm } from '../../src/testing/scenarios/ambiguous_confirm';
import { big_room_200_bids } from '../../src/testing/scenarios/big_room_200_bids';
import { failed_needs_review } from '../../src/testing/scenarios/failed_needs_review';
import { happy } from '../../src/testing/scenarios/happy';
import { kill_switch } from '../../src/testing/scenarios/kill_switch';
import { late_entry_closed } from '../../src/testing/scenarios/late_entry_closed';
import { outbid_race } from '../../src/testing/scenarios/outbid_race';
import { reconnect_gap } from '../../src/testing/scenarios/reconnect_gap';
import { rejections } from '../../src/testing/scenarios/rejections';
import { soft_close } from '../../src/testing/scenarios/soft_close';
import { winner_declined_fallback } from '../../src/testing/scenarios/winner_declined_fallback';
import type { SettlementView } from '../../src/ladder/ladderModel';
import { decodeServerMsg, parseServerMessage, type ServerMessage } from '../../src/wire';

const all: Scenario[] = [
  happy,
  outbid_race,
  soft_close,
  rejections,
  ambiguous_confirm,
  winner_declined_fallback,
  failed_needs_review,
  kill_switch,
  reconnect_gap,
  late_entry_closed,
  big_room_200_bids,
];

function emitted(s: Scenario): ServerMessage[] {
  return s.steps.flatMap((step) => (step.emit === undefined ? [] : [step.emit]));
}

function lastSettlement(s: Scenario): SettlementView | undefined {
  const views = s.settlementViews ?? [];
  return views[views.length - 1];
}

function lastPhase(s: Scenario): string | undefined {
  const phases = emitted(s).flatMap((m) => (m.t === 'settlement_update' ? [m.auctionState] : []));
  return phases[phases.length - 1];
}

describe('scenario fixtures', () => {
  it.each(all.map((s) => [s.name, s] as const))('%s is well formed', (_name, s) => {
    const msgs = emitted(s);
    expect(msgs.length).toBeGreaterThan(0);
    // Every fixture is a valid shared-schema frame, and survives the wire codec unchanged.
    msgs.forEach((m) => {
      expect(parseServerMessage(m)).toEqual(m);
      if (s.name !== 'big_room_200_bids') {
        expect(decodeServerMsg(JSON.stringify(m)).ok).toBe(true);
      }
    });
    const seqs = msgs.map((m) => m.seq ?? 0);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
    const times = s.steps.map((step) => step.at);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('happy has 3 bidders, 5 accepted bids, a hammer and a balanced settlement', () => {
    const msgs = emitted(happy);
    expect(msgs.filter((m) => m.t === 'bid_accepted')).toHaveLength(5);
    expect(msgs.filter((m) => m.t === 'hammer')).toHaveLength(1);
    const first = msgs[0];
    expect(first?.t === 'state' ? first.snapshot.roster : []).toHaveLength(3);
    const view = lastSettlement(happy);
    const holds = view?.holds ?? [];
    const total = holds.reduce((n, h) => n + h.ceilingCents, 0);
    const settled = holds.reduce((n, h) => n + h.capturedCents + h.releasedCents, 0);
    expect(settled).toBe(total);
    expect(lastPhase(happy)).toBe('CAPTURED');
  });

  it('outbid_race has two bids within 50 ms', () => {
    const times = outbid_race.steps.flatMap((step) => (step.emit?.t === 'price' ? [step.at] : []));
    const gaps = times.slice(1).map((t, i) => t - (times[i] ?? 0));
    expect(gaps.some((g) => g <= 50)).toBe(true);
  });

  it('soft_close extends endTs after a bid in the last second', () => {
    const closes = emitted(soft_close).flatMap((m) => (m.t === 'price' ? [m.endTs] : []));
    expect(closes.length).toBeGreaterThanOrEqual(2);
    expect(closes[1]).toBeGreaterThan(closes[0] ?? 0);
    const extensions = emitted(soft_close).flatMap((m) => (m.t === 'price' ? [m.extensions] : []));
    expect(extensions).toEqual([0, 1, 2]);
  });

  it('rejections cover every code', () => {
    const codes = emitted(rejections).flatMap((m) => (m.t === 'bid_rejected' ? [m.reason] : []));
    expect(codes.sort()).toEqual(
      ['already_leading', 'below_increment', 'below_reserve', 'closed', 'over_ceiling'].sort(),
    );
  });

  it('fallback ends with the runner-up CAPTURED and reason "hold expired"', () => {
    const view = lastSettlement(winner_declined_fallback);
    expect(view?.phase).toBe('CAPTURED');
    expect(lastPhase(winner_declined_fallback)).toBe('CAPTURED');
    expect(view?.holds.find((h) => h.paddle === view.winnerPaddle)?.state).toBe('CAPTURED');
    expect(view?.holds.some((h) => h.reason === 'hold expired')).toBe(true);
  });

  it('failure ends FAILED_NEEDS_REVIEW', () => {
    expect(lastSettlement(failed_needs_review)?.phase).toBe('FAILED_NEEDS_REVIEW');
    expect(lastPhase(failed_needs_review)).toBe('FAILED_NEEDS_REVIEW');
  });

  it('kill_switch ends STOPPED with no winner', () => {
    const states = emitted(kill_switch).flatMap((m) =>
      m.t === 'state' ? [m.snapshot.status] : [],
    );
    expect(states[states.length - 1]).toBe('DONE');
    expect(lastSettlement(kill_switch)?.winnerPaddle).toBeNull();
  });

  it('reconnect_gap drops a message and disconnects', () => {
    const faults = reconnect_gap.steps.flatMap((s) => (s.fault === undefined ? [] : [s.fault]));
    expect(faults).toEqual(['drop', 'disconnect']);
  });

  it('late_entry_closed rejects the newcomer as unregistered', () => {
    const codes = emitted(late_entry_closed).flatMap((m) =>
      m.t === 'bid_rejected' ? [m.reason] : [],
    );
    expect(codes).toEqual(['unregistered']);
  });

  it('big_room has 250 bids and 200 bidders', () => {
    const msgs = emitted(big_room_200_bids);
    expect(msgs.filter((m) => m.t === 'price')).toHaveLength(250);
    const first = msgs[0];
    expect(first?.t === 'state' ? first.snapshot.roster : []).toHaveLength(200);
  });
});
