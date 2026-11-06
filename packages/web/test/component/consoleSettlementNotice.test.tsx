import type { AuctionId } from '@gavel/shared';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { t } from '../../src/copy/t';
import { clearAuctioneerToken } from '../../src/store/session';
import {
  BASE_TIME,
  baseConfig,
  openSnapshot,
  priceMsg,
  roster,
  stateMsg,
} from '../../src/testing/builders';

const ROOM = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const CONSOLE = `/r/${ROOM}/console`;

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
    // Nothing is checked here.
  }
  close(): void {
    // Nothing to release.
  }
}

function deliver(msg: unknown): void {
  act(() => {
    FakeSocket.last?.onmessage?.({ data: JSON.stringify(msg) });
  });
}

function hammer(seq: number): unknown {
  return {
    v: 1,
    t: 'hammer',
    seq,
    ts: BASE_TIME + seq,
    winnerId: null,
    price: 40_000,
    ranking: [],
  };
}

function settlement(seq: number, auctionState: string): unknown {
  return {
    v: 1,
    t: 'settlement_update',
    seq,
    ts: BASE_TIME + seq,
    rev: seq,
    auctionState,
    winnerPaddle: 12,
    ladder: { counts: { [auctionState]: 1 } },
  };
}

function openConsole(): void {
  window.history.pushState(null, '', `${CONSOLE}#token=pelican`);
  render(<App initialPath={CONSOLE} liveBase="ws://localhost:1" />);
  act(() => {
    FakeSocket.last?.onopen?.();
  });
  deliver(stateMsg(1, openSnapshot(roster([12, 'Priya']), baseConfig, 'OPEN', ROOM as AuctionId)));
  deliver(priceMsg(2, 12, 40_000));
  deliver(hammer(3));
}

beforeEach(() => {
  FakeSocket.last = null;
  vi.stubGlobal('WebSocket', FakeSocket);
});
afterEach(() => {
  vi.unstubAllGlobals();
  clearAuctioneerToken();
  window.sessionStorage.clear();
  window.history.pushState(null, '', '/');
});

describe('console settlement notice', () => {
  it('raises an alert and shows the counts when the capture needs review', () => {
    openConsole();
    deliver(settlement(4, 'FAILED_NEEDS_REVIEW'));
    const alerts = screen.getAllByRole('alert').map((el) => el.textContent);
    expect(alerts).toContain(t('console.settlement.needsReview'));
    const counts = screen.getByRole('list', { name: t('ladder.counts') });
    expect(counts.textContent).toBe(`1 ${t('ladder.state.FAILED_NEEDS_REVIEW')}`);
  });

  it('shows a status and no alert while the capture is in progress', () => {
    openConsole();
    deliver(settlement(4, 'CAPTURING'));
    const statuses = screen.getAllByRole('status').map((el) => el.textContent);
    expect(statuses).toContain(t('console.settlement.inProgress'));
    const alerts = screen.queryAllByRole('alert').map((el) => el.textContent);
    expect(alerts).not.toContain(t('console.settlement.needsReview'));
  });
});
