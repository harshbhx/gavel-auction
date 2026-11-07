import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { t } from '../../src/copy/t';
import { ConsoleScreen } from '../../src/screens/console/ConsoleScreen';
import { PriceHeader } from '../../src/screens/console/PriceHeader';
import { RoomStore } from '../../src/store/roomStore';
import { BASE_TIME, openSnapshot, priceMsg, roster, stateMsg } from '../../src/testing/builders';

afterEach(() => {
  vi.useRealTimers();
});

function makeStore(): RoomStore {
  const store = new RoomStore();
  store.dispatch({ kind: 'wire', msg: stateMsg(1, openSnapshot(roster([12, 'Priya']))) }, 0);
  return store;
}

describe('PriceHeader', () => {
  it('counts down from the server clock and keeps tabular numerals', () => {
    vi.useFakeTimers();
    let nowMs = BASE_TIME;
    render(
      <PriceHeader
        priceCents={35000}
        reserveCents={100}
        leaderPaddle={12}
        leaderName="Priya"
        bidCount={5}
        endTs={BASE_TIME + 60_000}
        now={() => nowMs}
        nextMinCents={40000}
      />,
    );
    const price = document.querySelector('[data-field="price"]') as HTMLElement;
    const countdown = document.querySelector('[data-field="countdown"]') as HTMLElement;
    expect(price.textContent).toBe('$350.00');
    expect(price.style.fontVariantNumeric).toBe('tabular-nums');
    expect(countdown.textContent).toContain('1:00');
    nowMs = BASE_TIME + 30_000;
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(countdown.textContent).toContain('0:30');
    expect(screen.getByText(t('bid.leader', { n: 12 }), { exact: false })).toBeTruthy();
    expect(screen.getByText('Priya')).toBeTruthy();
  });
});

describe('ConsoleScreen', () => {
  it('shows three columns and the ladder strip on a wide viewport', () => {
    render(<ConsoleScreen store={makeStore()} settlementView={null} wide />);
    expect(document.querySelector('[data-layout="wide"]')).not.toBeNull();
    expect(screen.getByText(t('console.noBids'))).toBeTruthy();
    expect(screen.getByText(t('console.noConfirm'))).toBeTruthy();
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('stacks into tabs below 1024 px and switches panels', () => {
    render(<ConsoleScreen store={makeStore()} settlementView={null} wide={false} />);
    expect(screen.getByRole('tablist')).toBeTruthy();
    expect(screen.queryByText(t('console.noBids'))).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: t('console.stream') }));
    expect(screen.getByText(t('console.noBids'))).toBeTruthy();
  });

  it('updates the price from a price message', () => {
    const store = makeStore();
    render(<ConsoleScreen store={store} settlementView={null} wide />);
    act(() => {
      store.dispatch({ kind: 'wire', msg: priceMsg(2, 12, 5000) }, 0);
    });
    expect(
      document.querySelector('[data-field="price"] [role="img"]')?.getAttribute('aria-label'),
    ).toBe('$50.00');
  });
});
