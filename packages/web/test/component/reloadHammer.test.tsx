import type { AuctionId } from '@gavel/shared';
import { Cents } from '@gavel/shared';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAuctioneerToken } from '../../src/store/session';
import { App, ReceiptRoute } from '../../src/App';
import { t } from '../../src/copy/t';
import { initialRoomState, reduce } from '../../src/store/roomReducer';
import { roomStore } from '../../src/store/roomStore';
import { selectors } from '../../src/store/selectors';
import {
  baseConfig,
  bidderId,
  openSnapshot,
  priceMsg,
  roster,
  stateMsg,
} from '../../src/testing/builders';
import type { RoomSnapshot } from '../../src/wire';

const ROOM = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

/** What a fresh load gets after a hammer: a snapshot only, no hammer frame. */
function afterHammer(winner: number | null): RoomSnapshot {
  return {
    ...openSnapshot(roster([1, 'Ana'], [2, 'Ben']), baseConfig, 'SETTLING', ROOM as AuctionId),
    you: { bidderId: bidderId(2), ceiling: Cents(30000) },
    stopped: true,
    hammer: { winnerId: winner === null ? null : bidderId(winner), price: Cents(35000) },
    settlement: { rev: 1, auctionState: 'VOIDING', you: 'VOIDING' },
  };
}

describe('a reloaded page after the hammer', () => {
  it('builds the hammer from the snapshot', () => {
    const next = reduce(initialRoomState(ROOM), {
      kind: 'wire',
      msg: stateMsg(1, afterHammer(1)),
    }).state;
    expect(next.hammer?.winnerId).toBe(bidderId(1));
    expect(next.hammer?.price).toBe(35000);
    expect(selectors.stopped(next)).toBe(false);
  });

  it('still reads an unsold hammer as stopped', () => {
    const next = reduce(initialRoomState(ROOM), {
      kind: 'wire',
      msg: stateMsg(1, afterHammer(null)),
    }).state;
    expect(next.hammer?.winnerId).toBeNull();
    expect(selectors.stopped(next)).toBe(true);
  });

  it('keeps no hammer when the snapshot has none and the lot is open', () => {
    const next = reduce(initialRoomState(ROOM), {
      kind: 'wire',
      msg: stateMsg(1, openSnapshot(roster([1, 'Ana']), baseConfig, 'OPEN', ROOM as AuctionId)),
    }).state;
    expect(next.hammer).toBeNull();
  });
});

describe('receipt page after a reload', () => {
  beforeEach(() => {
    roomStore.enter('');
  });
  afterEach(cleanup);

  it('shows the receipt and share controls for a sold lot, not "stopped"', () => {
    act(() => roomStore.dispatch({ kind: 'wire', msg: stateMsg(1, afterHammer(1)) }));
    render(<ReceiptRoute roomId={ROOM} share={() => Promise.resolve(null)} />);
    expect(screen.queryByText(t('screen.stopped'))).toBeNull();
    expect(screen.queryByText(t('receipt.none'))).toBeNull();
    expect(screen.getByText(t('receipt.share.title'))).toBeTruthy();
  });

  it('says stopped for an unsold lot', () => {
    act(() => roomStore.dispatch({ kind: 'wire', msg: stateMsg(1, afterHammer(null)) }));
    render(<ReceiptRoute roomId={ROOM} />);
    expect(screen.getByText(t('screen.stopped'))).toBeTruthy();
  });

  it('keeps the held, not charged wording for a settlement that needs review', () => {
    const snap = afterHammer(1);
    act(() =>
      roomStore.dispatch({
        kind: 'wire',
        msg: stateMsg(1, {
          ...snap,
          settlement: { rev: 2, auctionState: 'FAILED_NEEDS_REVIEW', you: 'FAILED_NEEDS_REVIEW' },
        }),
      }),
    );
    const { container } = render(<ReceiptRoute roomId={ROOM} />);
    expect(container.textContent).toContain(t('ladder.state.FAILED_NEEDS_REVIEW'));
    expect(container.textContent).toMatch(/held, not charged/);
  });
});

class FakeSocket {
  static last: FakeSocket | null = null;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  readyState = 1;
  constructor() {
    FakeSocket.last = this;
  }
  send(): void {
    // Nothing to send.
  }
  close(): void {
    // Nothing to release.
  }
}

describe('console after the hammer frame', () => {
  beforeEach(() => {
    FakeSocket.last = null;
    vi.stubGlobal('WebSocket', FakeSocket);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    clearAuctioneerToken();
    roomStore.enter('');
    window.sessionStorage.clear();
    window.history.pushState(null, '', '/');
  });
  const deliver = (msg: unknown): void =>
    act(() => {
      FakeSocket.last?.onmessage?.({ data: JSON.stringify(msg) });
    });

  it('stops saying the lot is open for bids', () => {
    window.history.pushState(null, '', `/r/${ROOM}/console#token=pelican`);
    render(<App initialPath={`/r/${ROOM}/console`} liveBase="ws://localhost:1" />);
    act(() => {
      FakeSocket.last?.onopen?.();
    });
    deliver(
      stateMsg(1, openSnapshot(roster([12, 'Priya']), baseConfig, 'OPEN', ROOM as AuctionId)),
    );
    deliver(priceMsg(2, 12, 40_000));
    expect(screen.getAllByText(t('console.guide.state.open')).length).toBeGreaterThan(0);
    deliver({
      v: 1,
      t: 'hammer',
      seq: 3,
      ts: 1,
      winnerId: bidderId(12),
      price: 40_000,
      ranking: [],
      stopped: true,
    });
    expect(screen.queryByText(t('console.guide.state.open'))).toBeNull();
    expect(screen.getAllByText(t('console.guide.state.closing')).length).toBeGreaterThan(0);
  });
});
