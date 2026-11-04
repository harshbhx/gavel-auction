import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Ladder } from '../../src/ladder/Ladder';
import type { SettlementView } from '../../src/ladder/ladderModel';
import { hold, settlementView } from '../../src/testing/scenarios/_kit';
import type { Scenario } from '../../src/net/transport';
import { failed_needs_review } from '../../src/testing/scenarios/failed_needs_review';
import { happy } from '../../src/testing/scenarios/happy';
import { winner_declined_fallback } from '../../src/testing/scenarios/winner_declined_fallback';

function last(s: Scenario): SettlementView {
  const all = s.settlementViews ?? [];
  const view = all[all.length - 1];
  if (view === undefined) throw new Error('scenario has no settlement update');
  return view;
}

function states(container: HTMLElement, paddle: number): string[] {
  const lane = container.querySelector(`[data-paddle="${paddle}"]`);
  if (lane === null) throw new Error('lane missing');
  return Array.from(lane.querySelectorAll('.gv-ladder__rung')).map(
    (el) => `${el.getAttribute('data-state')}:${el.getAttribute('data-status')}`,
  );
}

describe('Ladder', () => {
  it('shows a skeleton while waiting', () => {
    const { container } = render(<Ladder view={null} />);
    expect(container.querySelector('[data-skeleton="true"]')).not.toBeNull();
  });

  it('renders happy rungs in order with check, current and hollow icons', () => {
    const { container } = render(<Ladder view={last(happy)} />);
    const lanes = Array.from(container.querySelectorAll('.gv-ladder__lane'));
    expect(lanes.length).toBeGreaterThan(0);
    const rungs = Array.from(container.querySelectorAll('.gv-ladder__rung'));
    const done = rungs.find((r) => r.getAttribute('data-status') === 'done');
    expect(done?.querySelector('svg')).not.toBeNull();
    const first = lanes[0]?.getAttribute('data-paddle');
    expect(states(container, Number(first))[0]).toMatch(/^HELD:/);
  });

  it('renders the fallback branch and the failed branch', () => {
    const fb = render(<Ladder view={last(winner_declined_fallback)} />);
    expect(fb.container.querySelector('[data-kind="fallback"]')).not.toBeNull();
    fb.unmount();
    const failed = render(<Ladder view={last(failed_needs_review)} />);
    expect(failed.container.querySelector('[data-kind="failed"]')).not.toBeNull();
  });

  it('shows the three verification variants', () => {
    const view = settlementView('CAPTURED', 1, [
      hold(1, 'Ada', 100000, 'CAPTURED', 35000, 0, {
        verifiedBy: [
          { eventId: 'e1', kind: 'webhook', eventType: 'PAYMENT.CAPTURE.COMPLETED', at: 0 },
        ],
      }),
      hold(2, 'Bo', 100000, 'VOIDING', 0, 0, {
        verifiedBy: [{ eventId: 'e2', kind: 'lookup', at: 0 }],
      }),
      hold(3, 'Cy', 50000, 'BIDDING'),
    ]);
    const { container } = render(<Ladder view={view} />);
    const kinds = Array.from(container.querySelectorAll('[data-verification]')).map((e) =>
      e.getAttribute('data-verification'),
    );
    expect(kinds).toEqual(['webhook', 'lookup', 'pending']);
  });

  it('flags an invariant violation and hides released until the server says so', () => {
    const view = settlementView(
      'CAPTURED',
      1,
      [hold(1, 'Ada', 100000, 'CAPTURED', 35000), hold(2, 'Bo', 150000, 'VOIDING', 0, 200000)],
      false,
      ['sum'],
    );
    const { container } = render(<Ladder view={view} />);
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.querySelector('[data-kind="released"]')).toBeNull();
  });
});
