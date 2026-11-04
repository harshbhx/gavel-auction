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
import { isServerMessage, type ServerMessage, type SettlementView } from '../../src/wire';

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
  const updates = emitted(s).flatMap((m) => (m.t === 'settlement_update' ? [m.settlement] : []));
  return updates[updates.length - 1];
}

describe('scenario fixtures', () => {
  it.each(all.map((s) => [s.name, s] as const))('%s is well formed', (_name, s) => {
    const msgs = emitted(s);
    expect(msgs.length).toBeGreaterThan(0);
    msgs.forEach((m) => expect(isServerMessage(m)).toBe(true));
    const seqs = msgs.map((m) => m.seq);
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
    expect(first?.t === 'state' ? first.bidders : []).toHaveLength(3);
    const view = lastSettlement(happy);
    const holds = view?.holds ?? [];
    const total = holds.reduce((n, h) => n + h.ceilingCents, 0);
    const settled = holds.reduce((n, h) => n + h.capturedCents + h.releasedCents, 0);
    expect(settled).toBe(total);
  });

  it('outbid_race has two bids within 50 ms', () => {
    const times = emitted(outbid_race).flatMap((m, i) =>
      m.t === 'bid' ? [outbid_race.steps[i]?.at ?? 0] : [],
    );
    const gaps = times.slice(1).map((t, i) => t - (times[i] ?? 0));
    expect(gaps.some((g) => g <= 50)).toBe(true);
  });

  it('soft_close extends closesAt after a bid in the last second', () => {
    const closes = emitted(soft_close).flatMap((m) =>
      m.t === 'price' && m.closesAt !== undefined ? [m.closesAt] : [],
    );
    expect(closes.length).toBeGreaterThanOrEqual(2);
    expect(closes[1]).toBeGreaterThan(closes[0] ?? 0);
  });

  it('rejections cover every code', () => {
    const codes = emitted(rejections).flatMap((m) => (m.t === 'bid_rejected' ? [m.code] : []));
    expect(codes.sort()).toEqual(
      ['already_leading', 'below_increment', 'below_reserve', 'closed', 'over_ceiling'].sort(),
    );
  });

  it('fallback ends with the runner-up CAPTURED and reason "hold expired"', () => {
    const view = lastSettlement(winner_declined_fallback);
    expect(view?.phase).toBe('CAPTURED');
    expect(view?.holds.find((h) => h.paddle === view.winnerPaddle)?.state).toBe('CAPTURED');
    expect(view?.holds.some((h) => h.reason === 'hold expired')).toBe(true);
  });

  it('failure ends FAILED_NEEDS_REVIEW', () => {
    expect(lastSettlement(failed_needs_review)?.phase).toBe('FAILED_NEEDS_REVIEW');
  });

  it('kill_switch ends STOPPED with no winner', () => {
    const states = emitted(kill_switch).flatMap((m) => (m.t === 'state' ? [m.room.status] : []));
    expect(states[states.length - 1]).toBe('STOPPED');
    expect(lastSettlement(kill_switch)?.winnerPaddle).toBeNull();
  });

  it('reconnect_gap drops a message and disconnects', () => {
    const faults = reconnect_gap.steps.flatMap((s) => (s.fault === undefined ? [] : [s.fault]));
    expect(faults).toEqual(['drop', 'disconnect']);
  });

  it('late_entry_closed turns late entry off', () => {
    expect(late_entry_closed.roomConfig.lateEntry).toBe(false);
  });

  it('big_room has 250 bids and 200 bidders', () => {
    const msgs = emitted(big_room_200_bids);
    expect(msgs.filter((m) => m.t === 'bid')).toHaveLength(250);
    const first = msgs[0];
    expect(first?.t === 'state' ? first.bidders : []).toHaveLength(200);
  });
});
