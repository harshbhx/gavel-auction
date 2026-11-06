import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '../../src/copy/en';
import type { HoldView, SettlementView } from '../../src/ladder/ladderModel';
import { Receipt, receiptJson } from '../../src/screens/receipt/Receipt';
import { ErrorPanel, Loading } from '../../src/screens/states/States';
import { redactDetail } from '../../src/screens/states/redact';
import { STATES_TABLE } from '../../src/screens/states/statesTable';

function hold(paddle: number, state: HoldView['state'], extra: Partial<HoldView> = {}): HoldView {
  return {
    paddle,
    name: `P${paddle}`,
    ceilingCents: 50000,
    state,
    capturedCents: 0,
    releasedCents: 0,
    verifiedBy: [],
    idSuffix: 'ABC123',
    ...extra,
  };
}

function view(phase: SettlementView['phase'], holds: HoldView[]): SettlementView {
  return {
    lotId: 'lot1',
    phase,
    winnerPaddle: 1,
    hammerPriceCents: 35000,
    holds,
    invariants: { ok: true, violations: [] },
  };
}

const base = { itemName: 'Vase', at: 1_700_000_000_000 };

describe('receipts (T-WEB-045)', () => {
  it('never says Charged before CAPTURED and says held, not charged', () => {
    const v = view('CAPTURING', [hold(1, 'CAPTURING')]);
    const { container } = render(<Receipt {...base} view={v} paddle={1} />);
    expect(container.textContent).not.toMatch(/Charged/);
    expect(screen.getByText(en['receipt.capturing'], { selector: 'p' })).toBeTruthy();
    expect(container.textContent).toContain('held, not charged');
  });

  it('shows Charged after CAPTURED', () => {
    const v = view('CAPTURED', [hold(1, 'CAPTURED', { capturedCents: 35000 })]);
    render(<Receipt {...base} view={v} paddle={1} />);
    expect(screen.getByText('Charged $350.00')).toBeTruthy();
  });

  it('shows the release text only after the void', () => {
    const before = render(
      <Receipt
        {...base}
        view={view('VOIDING', [hold(1, 'CAPTURED'), hold(2, 'VOIDING')])}
        paddle={2}
      />,
    );
    expect(before.container.textContent).not.toMatch(/hold was released/);
    expect(before.container.textContent).toContain(en['receipt.releasing']);
    before.unmount();
    const after = render(
      <Receipt
        {...base}
        view={view('SETTLED', [hold(1, 'CAPTURED'), hold(2, 'SETTLED', { releasedCents: 50000 })])}
        paddle={2}
      />,
    );
    expect(after.container.textContent).toContain('hold was released');
  });

  it('a failed receipt never reads as a charge', () => {
    const v = view('FAILED_NEEDS_REVIEW', [hold(1, 'FAILED_NEEDS_REVIEW')]);
    const { container } = render(<Receipt {...base} view={v} paddle={1} />);
    expect(container.textContent).not.toMatch(/Charged/);
    expect(container.textContent).toContain(en['receipt.failed']);
    expect(container.textContent).toContain('ABC123');
  });

  it('shows the fallback receipt with the final charge', () => {
    const v = view('CAPTURED', [hold(1, 'CAPTURED', { capturedCents: 30000 })]);
    const { container } = render(<Receipt {...base} view={v} paddle={1} runnerUp />);
    expect(container.textContent).toContain('you are the winner. Charged $300.00');
  });

  it('downloads only the viewer own hold, never another bidder', () => {
    const v = view('SETTLED', [
      hold(1, 'CAPTURED', { capturedCents: 35000 }),
      hold(2, 'SETTLED', { releasedCents: 50000 }),
    ]);
    const parsed = JSON.parse(receiptJson(v, 2, 1_700_000_000_000)) as {
      holds: { paddle: number }[];
      at: string;
    };
    expect(parsed.holds.map((h) => h.paddle)).toEqual([2]);
    expect(parsed.at).toBe('2023-11-14T22:13:20.000Z');
    expect(receiptJson(v, 2, null)).not.toContain('"at"');
    expect(receiptJson(v, 2, null)).not.toContain('P1');
  });

  it('says confirming, not held-not-charged, after capture without an amount', () => {
    const v = view('SETTLED', [hold(1, 'SETTLED', { idSuffix: '' })]);
    const { container } = render(<Receipt {...base} view={v} paddle={1} />);
    expect(container.textContent).toContain(en['receipt.confirming']);
    expect(container.textContent).not.toMatch(/held, not charged/);
    expect(container.textContent).not.toMatch(/Charged/);
  });

  it('shows no time row when the server time is unknown', () => {
    const v = view('CAPTURED', [hold(1, 'CAPTURED', { capturedCents: 35000 })]);
    const { container } = render(<Receipt {...base} at={null} view={v} paddle={1} />);
    expect(container.querySelector('time')).toBeNull();
  });
});

describe('state kit (T-WEB-050)', () => {
  it('has copy for every state of every view', () => {
    for (const [name, copy] of Object.entries(STATES_TABLE)) {
      for (const key of [copy.empty, copy.loading, copy.error, copy.offline]) {
        expect(en[key].length, name).toBeGreaterThan(0);
      }
    }
  });

  it('renders loading with text', () => {
    render(<Loading view="audit" />);
    expect(screen.getByText(en['state.loading'])).toBeTruthy();
  });

  it('keeps tokens and full ids out of error details', () => {
    const { container } = render(
      <ErrorPanel
        view="receipt"
        onRetry={() => undefined}
        code="Bearer abcdefghijklmnopqrstuvwxyz0123"
        correlationId="01HZZZZZZZZZZZZZZZZZZZZZZZ"
      />,
    );
    expect(container.textContent).not.toMatch(/abcdefghijklmnop/);
    expect(container.textContent).not.toMatch(/01HZZZZZZZZZZZZZZZZZZZZZZZ/);
    expect(redactDetail('order 5O190127TN364715T failed')).toBe('order [redacted] failed');
  });
});
