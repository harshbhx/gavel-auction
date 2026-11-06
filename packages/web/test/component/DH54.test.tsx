import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Cents, EpochMs } from '@gavel/shared';
import { App } from '../../src/App';
import { t } from '../../src/copy/t';
import { clearAuctioneerToken } from '../../src/store/session';
import { roomStore } from '../../src/store/roomStore';
import {
  BASE_TIME,
  auctionId,
  baseConfig,
  bidderId,
  openSnapshot,
  roster,
  stateMsg,
} from '../../src/testing/builders';
import { happy } from '../../src/testing/scenarios/happy';
import type { SettlementUpdateMsg } from '../../src/wire';

const ROOM = auctionId(54);
const API = { apiBase: 'http://api.test', payments: 'fake', paypalClientId: 'none' } as const;

class FakeSocket {
  static all: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  readyState = 0;
  constructor() {
    FakeSocket.all.push(this);
  }
  send(): void {
    // Nothing is read back in these tests.
  }
  close(): void {
    // Nothing to release.
  }
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

function settlement(): SettlementUpdateMsg {
  const hold = { verifiedBy: [], idSuffix: 'abc123' };
  return {
    v: 1,
    t: 'settlement_update',
    seq: 5,
    ts: EpochMs(BASE_TIME + 5),
    rev: 1,
    auctionState: 'SETTLED',
    winnerPaddle: 7,
    holds: [
      { ...hold, paddle: 7, state: 'CAPTURED', capturedCents: 25_000, releasedCents: 0 },
      { ...hold, paddle: 8, state: 'SETTLED', capturedCents: 0, releasedCents: 10_000 },
      { ...hold, paddle: 9, state: 'SETTLED', capturedCents: 0, releasedCents: 10_000 },
    ],
  };
}

function openLot(): void {
  const snap = {
    ...openSnapshot(roster([7, 'Eve']), baseConfig, 'OPEN', ROOM),
    price: Cents(12_000),
  };
  roomStore.dispatch({ kind: 'wire', msg: stateMsg(1, snap, BASE_TIME) });
}

describe('public screen route', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE_TIME);
    FakeSocket.all = [];
    vi.stubGlobal('WebSocket', FakeSocket);
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse({ title: 'Walnut sideboard', status: 'OPEN' }))),
    );
    window.history.pushState(null, '', `/r/${ROOM}/screen#token=pelican`);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    clearAuctioneerToken();
    window.sessionStorage.clear();
    window.history.pushState(null, '', '/');
  });

  async function mount(): Promise<void> {
    render(<App initialPath={`/r/${ROOM}/screen`} liveBase="ws://localhost:1" api={API} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }

  it('shows the real lot title and never the auction id', async () => {
    await mount();
    expect(screen.getByRole('heading', { level: 1, name: 'Walnut sideboard' })).toBeTruthy();
    expect(screen.queryByText(ROOM)).toBeNull();
    expect(screen.queryByText(/^Join:/)).toBeNull();
  });

  it('keeps a polite live region for the price', async () => {
    await mount();
    act(() => openLot());
    expect(screen.getByTestId('screen-price').textContent).toBe('$120.00');
    const spoken = screen.getByText(t('screen.priceAnnounce', { amount: '$120.00' }));
    expect(spoken.getAttribute('aria-live')).toBe('polite');
  });

  it('freezes the clock and shows the reconnecting chip when the socket drops', async () => {
    await mount();
    act(() => openLot());
    act(() => FakeSocket.all[0]?.onclose?.());
    expect(screen.queryByText(t('net.reconnecting'))).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_100);
    });
    expect(screen.getByText(t('net.reconnecting'))).toBeTruthy();
    expect(document.querySelector('.gv-screen__frozen')).not.toBeNull();
    const frozenText = document.querySelector('.gv-screen__clock')?.textContent ?? '';
    expect(frozenText).toContain(t('screen.clockFrozen'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(document.querySelector('.gv-screen__clock')?.textContent).toBe(frozenText);
    expect(screen.getByTestId('screen-price').textContent).toBe('$120.00');
  });

  it('shows SOLD with the settlement summary after the settlement update', async () => {
    await mount();
    const done = {
      ...openSnapshot(roster([7, 'Eve']), baseConfig, 'DONE', ROOM),
      price: Cents(25_000),
      leaderId: bidderId(7),
    };
    act(() => roomStore.dispatch({ kind: 'wire', msg: stateMsg(4, done, BASE_TIME) }));
    expect(screen.getByTestId('sold').textContent).toContain('SOLD to paddle 7 for $250.00');
    expect(screen.queryByTestId('settle-summary')).toBeNull();
    act(() => roomStore.dispatch({ kind: 'wire', msg: settlement() }));
    expect(screen.getByTestId('settle-summary').textContent).toBe('1 captured, 2 released');
  });
});

describe('replay route', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads the bundle for the recording id and shows the read-only replay', async () => {
    const bundle = {
      version: 1,
      title: 'Spring Gala demo',
      events: happy.steps.flatMap((s) => (s.emit === undefined ? [] : [{ t: s.at, msg: s.emit }])),
    };
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(bundle)));
    vi.stubGlobal('fetch', fetchMock);
    const { container } = render(<App initialPath="/replay/rec-one" />);
    expect(container.querySelector('[data-route="replay"]')).not.toBeNull();
    expect(await screen.findByText('Spring Gala demo')).toBeTruthy();
    expect(screen.getByText(t('prov.recorded'))).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('/recordings/rec-one/events.json');
  });

  it('shows the invalid notice when the bundle cannot be read', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('no', { status: 404 }))),
    );
    render(<App initialPath="/replay/missing" />);
    expect(await screen.findByText(t('replay.invalid'))).toBeTruthy();
  });
});
