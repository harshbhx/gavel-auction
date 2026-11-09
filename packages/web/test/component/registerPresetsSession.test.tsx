import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Cents, type RoomSnapshot } from '@gavel/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { t } from '../../src/copy/t';
import { confirmHold } from '../support/approveHold';
import { saveSession } from '../../src/net/session';
import { resetApprovalMemory } from '../../src/payments/useApproval';
import { roomStore } from '../../src/store/roomStore';
import { clearAuctioneerToken } from '../../src/store/session';
import {
  auctionId,
  baseConfig,
  bidderId,
  openSnapshot,
  roster,
  stateMsg,
} from '../../src/testing/builders';

const ROOM = auctionId(7);
const ME = bidderId(1);
const API = { apiBase: 'http://api.test', payments: 'fake', paypalClientId: 'none' } as const;
const PRESETS = [30_000, 50_000];

class FakeSocket {
  static all: FakeSocket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  send(): void {}
  close(): void {
    this.readyState = 3;
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }
  receive(msg: object): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

function lastSocket(): FakeSocket {
  const s = FakeSocket.all.at(-1);
  if (s === undefined) throw new Error('no socket was opened');
  return s;
}

function snapshot(): RoomSnapshot {
  const config = { ...baseConfig, ceilingPresets: PRESETS.map(Cents) };
  const base = openSnapshot([...roster([1, 'Priya'])], config, 'OPEN', ROOM);
  return { ...base, you: { bidderId: ME, ceiling: Cents(100_000) } };
}

function stubFetch(): Array<{ url: string; body: string }> {
  const calls: Array<{ url: string; body: string }> = [];
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    calls.push({ url, body: String(init?.body ?? '') });
    let body: unknown = {};
    if (url.endsWith('/join')) body = { sessionToken: 'plainly-fake-session', bidderId: ME };
    else if (url.endsWith('/api/holds')) body = { holdId: 'hold-ABC123', orderId: 'order-one' };
    else body = { holdId: 'hold-ABC123', status: 'HELD', ceilingCents: 30_000 };
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  });
  return calls;
}

const flush = async (ms = 50): Promise<void> => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

function openLive(path: string): FakeSocket {
  render(<App initialPath={path} liveBase="ws://x" api={API} />);
  const socket = lastSocket();
  act(() => socket.open());
  act(() => socket.receive(stateMsg(1, snapshot())));
  return socket;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('WebSocket', FakeSocket);
  resetApprovalMemory();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
  window.history.replaceState(null, '', '/');
  clearAuctioneerToken();
  roomStore.enter('');
  resetApprovalMemory();
  FakeSocket.all = [];
});

describe('register route for a room that lists presets', () => {
  it('offers the presets as quick picks and posts the one chosen', async () => {
    for (const preset of PRESETS) {
      saveSession(ROOM, { token: 'plainly-fake-session', bidderId: ME });
      const calls = stubFetch();
      openLive(`/r/${ROOM}/register`);
      fireEvent.change(screen.getByLabelText(t('reg.name')), { target: { value: 'Priya' } });
      fireEvent.click(screen.getByRole('button', { name: t('reg.continue') }));
      expect(screen.getAllByRole('radio')).toHaveLength(PRESETS.length);
      fireEvent.click(screen.getAllByRole('radio')[PRESETS.indexOf(preset)] as HTMLElement);
      confirmHold();
      await flush();
      const posted = JSON.parse(calls.find((c) => c.url.endsWith('/api/holds'))?.body ?? '{}') as {
        ceilingCents?: number;
      };
      expect(posted.ceilingCents).toBe(preset);
      expect(PRESETS.includes(posted.ceilingCents ?? -1)).toBe(true);
      cleanup();
      FakeSocket.all = [];
      roomStore.enter('');
      resetApprovalMemory();
    }
  });
});

describe('register route with a custom ceiling', () => {
  it('posts the amount the bidder typed when it is inside the room range', async () => {
    saveSession(ROOM, { token: 'plainly-fake-session', bidderId: ME });
    const calls = stubFetch();
    openLive(`/r/${ROOM}/register`);
    fireEvent.change(screen.getByLabelText(t('reg.name')), { target: { value: 'Priya' } });
    fireEvent.click(screen.getByRole('button', { name: t('reg.continue') }));
    fireEvent.change(screen.getByRole('textbox', { name: t('reg.custom') }), {
      target: { value: '420' },
    });
    confirmHold();
    await flush();
    const posted = JSON.parse(calls.find((c) => c.url.endsWith('/api/holds'))?.body ?? '{}') as {
      ceilingCents?: number;
    };
    expect(posted.ceilingCents).toBe(42_000);
  });

  it('uses the cap the server sends in the snapshot as the maximum', () => {
    saveSession(ROOM, { token: 'plainly-fake-session', bidderId: ME });
    stubFetch();
    render(<App initialPath={`/r/${ROOM}/register`} liveBase="ws://x" api={API} />);
    const socket = lastSocket();
    act(() => socket.open());
    act(() => socket.receive(stateMsg(1, { ...snapshot(), maxCeilingCents: Cents(250_000) })));
    fireEvent.change(screen.getByLabelText(t('reg.name')), { target: { value: 'Priya' } });
    fireEvent.click(screen.getByRole('button', { name: t('reg.continue') }));
    expect(screen.getByText(t('reg.customHint', { min: '$1', max: '$2,500' }))).toBeTruthy();
    const field = screen.getByRole('textbox', { name: t('reg.custom') });
    fireEvent.change(field, { target: { value: '2501' } });
    fireEvent.blur(field);
    expect(
      screen
        .getAllByRole('alert')
        .some((a) => (a.textContent ?? '').includes(t('reg.overCap', { max: '$2,500' }))),
    ).toBe(true);
  });
});

describe('register route when the browser blocks storage', () => {
  it('reaches the bid screen from the in-memory session and says the session is not saved', async () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
      clear: () => undefined,
      key: () => null,
      length: 0,
    };
    vi.stubGlobal('sessionStorage', blocked);
    stubFetch();
    window.history.replaceState(null, '', '/#plainly-fake-invite');
    render(<App initialPath={`/r/${ROOM}/register`} liveBase="ws://x" api={API} />);
    await flush();
    act(() => lastSocket().open());
    act(() => lastSocket().receive(stateMsg(2, snapshot())));
    expect(screen.getByText(t('reg.sessionNotSaved'))).toBeTruthy();
    fireEvent.change(screen.getByLabelText(t('reg.name')), { target: { value: 'Priya' } });
    fireEvent.click(screen.getByRole('button', { name: t('reg.continue') }));
    fireEvent.click(screen.getAllByRole('radio')[0] as HTMLElement);
    confirmHold();
    await flush(2000);
    expect(screen.getByTestId('held-card')).toBeTruthy();
    expect(screen.getByText(t('reg.sessionNotSaved'))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: t('reg.continue') }));
    const bidSocket = lastSocket();
    act(() => bidSocket.open());
    act(() => bidSocket.receive(stateMsg(3, snapshot())));
    expect(window.location.pathname).toBe(`/r/${ROOM}/bid`);
    expect(screen.getByRole('button', { name: t('bid.quick', { amount: '$50' }) })).toBeTruthy();
  });
});
