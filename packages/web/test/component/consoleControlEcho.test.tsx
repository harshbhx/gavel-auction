import type { AuctionId } from '@gavel/shared';
import { EpochMs } from '@gavel/shared';
import { act, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { t } from '../../src/copy/t';
import { formatServerTime } from '../../src/screens/console/BidStream';
import { clearAuctioneerToken } from '../../src/store/session';
import {
  BASE_TIME,
  baseConfig,
  bidId,
  bidderId,
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
    // Nothing is read back here.
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

function controlFrame(seq: number, action: string, outcome: 'accepted' | 'rejected') {
  return {
    v: 1,
    t: 'audit_event',
    seq,
    ts: EpochMs(BASE_TIME + seq),
    audit: {
      bidId: bidId(seq),
      bidderId: bidderId(90),
      source: 'manual',
      outcome,
      reason: `control:${action}`,
      serverTs: EpochMs(BASE_TIME + seq),
      seq,
    },
  };
}

function renderConsole(): void {
  window.history.pushState(null, '', `${CONSOLE}#token=pelican`);
  render(<App initialPath={CONSOLE} liveBase="ws://localhost:1" />);
  act(() => {
    FakeSocket.last?.onopen?.();
  });
  deliver(stateMsg(1, openSnapshot(roster([12, 'Priya']), baseConfig, 'OPEN', ROOM as AuctionId)));
  deliver(priceMsg(2, 12, 40_000));
}

beforeEach(() => {
  FakeSocket.last = null;
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
  clearAuctioneerToken();
  window.sessionStorage.clear();
  window.history.pushState(null, '', '/');
});

describe('console stream echoes control results (#535)', () => {
  const cases = [
    ['open', 'console.echo.open'],
    ['pause', 'console.echo.pause'],
    ['resume', 'console.echo.resume'],
    ['extend', 'console.echo.extend'],
    ['hammer', 'console.echo.hammer'],
  ] as const;

  it.each(cases)('adds a %s row with its time and result', (action, key) => {
    renderConsole();
    deliver(controlFrame(5, action, 'accepted'));
    const stream = screen.getByRole('region', { name: t('console.stream') });
    const item = within(stream).getByText(t(key)).closest('li');
    if (item === null) throw new Error('row missing');
    expect(item.getAttribute('data-kind')).toBe('control');
    expect(item.getAttribute('data-control')).toBe(action);
    expect(within(item).getByText(formatServerTime(BASE_TIME + 5))).toBeTruthy();
    expect(within(item).getByText(t('console.status.accepted'))).toBeTruthy();
  });

  it('shows a refused control as rejected', () => {
    renderConsole();
    deliver(controlFrame(6, 'pause', 'rejected'));
    const item = screen.getByText(t('console.echo.pause')).closest('li');
    if (item === null) throw new Error('row missing');
    expect(within(item).getByText(t('console.status.rejected'))).toBeTruthy();
  });

  it('keeps the controls visible but disabled when the socket is down', () => {
    renderConsole();
    act(() => {
      FakeSocket.last?.onclose?.();
    });
    const names = [
      t('console.pause'),
      t('console.resume'),
      t('console.extend', { s: 30 }),
      t('console.hammer'),
    ];
    for (const name of names) {
      expect(screen.getByRole('button', { name }).getAttribute('aria-disabled')).toBe('true');
    }
  });
});
