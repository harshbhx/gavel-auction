import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { Cents, EpochMs } from '@gavel/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReceiptRoute } from '../../src/App';
import { roomStore } from '../../src/store/roomStore';
import { BASE_TIME, bidderId, openSnapshot, roster, stateMsg } from '../../src/testing/builders';
import type { SettlementUpdateMsg } from '../../src/wire';
import { formatTime } from '../../src/ui/format';

type State = SettlementUpdateMsg['auctionState'];

function setup(me: number): void {
  const snap = {
    ...openSnapshot(roster([1, 'Ana'], [2, 'Ben'])),
    you: { bidderId: bidderId(me), ceiling: Cents(50000) },
  };
  act(() => roomStore.dispatch({ kind: 'reset' }));
  act(() => roomStore.dispatch({ kind: 'wire', msg: stateMsg(1, snap) }));
  act(() =>
    roomStore.dispatch({
      kind: 'wire',
      msg: {
        v: 1,
        t: 'hammer',
        seq: 2,
        ts: EpochMs(BASE_TIME + 2),
        winnerId: bidderId(1),
        price: Cents(35000),
        ranking: [],
      },
    }),
  );
}

function update(seq: number, state: State, extra: Partial<SettlementUpdateMsg> = {}): void {
  const msg: SettlementUpdateMsg = {
    v: 1,
    t: 'settlement_update',
    seq,
    ts: EpochMs(BASE_TIME + seq * 1000),
    rev: seq,
    auctionState: state,
    you: state,
    ...extra,
  };
  act(() => roomStore.dispatch({ kind: 'wire', msg }));
}

function receipt(container: HTMLElement): HTMLElement {
  const el = container.querySelector('article.gv-receipt');
  if (!(el instanceof HTMLElement)) throw new Error('no receipt');
  return el;
}

describe('receipt route after capture', () => {
  beforeEach(() => setup(1));

  it('says held, not charged only before capture', () => {
    update(3, 'CAPTURING');
    const { container } = render(<ReceiptRoute roomId="lot1" />);
    expect(receipt(container).textContent).toContain('Held $500.00');
    expect(receipt(container).textContent).toContain('winning price $350.00 will be charged only');
    expect(receipt(container).textContent).not.toMatch(/Charged/);
  });

  it('never shows held-not-charged or a guessed charge once settled without an amount', () => {
    update(3, 'SETTLED');
    const { container } = render(<ReceiptRoute roomId="lot1" />);
    const text = receipt(container).textContent ?? '';
    expect(text).toContain('confirming the amount');
    expect(text).not.toMatch(/held, not charged/);
    expect(text).not.toMatch(/Charged/);
    expect(text).not.toContain('Reference ending');
  });

  it('shows the captured amount, not the hammer price, and the server settle time', () => {
    update(3, 'CAPTURED', { amountCaptured: Cents(34000) });
    update(4, 'CAPTURED', { amountCaptured: Cents(34000) });
    const { container } = render(<ReceiptRoute roomId="lot1" />);
    const text = receipt(container).textContent ?? '';
    expect(text).toContain('Charged $340.00');
    expect(text).toContain('$350.00');
    expect(text).not.toContain('Charged $350.00');
    const time = container.querySelector('time');
    expect(time?.getAttribute('dateTime')).toBe(new Date(BASE_TIME + 3000).toISOString());
  });

  it('keeps the same time on a later render', () => {
    update(3, 'SETTLED', { amountCaptured: Cents(35000) });
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2031-01-01T00:00:00Z'));
    try {
      const { container } = render(<ReceiptRoute roomId="lot1" />);
      expect(container.querySelector('time')?.textContent).toBe(formatTime(BASE_TIME + 3000));
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows no time before the server has settled this hold', () => {
    update(3, 'CAPTURING');
    const { container } = render(<ReceiptRoute roomId="lot1" />);
    expect(container.querySelector('time')).toBeNull();
  });

  it('mounts the settlement ladder under the receipt', () => {
    update(3, 'CAPTURING');
    render(<ReceiptRoute roomId="lot1" />);
    const panel = screen.getByTestId('settlement-panel');
    expect(within(panel).getByText('PayPal hold status')).toBeTruthy();
  });
});

describe('receipt route for a promoted runner-up', () => {
  beforeEach(() => setup(2));

  it('shows the charge, not a non-winner receipt, and no winning price', () => {
    update(3, 'CAPTURED', { you: 'CAPTURED', amountCaptured: Cents(30000) });
    const { container } = render(<ReceiptRoute roomId="lot1" />);
    const text = receipt(container).textContent ?? '';
    expect(text).toContain('you are the winner. Charged $300.00');
    expect(text).not.toContain('Winning price');
    expect(text).not.toMatch(/did not win/);
  });

  it('never shows a charge to a loser when the lot-level amount is set', () => {
    update(3, 'SETTLED', { you: 'SETTLED', amountCaptured: Cents(34000) });
    const { container } = render(<ReceiptRoute roomId="lot1" />);
    const text = receipt(container).textContent ?? '';
    expect(text).not.toMatch(/Charged/);
    expect(text).not.toMatch(/you are the winner/);
    expect(text).toContain('hold was released');
  });
});

describe('receipt route with per-hold data', () => {
  beforeEach(() => setup(2));

  function detailed(): void {
    update(3, 'SETTLED', {
      winnerPaddle: 1,
      holds: [
        {
          paddle: 1,
          state: 'CAPTURED',
          capturedCents: 35000,
          releasedCents: 15000,
          idSuffix: 'AB12CD',
          verifiedBy: [{ eventId: 'evt-one', kind: 'webhook', at: BASE_TIME + 5 }],
        },
        {
          paddle: 2,
          state: 'SETTLED',
          capturedCents: 0,
          releasedCents: 50000,
          idSuffix: 'EF34GH',
          verifiedBy: [{ eventId: 'evt-two', kind: 'lookup', at: BASE_TIME + 6 }],
        },
      ],
      invariants: { ok: true, violations: [] },
    });
  }

  it('shows only the viewer own hold in the ladder', () => {
    detailed();
    const { container } = render(<ReceiptRoute roomId="lot1" />);
    expect(container.textContent).not.toContain('Ana');
    expect(container.querySelectorAll('.gv-ladder__lane')).toHaveLength(1);
    expect(container.querySelector('[data-paddle="1"]')).toBeNull();
  });

  it('downloads only the viewer own hold', async () => {
    detailed();
    let saved: Blob | null = null;
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: (b: Blob) => {
        saved = b;
        return 'blob:fake';
      },
      revokeObjectURL: () => undefined,
    });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    render(<ReceiptRoute roomId="lot1" />);
    fireEvent.click(screen.getByText('Download JSON'));
    expect(click).toHaveBeenCalled();
    const blob = saved as Blob | null;
    const body =
      blob === null
        ? ''
        : await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.readAsText(blob);
          });
    const parsed = JSON.parse(body) as { holds: { paddle: number }[]; hammerPriceCents?: number };
    expect(parsed.holds.map((h) => h.paddle)).toEqual([2]);
    expect(parsed.hammerPriceCents).toBeUndefined();
    expect(body).not.toContain('Ana');
    expect(body).not.toContain('AB12CD');
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
