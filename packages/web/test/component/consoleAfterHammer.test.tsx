import type { AuctionId } from '@gavel/shared';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { t } from '../../src/copy/t';
import { LadderCompact } from '../../src/ladder/LadderCompact';
import type { SettlementView } from '../../src/ladder/ladderModel';
import { HAMMER_HOLD_SECONDS } from '../../src/screens/console/hammerHold';
import { roomStore } from '../../src/store/roomStore';
import { clearAuctioneerToken } from '../../src/store/session';
import {
  baseConfig,
  bidderId,
  openSnapshot,
  priceMsg,
  roster,
  stateMsg,
} from '../../src/testing/builders';
import { formatUsd } from '../../src/util/money';

const ROOM = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

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

const deliver = (msg: unknown): void =>
  act(() => {
    FakeSocket.last?.onmessage?.({ data: JSON.stringify(msg) });
  });

function hammerMsg(winner: number | null, price: number, seq = 3): unknown {
  return {
    v: 1,
    t: 'hammer',
    seq,
    ts: 1,
    winnerId: winner === null ? null : bidderId(winner),
    price,
    ranking: [],
  };
}

beforeEach(() => {
  FakeSocket.last = null;
  roomStore.enter('');
  vi.stubGlobal('WebSocket', FakeSocket);
  window.history.pushState(null, '', `/r/${ROOM}/console#token=pelican`);
  render(<App initialPath={`/r/${ROOM}/console`} liveBase="ws://localhost:1" />);
  act(() => {
    FakeSocket.last?.onopen?.();
  });
  deliver(
    stateMsg(
      1,
      openSnapshot(roster([12, 'Priya'], [7, 'Sam']), baseConfig, 'OPEN', ROOM as AuctionId),
    ),
  );
  deliver(priceMsg(2, 12, 40_000));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  clearAuctioneerToken();
  roomStore.enter('');
  window.sessionStorage.clear();
  window.history.pushState(null, '', '/');
});

describe('console right after the hammer', () => {
  it('shows the sale, stops the clock and drops the hammer panel', () => {
    expect(screen.getByText(t('console.hammerDesk', { s: HAMMER_HOLD_SECONDS }))).toBeTruthy();
    deliver(hammerMsg(12, 40_000));
    expect(
      screen.getByText(t('console.result.sold', { n: 12, amount: formatUsd(40_000) })),
    ).toBeTruthy();
    expect(screen.getByText(t('console.clockClosed'))).toBeTruthy();
    expect(screen.queryByText(t('console.hammerDesk', { s: HAMMER_HOLD_SECONDS }))).toBeNull();
    expect(screen.queryByText(t('console.hammerDialogHint'))).toBeNull();
  });

  it('shows no held-hold chips or hold counts once the lot is closed', () => {
    expect(screen.getAllByText(t('console.ladder.held')).length).toBeGreaterThan(0);
    deliver(hammerMsg(12, 40_000));
    expect(screen.queryByText(t('console.ladder.held'))).toBeNull();
    expect(screen.getByText(t('console.ladder.winner'))).toBeTruthy();
    expect(screen.getByText(t('console.biddersClosed', { n: 2 }))).toBeTruthy();
  });

  it('adds no sale line for an unsold hammer: the status says stopped or closing', () => {
    deliver(hammerMsg(null, 40_000));
    expect(screen.queryByText(/^Sold to paddle/)).toBeNull();
    expect(screen.getByText(t('console.clockClosed'))).toBeTruthy();
  });
});

describe('settlement line without per-hold lanes', () => {
  const view = (phase: SettlementView['phase']): SettlementView =>
    ({
      lotId: ROOM,
      phase,
      winnerPaddle: 2,
      holds: [],
      invariants: { ok: false, violations: [], unreported: true },
      counts: { CAPTURED: 1, SETTLED: 1 },
    }) as unknown as SettlementView;

  it('agrees with the counts and is the only settlement line', () => {
    render(<LadderCompact view={view('SETTLED')} />);
    expect(screen.getByText('1 charged, 1 released')).toBeTruthy();
    expect(screen.queryByText(`1 ${t('ladder.state.SETTLED')}`)).toBeNull();
  });

  it('lists the counts while settlement is still running', () => {
    render(<LadderCompact view={view('CAPTURING')} />);
    expect(screen.queryByText(/captured,/)).toBeNull();
    expect(screen.getByText(`1 ${t('ladder.state.SETTLED')}`)).toBeTruthy();
  });
});
