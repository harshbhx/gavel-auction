import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Cents, EpochMs } from '@gavel/shared';
import { ScreenView } from '../../src/screens/screen/ScreenView';
import { RoomStore } from '../../src/store/roomStore';
import {
  BASE_TIME,
  auctionId,
  bidderId,
  openSnapshot,
  roster,
  stateMsg,
} from '../../src/testing/builders';

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
    expect(screen.queryByText('No sale')).toBeNull();
    expect(screen.getByText(/\$250\.00/)).toBeTruthy();
  });

  it('says passed only when nobody led', () => {
    view(closedStore({ leader: null, inRoster: true }));
    expect(screen.getByText('No sale')).toBeTruthy();
  });
});

describe('public screen after a hammer with no bids', () => {
  it('shows one centred no-sale result, with no stopped chip and no ladder', () => {
    const store = new RoomStore();
    const snap = {
      ...openSnapshot(roster([7, 'Eve']), undefined, 'DONE'),
      stopped: true,
    };
    store.dispatch({ kind: 'wire', msg: stateMsg(5, snap) });
    view(store);
    expect(screen.getByText('No sale')).toBeTruthy();
    expect(screen.getByText('Closed with no bids.')).toBeTruthy();
    expect(screen.queryByText('Auction stopped')).toBeNull();
    expect(screen.queryByTestId('settlement-panel')).toBeNull();
  });
});

describe('public screen settlement ladder', () => {
  it('builds the audit link from the room id when there is no join code', () => {
    const store = closedStore({ leader: 7, inRoster: true });
    store.dispatch({
      kind: 'wire',
      msg: {
        v: 1,
        t: 'settlement_update',
        seq: 6,
        ts: EpochMs(BASE_TIME + 6),
        rev: 1,
        auctionState: 'FAILED_NEEDS_REVIEW',
        winnerPaddle: 7,
        holds: [],
        invariants: { ok: true, violations: [] },
      },
    });
    const { container } = render(
      <ScreenView lotTitle="Lot" code={null} joinUrl="https://x.test/j" store={store} />,
    );
    const link = container.querySelector('.gv-settlement a');
    expect(link?.getAttribute('href')).toBe(`/r/${encodeURIComponent(auctionId())}/audit`);
    expect(container.innerHTML).not.toContain('/r/null/');
  });

  it('mounts the ladder with the winner lane only, no names', () => {
    const store = closedStore({ leader: 7, inRoster: true });
    store.dispatch({
      kind: 'wire',
      msg: {
        v: 1,
        t: 'settlement_update',
        seq: 6,
        ts: EpochMs(BASE_TIME + 6),
        rev: 1,
        auctionState: 'SETTLED',
        winnerPaddle: 7,
        holds: [
          {
            paddle: 7,
            state: 'CAPTURED',
            capturedCents: 25_000,
            releasedCents: 0,
            idSuffix: 'AB12CD',
            verifiedBy: [],
          },
          {
            paddle: 8,
            state: 'SETTLED',
            capturedCents: 0,
            releasedCents: 9_000,
            idSuffix: 'EF34GH',
            verifiedBy: [],
          },
        ],
        invariants: { ok: true, violations: [] },
      },
    });
    const { container } = view(store);
    expect(screen.getByTestId('settlement-panel')).toBeTruthy();
    expect(container.querySelectorAll('.gv-ladder__lane')).toHaveLength(1);
    expect(container.textContent).not.toContain('Eve');
    expect(container.textContent).not.toContain('AB12CD');
  });
});

describe('public screen when settlement needs review', () => {
  it('claims no sale and no capture, and does not state a charge outcome', () => {
    const store = closedStore({ leader: 7, inRoster: true });
    store.dispatch({
      kind: 'wire',
      msg: {
        v: 1,
        t: 'settlement_update',
        seq: 6,
        ts: EpochMs(BASE_TIME + 6),
        rev: 1,
        auctionState: 'FAILED_NEEDS_REVIEW',
        winnerPaddle: 7,
        holds: [],
        invariants: { ok: true, violations: [] },
      },
    });
    const { container } = render(
      <ScreenView lotTitle="Lot" code={null} joinUrl="https://x.test/j" store={store} />,
    );
    expect(screen.getByText('Paddle 7 won at $250.00')).toBeTruthy();
    expect(screen.getByTestId('settle-review').textContent).toMatch(
      /needs review.*checking whether the winning hold was taken/,
    );
    expect(container.textContent).not.toMatch(/SOLD|captured/);
    expect(screen.queryByTestId('settle-summary')).toBeNull();
  });
});

describe('public screen side panel (UIX-73)', () => {
  it('puts the QR code above a focusable, labelled latest list', async () => {
    const store = new RoomStore();
    store.dispatch({ kind: 'wire', msg: stateMsg(5, openSnapshot(roster([7, 'Eve']))) });
    const { container } = view(store);
    const list = container.querySelector('.gv-screen__ticker-list');
    expect(list?.getAttribute('tabindex')).toBe('0');
    expect(list?.getAttribute('aria-label')).toBeTruthy();
    const order = Array.from(container.querySelectorAll('.gv-screen__side > *')).map(
      (el) => el.className,
    );
    const join = order.indexOf('gv-screen__join');
    expect(join).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('gv-screen__ticker')).toBeGreaterThan(join);
    expect(await screen.findByText('Scan to join')).toBeTruthy();
  });
});
