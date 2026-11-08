import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Cents } from '@gavel/shared';
import { ScreenView } from '../../src/screens/screen/ScreenView';
import { RoomStore } from '../../src/store/roomStore';
import { openSnapshot, roster, stateMsg } from '../../src/testing/builders';

function mount(status: 'OPEN' | 'DONE') {
  const store = new RoomStore();
  const snap = { ...openSnapshot(roster([7, 'Eve']), undefined, status), price: Cents(25_000) };
  store.dispatch({ kind: 'wire', msg: stateMsg(5, snap) });
  return render(<ScreenView lotTitle="Lot" code="CODE" joinUrl="https://x.test/j" store={store} />);
}

describe('screen story strip', () => {
  it('lists hold, hammer and receipt and marks the hold step while bidding', () => {
    mount('OPEN');
    const rail = screen.getByTestId('story-rail');
    const items = within(rail).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]?.getAttribute('aria-current')).toBe('step');
    expect(items[1]?.getAttribute('aria-current')).toBeNull();
  });

  it('moves to the hammer step once the lot is closed', () => {
    mount('DONE');
    const items = within(screen.getByTestId('story-rail')).getAllByRole('listitem');
    expect(items[0]?.getAttribute('data-status')).toBe('done');
    expect(items[1]?.getAttribute('aria-current')).toBe('step');
  });
});
