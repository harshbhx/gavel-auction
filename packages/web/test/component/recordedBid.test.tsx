import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { t } from '../../src/copy/t';
import { BidScreen } from '../../src/screens/bid/BidScreen';
import { RoomStore } from '../../src/store/roomStore';
import { bidderId, openSnapshot, roster, stateMsg } from '../../src/testing/builders';

function makeStore(): RoomStore {
  const store = new RoomStore();
  const snap = {
    ...openSnapshot(roster([12, 'Priya'])),
    you: { bidderId: bidderId(12), ceiling: 50000 },
  };
  store.dispatch({ kind: 'wire', msg: stateMsg(1, snap as never) }, 0);
  return store;
}

describe('recorded bid screen', () => {
  it('replaces the bid controls with the reason and a link to the live demo', () => {
    render(<BidScreen store={makeStore()} onBid={() => undefined} recorded />);
    expect(screen.getByText(t('bid.recorded'))).toBeTruthy();
    expect(screen.getByRole('link', { name: t('bid.recordedLive') }).getAttribute('href')).toBe(
      '/demo',
    );
    expect(screen.queryByTestId('bid-bar')).toBeNull();
    expect(screen.queryByRole('button', { name: t('bid.place') })).toBeNull();
  });

  it('keeps the controls when the room is live', () => {
    render(<BidScreen store={makeStore()} onBid={() => undefined} />);
    expect(screen.getByTestId('bid-bar')).toBeTruthy();
    expect(screen.queryByTestId('bid-recorded')).toBeNull();
  });
});
