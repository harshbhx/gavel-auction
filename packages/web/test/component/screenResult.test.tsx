import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Cents } from '@gavel/shared';
import { ScreenView } from '../../src/screens/screen/ScreenView';
import { RoomStore } from '../../src/store/roomStore';
import { bidderId, openSnapshot, roster, stateMsg } from '../../src/testing/builders';

function closedStore(options: { leader: number | null; inRoster: boolean }): RoomStore {
  const store = new RoomStore();
  const list = options.inRoster ? roster([7, 'Eve']) : roster([3, 'Sam']);
  const snap = {
    ...openSnapshot(list, undefined, 'DONE'),
    price: Cents(25_000),
    leaderId: options.leader === null ? null : bidderId(options.leader),
  };
  store.dispatch({ kind: 'wire', msg: stateMsg(5, snap) });
  return store;
}

function view(store: RoomStore) {
  return render(
    <ScreenView lotTitle="Lot" code="ZZTOPCODE" joinUrl="https://x.test/j" store={store} />,
  );
}

describe('public screen after the hammer (reload or late join)', () => {
  it('shows the result and no join code when the snapshot is closed', () => {
    view(closedStore({ leader: 7, inRoster: true }));
    expect(screen.getByText('SOLD to paddle 7 for $250.00')).toBeTruthy();
    expect(screen.queryByText(/ZZTOPCODE/)).toBeNull();
  });

  it('shows the price with an unknown paddle label when the winner is not on the roster', () => {
    view(closedStore({ leader: 7, inRoster: false }));
    expect(screen.queryByText('Passed')).toBeNull();
    expect(screen.getByText(/\$250\.00/)).toBeTruthy();
  });

  it('says passed only when nobody led', () => {
    view(closedStore({ leader: null, inRoster: true }));
    expect(screen.getByText('Passed')).toBeTruthy();
  });
});
