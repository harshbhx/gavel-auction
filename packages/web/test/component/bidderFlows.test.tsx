import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Cents, type BidderId, type RoomSnapshot } from '@gavel/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { en } from '../../src/copy/en';
import { holdErrorCopyTable } from '../../src/copy/errors';
import { t } from '../../src/copy/t';
import { confirmHold } from '../support/approveHold';
import { loadSession, saveHighBid, saveSession } from '../../src/net/session';
import { resetApprovalMemory } from '../../src/payments/useApproval';
import { saveRegistration } from '../../src/payments/registrationStore';
import { REJECTION_CLEAR_MS } from '../../src/screens/bid/BidScreen';
import { UNAVAILABLE_RETRY_MS } from '../../src/screens/register/Approve';
import { roomStore } from '../../src/store/roomStore';
import { clearAuctioneerToken } from '../../src/store/session';
import {
  BASE_TIME,
  auctionId,
  baseConfig,
  bidderId,
  openSnapshot,
  priceMsg,
  roster,
  stateMsg,
} from '../../src/testing/builders';
import { NO_AMOUNT } from '../../src/util/money';

const ROOM = auctionId(7);
const ME = bidderId(1);
const API = { apiBase: 'http://api.test', payments: 'paypal', paypalClientId: 'none' } as const;

class FakeSocket {
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  send(data: string): void {
    this.sent.push(data);
  }
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
  frames(kind: string): Array<Record<string, unknown>> {
    return this.sent
      .map((s) => JSON.parse(s) as Record<string, unknown>)
      .filter((f) => f['t'] === kind);
  }
}

function lastSocket(): FakeSocket {
  const s = FakeSocket.all.at(-1);
  if (s === undefined) throw new Error('no socket was opened');
  return s;
}

function snapshot(
  opts: {
    status?: RoomSnapshot['status'];
    presets?: number[];
    others?: Array<[number, string]>;
    me?: BidderId;
    highBid?: number;
  } = {},
): RoomSnapshot {
  const config = { ...baseConfig, ceilingPresets: (opts.presets ?? [10_000, 50_000]).map(Cents) };
  const list = [...roster(...(opts.others ?? [[1, 'Priya']]))];
  const base = openSnapshot(list, config, opts.status ?? 'OPEN', ROOM);
  return {
    ...base,
    you: {
      bidderId: opts.me ?? ME,
      ceiling: Cents(100_000),
      ...(opts.highBid === undefined ? {} : { highBid: Cents(opts.highBid) }),
    },
  };
}

function joinLive(path: string, props: { api?: typeof API } = {}): FakeSocket {
  render(<App initialPath={path} liveBase="ws://x" {...props} />);
  const socket = lastSocket();
  act(() => socket.open());
  return socket;
}

beforeEach(() => {
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

describe('server refusals on the live routes', () => {
  it('stops reconnecting, forgets the token and offers a fresh link when the token is refused', () => {
    vi.useFakeTimers();
    saveSession(ROOM, { token: 'heron', bidderId: ME });
    const socket = joinLive(`/r/${ROOM}/bid`);
    act(() => socket.receive({ v: 1, t: 'error', code: 'unauthorized', message: 'refused' }));
    expect(screen.getByText(t('err.tokenMissing'))).toBeTruthy();
    expect(screen.getByRole('link', { name: t('err.rejoin') }).getAttribute('href')).toBe(
      `/join/${ROOM}`,
    );
    expect(screen.queryByText(t('bid.waitingLot'))).toBeNull();
    expect(loadSession(ROOM)).toBeNull();
    act(() => {
      socket.onclose?.();
      vi.advanceTimersByTime(60_000);
    });
    expect(FakeSocket.all).toHaveLength(1);
  });

  it('shows the wait for a rate limit and joins again only when asked', () => {
    saveSession(ROOM, { token: 'heron', bidderId: ME });
    const socket = joinLive(`/r/${ROOM}/bid`);
    act(() =>
      socket.receive({
        v: 1,
        t: 'error',
        code: 'rate_limited',
        message: 'slow down',
        retryAfterMs: 3000,
      }),
    );
    expect(screen.getByText(t('err.room.rateLimited', { seconds: 3 }))).toBeTruthy();
    expect(loadSession(ROOM)).not.toBeNull();
    expect(FakeSocket.all).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: t('generic.retry') }));
    expect(FakeSocket.all).toHaveLength(2);
    expect(screen.queryByText(t('err.room.rateLimited', { seconds: 3 }))).toBeNull();
  });

  it('says the room is full on the screen route', () => {
    window.history.replaceState(null, '', '/#token=otter');
    const socket = joinLive(`/r/${ROOM}/screen`);
    act(() => socket.receive({ v: 1, t: 'error', code: 'room_full', message: 'full' }));
    expect(screen.getByText(t('err.room.full'))).toBeTruthy();
  });

  it('shows a refused token on the receipt route', () => {
    saveSession(ROOM, { token: 'heron', bidderId: ME });
    const socket = joinLive(`/r/${ROOM}/receipt`);
    act(() => socket.receive({ v: 1, t: 'error', code: 'forbidden', message: 'refused' }));
    expect(screen.getByText(t('err.tokenMissing'))).toBeTruthy();
    expect(loadSession(ROOM)).toBeNull();
  });

  it('keeps the bid screen and shows other server errors above it', () => {
    saveSession(ROOM, { token: 'heron', bidderId: ME });
    const socket = joinLive(`/r/${ROOM}/bid`);
    act(() => socket.receive(stateMsg(1, snapshot())));
    act(() =>
      socket.receive({ v: 1, t: 'error', code: 'store_unavailable', message: 'try later' }),
    );
    expect(screen.getByTestId('room-error').textContent).toContain(t('generic.error'));
    expect(screen.getByRole('button', { name: t('bid.quick', { amount: '$50' }) })).toBeTruthy();
  });
});

describe('sessions per role', () => {
  it('keeps the bidder session when the same tab opens the screen route', () => {
    saveSession(ROOM, { token: 'heron', bidderId: ME });
    window.history.replaceState(null, '', '/#token=otter');
    const socket = joinLive(`/r/${ROOM}/screen`);
    expect(socket.frames('join')[0]?.['token']).toBe('otter');
    expect(loadSession(ROOM)).toEqual({ token: 'heron', bidderId: ME });
    expect(loadSession(ROOM, undefined, 'screen')).toBeNull();
  });

  it('never presents a bidder token on the screen route', () => {
    saveSession(ROOM, { token: 'heron', bidderId: ME });
    render(<App initialPath={`/r/${ROOM}/screen`} liveBase="ws://x" />);
    expect(FakeSocket.all).toHaveLength(0);
  });

  it('never presents a bidder token on the console', () => {
    saveSession(ROOM, { token: 'heron', bidderId: ME });
    render(<App initialPath={`/r/${ROOM}/console`} liveBase="ws://x" />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(t('err.tokenMissing'));
    expect(FakeSocket.all).toHaveLength(0);
  });

  it('does not hand one bidder the high bid of another in the same tab', () => {
    saveHighBid(ROOM, bidderId(1), 30_000);
    saveSession(ROOM, { token: 'tern', bidderId: bidderId(2) });
    render(<App initialPath={`/r/${ROOM}/bid`} liveBase="ws://x" />);
    expect(roomStore.getState().ownHighCents).toBe(0);
    cleanup();
    saveSession(ROOM, { token: 'heron', bidderId: bidderId(1) });
    render(<App initialPath={`/r/${ROOM}/bid`} liveBase="ws://x" />);
    expect(roomStore.getState().ownHighCents).toBe(30_000);
  });
});

describe('bid screen', () => {
  it('locks new bids while one is unanswered and settles it from the snapshot after a reconnect', () => {
    vi.useFakeTimers();
    saveSession(ROOM, { token: 'heron', bidderId: ME });
    const socket = joinLive(`/r/${ROOM}/bid`);
    act(() => socket.receive(stateMsg(1, snapshot())));
    fireEvent.click(screen.getByRole('button', { name: t('bid.quick', { amount: '$50' }) }));
    expect(socket.frames('bid')).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(4100);
    });
    expect(screen.getByText(t('bid.unknown'))).toBeTruthy();
    expect(
      screen.getByRole('button', { name: t('bid.resendAmount', { amount: '$50.00' }) }),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: t('bid.quick', { amount: '$100' }) })).toBeNull();
    expect(socket.frames('bid')).toHaveLength(1);

    act(() => socket.receive(stateMsg(2, snapshot({ highBid: 5000 }))));
    expect(screen.queryByText(t('bid.unknown'))).toBeNull();
    expect(screen.getByRole('button', { name: t('bid.quick', { amount: '$100' }) })).toBeTruthy();
  });

  it('has one main landmark on the bid route and on the screen route', () => {
    saveSession(ROOM, { token: 'heron', bidderId: ME });
    const socket = joinLive(`/r/${ROOM}/bid`);
    act(() => socket.receive(stateMsg(1, snapshot())));
    expect(document.querySelectorAll('main')).toHaveLength(1);
    cleanup();
    window.history.replaceState(null, '', '/#token=otter');
    joinLive(`/r/${ROOM}/screen`);
    expect(document.querySelectorAll('main')).toHaveLength(1);
  });

  it('announces a pause and a close to a screen reader', () => {
    saveSession(ROOM, { token: 'heron', bidderId: ME });
    const socket = joinLive(`/r/${ROOM}/bid`);
    act(() => socket.receive(stateMsg(1, snapshot({ status: 'PAUSED' }))));
    expect(screen.getByTestId('live-assertive').textContent).toContain(t('bid.paused'));
    act(() => socket.receive(stateMsg(2, snapshot({ status: 'CLOSING' }))));
    expect(screen.getByTestId('live-assertive').textContent).toContain(t('bid.closedBanner'));
  });

  it('announces that the connection is lost', () => {
    vi.useFakeTimers();
    saveSession(ROOM, { token: 'heron', bidderId: ME });
    const socket = joinLive(`/r/${ROOM}/bid`);
    act(() => socket.receive(stateMsg(1, snapshot())));
    act(() => {
      socket.readyState = 3;
      socket.onclose?.();
      vi.advanceTimersByTime(2100);
    });
    expect(screen.getByTestId('live-assertive').textContent).toContain(t('net.offline'));
  });

  it('keeps the screen up and shows a dash when one price frame is bad', () => {
    saveSession(ROOM, { token: 'heron', bidderId: ME });
    const socket = joinLive(`/r/${ROOM}/bid`);
    act(() => socket.receive(stateMsg(1, snapshot())));
    act(() =>
      roomStore.dispatch({
        kind: 'wire',
        msg: { ...priceMsg(2, 1, 6000), price: 1.5 as unknown as Cents },
      }),
    );
    expect(screen.queryByText(t('err.boundary'))).toBeNull();
    expect(screen.getAllByText(NO_AMOUNT).length).toBeGreaterThan(0);
  });

  it('opens the confirm sheet for the bidder, announces it and sends one answer', async () => {
    saveSession(ROOM, { token: 'heron', bidderId: ME });
    const socket = joinLive(`/r/${ROOM}/bid`);
    act(() => socket.receive(stateMsg(1, snapshot())));
    act(() =>
      socket.receive({
        v: 1,
        t: 'confirm_request',
        seq: 2,
        ts: BASE_TIME + 2,
        confirmId: 'c1',
        amount: 35_000,
        expiresAt: BASE_TIME + 600_000,
      }),
    );
    const title = t('confirm.title', { amount: '$350.00', n: 1 });
    await screen.findByRole('dialog');
    expect(screen.getAllByText(title).length).toBeGreaterThan(0);
    expect(screen.getByTestId('live-assertive').textContent).toContain(title);
    const yes = screen.getByRole('button', { name: t('confirm.yes') });
    fireEvent.click(yes);
    fireEvent.click(yes);
    expect(socket.frames('confirm_response')).toHaveLength(1);
    expect(socket.frames('confirm_response')[0]?.['accept']).toBe(true);
  });
});

describe('bid screen states and unanswered bids', () => {
  const bidBar = (): HTMLElement | null => screen.queryByTestId('bid-bar');
  const rejectFirstBid = (socket: FakeSocket): void => {
    const mid = socket.frames('bid')[0]?.['mid'];
    act(() =>
      socket.receive({
        v: 1,
        t: 'bid_rejected',
        seq: 2,
        ts: BASE_TIME + 2,
        mid,
        reason: 'below_increment',
        retryable: false,
      }),
    );
  };

  it.each([
    ['paused', 'bid.paused', 'PAUSED', false],
    ['closed', 'bid.closedBanner', 'CLOSING', false],
    ['stopped', 'bid.stoppedBanner', 'OPEN', true],
  ] as const)('shows the %s banner and turns the controls off', (_name, key, status, stopped) => {
    saveSession(ROOM, { token: 'heron', bidderId: ME });
    const socket = joinLive(`/r/${ROOM}/bid`);
    act(() => socket.receive(stateMsg(1, snapshot())));
    expect(bidBar()).not.toBeNull();
    act(() =>
      socket.receive(stateMsg(2, { ...snapshot({ status }), ...(stopped ? { stopped } : {}) })),
    );
    expect(screen.getAllByText(t(key)).length).toBeGreaterThan(0);
    expect(bidBar()).toBeNull();
    expect(screen.queryByRole('button', { name: t('bid.quick', { amount: '$50' }) })).toBeNull();
  });

  it('keeps a rejection until 6000 ms have passed', () => {
    vi.useFakeTimers();
    saveSession(ROOM, { token: 'heron', bidderId: ME });
    const socket = joinLive(`/r/${ROOM}/bid`);
    act(() => socket.receive(stateMsg(1, snapshot())));
    fireEvent.click(screen.getByRole('button', { name: t('bid.quick', { amount: '$50' }) }));
    rejectFirstBid(socket);
    expect(rejection()).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(REJECTION_CLEAR_MS - 100);
    });
    expect(rejection()).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(rejection()).toHaveLength(0);
  });

  it('clears a rejection when the price changes', () => {
    vi.useFakeTimers();
    saveSession(ROOM, { token: 'heron', bidderId: ME });
    const socket = joinLive(`/r/${ROOM}/bid`);
    act(() => socket.receive(stateMsg(1, snapshot())));
    fireEvent.click(screen.getByRole('button', { name: t('bid.quick', { amount: '$50' }) }));
    rejectFirstBid(socket);
    expect(rejection()).toHaveLength(1);
    act(() => socket.receive(priceMsg(3, 2, 8000)));
    expect(rejection()).toHaveLength(0);
  });

  it('offers the current minimum instead of an old amount once the price moved above it', () => {
    vi.useFakeTimers();
    saveSession(ROOM, { token: 'heron', bidderId: ME });
    const socket = joinLive(`/r/${ROOM}/bid`);
    act(() => socket.receive(stateMsg(1, snapshot())));
    fireEvent.click(screen.getByRole('button', { name: t('bid.quick', { amount: '$50' }) }));
    act(() => {
      vi.advanceTimersByTime(4100);
    });
    const old = t('bid.resendAmount', { amount: '$50.00' });
    expect(screen.getByRole('button', { name: old })).toBeTruthy();
    act(() => socket.receive(priceMsg(2, 2, 8000)));
    expect(screen.queryByRole('button', { name: old })).toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: t('bid.resendCurrent', { amount: '$130.00' }) }),
    );
    const bids = socket.frames('bid');
    expect(bids).toHaveLength(2);
    expect(bids[1]?.['amount']).toBe(13_000);
    expect(bids[1]?.['mid']).not.toBe(bids[0]?.['mid']);
    expect(
      screen.queryByRole('button', { name: t('bid.resendCurrent', { amount: '$130.00' }) }),
    ).toBeNull();
  });
});

function stubHolds(
  handler: (url: string) => { status: number; body: unknown },
): Array<{ url: string; body: string }> {
  const calls: Array<{ url: string; body: string }> = [];
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    calls.push({ url, body: String(init?.body ?? '') });
    const res = handler(url);
    return Promise.resolve({
      ok: res.status < 400,
      status: res.status,
      json: () => Promise.resolve(res.body),
    });
  });
  return calls;
}

function fillAndApprove(preset: string): void {
  fireEvent.change(screen.getByLabelText(t('reg.name')), { target: { value: 'Priya' } });
  fireEvent.click(screen.getByRole('button', { name: t('reg.continue') }));
  fireEvent.click(screen.getByRole('radio', { name: preset }));
  confirmHold();
}

/** The inline rejection text; the shared announcer region also has role alert and is left out. */
const rejection = (): HTMLElement[] =>
  screen.queryAllByRole('alert').filter((el) => el.dataset['testid'] !== 'live-assertive');

const flush = async (ms = 50): Promise<void> => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

describe('register route', () => {
  beforeEach(() => {
    saveSession(ROOM, { token: 'heron', bidderId: ME });
  });

  it('offers the ceilings of the room and keeps what was typed after a refusal', async () => {
    vi.useFakeTimers();
    saveSession(ROOM, { token: 'heron', bidderId: bidderId(9) });
    const calls = stubHolds(() => ({ status: 400, body: { error: 'ceiling_out_of_range' } }));
    const socket = joinLive(`/r/${ROOM}/register`, { api: API });
    expect(screen.queryByLabelText(t('reg.name'))).toBeNull();
    act(() =>
      socket.receive(
        stateMsg(
          1,
          snapshot({ presets: [50_000, 150_000], others: [[1, 'Ana']], me: bidderId(9) }),
        ),
      ),
    );
    expect(document.querySelectorAll('main')).toHaveLength(1);
    expect(screen.queryByLabelText(t('reg.paddle'))).toBeNull();
    fireEvent.change(screen.getByLabelText(t('reg.name')), { target: { value: 'Priya' } });
    fireEvent.click(screen.getByRole('button', { name: t('reg.continue') }));
    expect(screen.queryByRole('radio', { name: '$100' })).toBeNull();
    expect(screen.getByRole('radio', { name: '$1,500' })).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: '$500' }));
    confirmHold();
    await flush();
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({ auctionId: ROOM, ceilingCents: 50_000 });
    expect(screen.getByText(en[holdErrorCopyTable.ceiling_out_of_range])).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: t('generic.back') }));
    expect(screen.getByText(t('reg.summary', { name: 'Priya' }))).toBeTruthy();
    expect((screen.getByRole('radio', { name: '$500' }) as HTMLInputElement).checked).toBe(true);
  });

  it('says registration is closed and offers the watch link once the hammer has fallen', () => {
    const socket = joinLive(`/r/${ROOM}/register`, { api: API });
    act(() => socket.receive(stateMsg(1, snapshot({ status: 'DONE' }))));
    expect(screen.getByText(t('reg.closed'))).toBeTruthy();
    expect(screen.getByRole('link', { name: t('reg.watch') }).getAttribute('href')).toBe(
      `/r/${ROOM}/bid`,
    );
  });

  it('refuses a name with an angle bracket before anything is sent', () => {
    const calls = stubHolds(() => ({ status: 200, body: {} }));
    render(<App initialPath={`/r/${ROOM}/register`} api={API} />);
    const field = screen.getByLabelText(t('reg.name'));
    fireEvent.change(field, { target: { value: '<b>Priya' } });
    fireEvent.blur(field);
    expect(screen.getAllByText(t('reg.nameInvalid')).length).toBeGreaterThan(0);
    const next = screen.getByRole('button', { name: t('reg.continue') });
    expect(next.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(next);
    expect(screen.queryByRole('radio', { name: '$100' })).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('shows the name message when the server refuses the approval with a 400', async () => {
    vi.useFakeTimers();
    saveRegistration(ROOM, ME, {
      clientRegistrationId: 'reg-one',
      orderId: 'order-one',
      holdId: 'hold-ABC123',
      ceilingCents: 10_000,
    });
    const calls = stubHolds(() => ({ status: 400, body: { error: 'bad_request' } }));
    render(<App initialPath={`/r/${ROOM}/register`} api={API} />);
    fillAndApprove('$100');
    await flush();
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({ orderId: 'order-one', name: 'Priya' });
    expect(screen.getAllByText(t('reg.nameInvalid')).length).toBeGreaterThan(0);
    expect(screen.queryByTestId('held-card')).toBeNull();
  });

  it('closes registration from the snapshot flag while the lot is still open', () => {
    const socket = joinLive(`/r/${ROOM}/register`, { api: API });
    act(() => socket.receive(stateMsg(1, snapshot())));
    expect(screen.queryByText(t('reg.closed'))).toBeNull();
    act(() => socket.receive(stateMsg(2, { ...snapshot(), registrationClosed: true })));
    expect(screen.getByText(t('reg.closed'))).toBeTruthy();
    expect(screen.getByRole('link', { name: t('reg.watch') }).getAttribute('href')).toBe(
      `/r/${ROOM}/bid`,
    );
  });

  it('switches a live registration page to the closed card on the hammer frame', () => {
    const socket = joinLive(`/r/${ROOM}/register`, { api: API });
    act(() => socket.receive(stateMsg(1, snapshot())));
    expect(screen.getByLabelText(t('reg.name'))).toBeTruthy();
    act(() =>
      socket.receive({
        v: 1,
        t: 'hammer',
        seq: 2,
        ts: BASE_TIME + 2,
        winnerId: null,
        price: Cents(0),
        ranking: [],
        registrationClosed: true,
      }),
    );
    expect(screen.getByText(t('reg.closed'))).toBeTruthy();
    expect(screen.queryByLabelText(t('reg.name'))).toBeNull();
  });

  it('finishes the stored order after a reload instead of asking PayPal again', async () => {
    vi.useFakeTimers();
    saveRegistration(ROOM, ME, {
      clientRegistrationId: 'reg-one',
      orderId: 'order-one',
      holdId: 'hold-ABC123',
      ceilingCents: 10_000,
    });
    const calls = stubHolds(() => ({
      status: 200,
      body: { holdId: 'hold-ABC123', status: 'HELD', ceilingCents: 10_000 },
    }));
    render(<App initialPath={`/r/${ROOM}/register`} api={API} />);
    fillAndApprove('$100');
    await flush();
    expect(calls.map((c) => c.url)).toEqual(['http://api.test/api/holds/hold-ABC123/approve']);
    expect(screen.getByTestId('held-card')).toBeTruthy();
  });

  it('sends the typed name with the approval and shows the paddle the room assigned', async () => {
    vi.useFakeTimers();
    saveRegistration(ROOM, ME, {
      clientRegistrationId: 'reg-one',
      orderId: 'order-one',
      holdId: 'hold-ABC123',
      ceilingCents: 10_000,
    });
    const calls = stubHolds(() => ({
      status: 200,
      body: { holdId: 'hold-ABC123', status: 'HELD', ceilingCents: 10_000 },
    }));
    const socket = joinLive(`/r/${ROOM}/register`, { api: API });
    act(() => socket.receive(stateMsg(1, snapshot({ others: [[7, 'Ana']] }))));
    expect(screen.queryByLabelText(t('reg.paddle'))).toBeNull();
    fillAndApprove('$100');
    await flush();
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({ orderId: 'order-one', name: 'Priya' });
    expect(screen.getByTestId('held-card')).toBeTruthy();
    expect(screen.queryByText(t('reg.yourPaddle', { n: 1 }))).toBeNull();
    act(() =>
      socket.receive(
        stateMsg(
          2,
          snapshot({
            others: [
              [7, 'Ana'],
              [1, 'Priya'],
            ],
          }),
        ),
      ),
    );
    expect(screen.getByText(t('reg.yourPaddle', { n: 1 }))).toBeTruthy();
  });

  it('finishes on the return route with the ceiling stored at registration', async () => {
    vi.useFakeTimers();
    saveRegistration(ROOM, ME, {
      clientRegistrationId: 'reg-one',
      orderId: 'order-one',
      holdId: 'hold-ABC123',
      ceilingCents: 25_000,
      name: 'Priya',
    });
    const calls = stubHolds(() => ({
      status: 200,
      body: { holdId: 'hold-ABC123', status: 'HELD', ceilingCents: 25_000 },
    }));
    window.history.replaceState(null, '', `/r/${ROOM}/return?token=order-one`);
    render(<App initialPath={`/r/${ROOM}/return`} api={API} />);
    await flush();
    expect(calls.map((c) => c.url)).toEqual(['http://api.test/api/holds/hold-ABC123/approve']);
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({ orderId: 'order-one', name: 'Priya' });
    expect(screen.getByText(t('reg.held', { amount: '$250' }))).toBeTruthy();
  });

  it('sends the buyer back to register when the return has no stored ceiling', async () => {
    vi.useFakeTimers();
    saveRegistration(ROOM, ME, {
      clientRegistrationId: 'reg-one',
      orderId: 'order-one',
      holdId: 'hold-ABC123',
    });
    const calls = stubHolds(() => ({ status: 200, body: {} }));
    window.history.replaceState(null, '', `/r/${ROOM}/return?token=order-one`);
    render(<App initialPath={`/r/${ROOM}/return`} api={API} />);
    await flush();
    expect(window.location.pathname).toBe(`/r/${ROOM}/register`);
    expect(calls).toHaveLength(0);
  });

  const CODES = [
    'hold_exists',
    'ceiling_out_of_range',
    'order_not_found',
    'order_not_approved',
    'paypal_unavailable',
    'kill_switch_engaged',
    'payments_not_sandbox',
  ] as const;

  it.each(CODES)('shows its own text and next step for %s', async (code) => {
    vi.useFakeTimers();
    const calls = stubHolds(() => ({
      status: code === 'hold_exists' ? 409 : 503,
      body: { error: code },
    }));
    render(<App initialPath={`/r/${ROOM}/register`} api={API} />);
    fillAndApprove('$100');
    await flush();
    expect(screen.getByText(en[holdErrorCopyTable[code]])).toBeTruthy();
    const retry = screen.queryByRole('button', { name: t('generic.retry') });
    if (code === 'hold_exists') {
      expect(screen.getByRole('button', { name: t('reg.continue') })).toBeTruthy();
      expect(retry).toBeNull();
    } else if (code === 'order_not_approved') {
      expect(retry?.getAttribute('aria-disabled')).toBeNull();
    } else if (code === 'paypal_unavailable' || code === 'kill_switch_engaged') {
      expect(retry?.getAttribute('aria-disabled')).toBe('true');
      await flush(UNAVAILABLE_RETRY_MS);
      expect(
        screen.getByRole('button', { name: t('generic.retry') }).getAttribute('aria-disabled'),
      ).toBeNull();
    } else {
      expect(retry).toBeNull();
      expect(
        screen.getByRole('button', {
          name: t(code === 'order_not_found' ? 'reg.startAgain' : 'generic.back'),
        }),
      ).toBeTruthy();
    }
    expect(calls).toHaveLength(1);
  });
});
