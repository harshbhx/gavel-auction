import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Cents, EpochMs } from '@gavel/shared';
import { App, ReceiptRoute } from '../../src/App';
import { formatCountdown } from '../../src/util/time';
import { formatTime } from '../../src/ui/format';
import { t } from '../../src/copy/t';
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
import type { SettlementUpdateMsg } from '../../src/wire';

const ROOM = auctionId(65);
const CODE = 'QX7K2M';
const API = { apiBase: 'http://api.test', payments: 'fake', paypalClientId: 'none' } as const;

class FakeSocket {
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  readyState = 0;
  send(): void {
    // Nothing is read back in these tests.
  }
  close(): void {
    // Nothing to release.
  }
}

function summary(extra: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({ auctionId: ROOM, title: 'Walnut sideboard', status: 'OPEN', ...extra }),
    { status: 200 },
  );
}

describe('screen and join with a real lot title and short code', () => {
  beforeEach(() => {
    roomStore.dispatch({ kind: 'reset' });
    vi.stubGlobal('WebSocket', FakeSocket);
    window.history.pushState(null, '', `/r/${ROOM}/screen#token=pelican`);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the snapshot title and the 6 character code, never the id', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('{}', { status: 404 }))),
    );
    render(<App initialPath={`/r/${ROOM}/screen`} liveBase="ws://localhost:1" api={API} />);
    const snap = {
      ...openSnapshot(roster([7, 'Eve']), baseConfig, 'OPEN', ROOM),
      price: Cents(12_000),
      lotTitle: 'Brass lantern',
      joinCode: CODE,
    };
    act(() => roomStore.dispatch({ kind: 'wire', msg: stateMsg(1, snap, BASE_TIME) }));
    expect(screen.getByRole('heading', { level: 1, name: 'Brass lantern' })).toBeTruthy();
    expect(screen.getByText(t('screen.join', { code: CODE }))).toBeTruthy();
    expect(screen.getByText(t('screen.join', { code: CODE })).textContent).not.toContain(ROOM);
    expect(screen.getByRole('heading', { level: 1 }).textContent).not.toContain(ROOM);
  });

  it('drops stale clock samples when a new state frame arrives after a reconnect', () => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE_TIME);
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('{}', { status: 404 }))),
    );
    try {
      render(<App initialPath={`/r/${ROOM}/screen`} liveBase="ws://localhost:1" api={API} />);
      const snap = openSnapshot(roster([7, 'Eve']), baseConfig, 'OPEN', ROOM);
      act(() => roomStore.dispatch({ kind: 'wire', msg: stateMsg(1, snap, BASE_TIME + 60_000) }));
      act(() => roomStore.dispatch({ kind: 'wire', msg: stateMsg(2, snap, BASE_TIME) }));
      expect(document.querySelector('.gv-screen__clock')?.textContent).toBe(
        formatCountdown(baseConfig.endTs - BASE_TIME),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('falls back to the public summary for the title and the code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(summary({ joinCode: CODE }))),
    );
    render(<App initialPath={`/r/${ROOM}/screen`} liveBase="ws://localhost:1" api={API} />);
    const snap = openSnapshot(roster([7, 'Eve']), baseConfig, 'OPEN', ROOM);
    act(() => roomStore.dispatch({ kind: 'wire', msg: stateMsg(1, snap, BASE_TIME) }));
    expect(await screen.findByText(t('screen.join', { code: CODE }))).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Walnut sideboard' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 }).textContent).not.toContain(ROOM);
  });

  it('resolves a typed code on the landing page and reaches the join page', async () => {
    const fetchSpy = vi.fn((url: string) => {
      void url;
      return Promise.resolve(summary({ joinCode: CODE }));
    });
    vi.stubGlobal('fetch', fetchSpy);
    window.history.pushState(null, '', '/');
    render(<App initialPath="/" api={API} />);
    fireEvent.change(screen.getByLabelText(t('ui.code.char', { n: 1, length: 6 })), {
      target: { value: CODE },
    });
    fireEvent.click(screen.getByRole('button', { name: t('landing.join') }));
    expect(
      await screen.findByRole('heading', { name: t('join.title', { room: 'Walnut sideboard' }) }),
    ).toBeTruthy();
    expect(fetchSpy.mock.calls.map((c) => c[0])).toContain(`http://api.test/api/auctions/${CODE}`);
    expect(window.location.pathname).toBe(`/join/${ROOM}`);
    expect(screen.getByText(t('join.code', { code: CODE }))).toBeTruthy();
  });

  it('opens /join with the code and links onward with the real id', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(summary({ joinCode: CODE }))),
    );
    render(<App initialPath={`/join/${CODE}`} api={API} />);
    expect(
      await screen.findByRole('heading', { name: t('join.title', { room: 'Walnut sideboard' }) }),
    ).toBeTruthy();
    expect(screen.getByText(t('join.code', { code: CODE }))).toBeTruthy();
    const qr = await screen.findByRole('img');
    expect(qr.getAttribute('aria-label')).toContain(`/join/${ROOM}?c=${CODE}`);
  });
});

function settle(seq: number, state: 'VOIDING' | 'SETTLED'): SettlementUpdateMsg {
  return {
    v: 1,
    t: 'settlement_update',
    seq,
    ts: EpochMs(BASE_TIME + 123_000),
    rev: seq,
    auctionState: state,
    you: state,
    winnerPaddle: 1,
    holds: [
      {
        paddle: 1,
        state: 'CAPTURED',
        capturedCents: 35000,
        releasedCents: 0,
        idSuffix: 'AB12CD',
        verifiedBy: [],
      },
      {
        paddle: 2,
        state,
        capturedCents: 0,
        releasedCents: state === 'SETTLED' ? 30000 : 0,
        idSuffix: 'EF34GH',
        verifiedBy: [],
      },
    ],
    invariants: { ok: true, violations: [] },
  };
}

function loadReceipt(lotTitle: string | undefined, state: 'VOIDING' | 'SETTLED'): void {
  const snap = {
    ...openSnapshot(roster([1, 'Ana'], [2, 'Ben']), baseConfig, 'DONE', ROOM),
    ...(lotTitle === undefined ? {} : { lotTitle }),
    you: { bidderId: bidderId(2), ceiling: Cents(30000) },
    settlement: { rev: 1, auctionState: state, you: state },
  };
  act(() => roomStore.dispatch({ kind: 'wire', msg: stateMsg(1, snap) }));
  act(() =>
    roomStore.dispatch({
      kind: 'wire',
      msg: {
        v: 1,
        t: 'hammer',
        seq: 2,
        ts: EpochMs(BASE_TIME + 2),
        winnerId: bidderId(1),
        price: Cents(35000),
        ranking: [],
      },
    }),
  );
  act(() => roomStore.dispatch({ kind: 'wire', msg: settle(3, state) }));
}

describe('receipt route item and time', () => {
  beforeEach(() => {
    roomStore.dispatch({ kind: 'reset' });
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2031-05-05T05:05:05.000Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('prints the lot title and the server time, not the time of rendering', () => {
    loadReceipt('Brass lantern', 'SETTLED');
    const { container } = render(<ReceiptRoute roomId={ROOM} />);
    expect(screen.getByText('Brass lantern')).toBeTruthy();
    const time = container.querySelector('time');
    expect(time?.textContent).toBe(formatTime(BASE_TIME + 123_000));
    expect(time?.textContent).not.toMatch(/T\d\d:\d\d:\d\d\.\d{3}Z/);
    expect(container.textContent).not.toContain('2031');
    expect(container.textContent).not.toContain(ROOM);
  });

  it('uses a copy label for an untitled lot, never the id', () => {
    loadReceipt(undefined, 'SETTLED');
    const { container } = render(<ReceiptRoute roomId={ROOM} />);
    expect(screen.getByText(t('receipt.untitled'))).toBeTruthy();
    expect(container.textContent).not.toContain(ROOM);
  });

  it('prints no time while the server has not confirmed the final state', () => {
    loadReceipt('Brass lantern', 'VOIDING');
    const { container } = render(<ReceiptRoute roomId={ROOM} />);
    expect(screen.getByText('Brass lantern')).toBeTruthy();
    expect(container.querySelector('time')).toBeNull();
    expect(screen.queryByText(t('receipt.time'))).toBeNull();
  });
});
