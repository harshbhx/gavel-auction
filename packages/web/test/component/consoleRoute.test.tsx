import type { AuctionId } from '@gavel/shared';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { t } from '../../src/copy/t';
import { loadSession, saveSession } from '../../src/net/session';
import { roomStore } from '../../src/store/roomStore';
import { clearAuctioneerToken } from '../../src/store/session';
import { baseConfig, openSnapshot, priceMsg, roster, stateMsg } from '../../src/testing/builders';
import { formatUsd } from '../../src/util/money';

const ROOM = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const CONSOLE = `/r/${ROOM}/console`;

class FakeSocket {
  static last: FakeSocket | null = null;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  readyState = 1;
  frames: string[] = [];
  constructor() {
    FakeSocket.last = this;
  }
  send(data: string): void {
    this.frames.push(data);
  }
  close(): void {
    // Nothing to release.
  }
}

type FetchInit = { body: string; headers: Record<string, string> };
type FetchReply = { ok: boolean; status: number; text?: () => Promise<string> };
const fetchMock = vi.fn((_url: string, _init: FetchInit): Promise<FetchReply> => {
  return Promise.resolve({ ok: true, status: 200 });
});

/** Text of every element with a live role: a message is shown inline and announced too. */
function texts(role: 'status' | 'alert'): string[] {
  return screen.getAllByRole(role).map((el) => el.textContent ?? '');
}

function deliver(msg: unknown): void {
  act(() => {
    FakeSocket.last?.onmessage?.({ data: JSON.stringify(msg) });
  });
}

/** Opens the socket and delivers an open lot at $400 led by paddle 12. */
function openRoom(): void {
  act(() => {
    FakeSocket.last?.onopen?.();
  });
  deliver(stateMsg(1, openSnapshot(roster([12, 'Priya']), baseConfig, 'OPEN', ROOM as AuctionId)));
  deliver(priceMsg(2, 12, 40_000));
}

function renderConsole(): void {
  // The address bar must already show the route: reading the fragment rewrites it.
  window.history.pushState(null, '', `${CONSOLE}#token=pelican`);
  render(<App initialPath={CONSOLE} liveBase="ws://localhost:1" />);
  openRoom();
}

function lastCall(): { url: string; body: Record<string, unknown>; auth: string | undefined } {
  const call = fetchMock.mock.calls.at(-1);
  return {
    url: call?.[0] ?? '',
    body: JSON.parse(call?.[1].body ?? '{}') as Record<string, unknown>,
    auth: call?.[1].headers['authorization'],
  };
}

function holdHammer(): void {
  fireEvent.click(screen.getByRole('button', { name: t('console.hammer') }));
  fireEvent.keyDown(screen.getByRole('button', { name: t('console.hammerHold') }), {
    key: 'Enter',
  });
}

beforeEach(() => {
  FakeSocket.last = null;
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, status: 200 });
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  clearAuctioneerToken();
  roomStore.enter('');
  window.sessionStorage.clear();
  window.history.pushState(null, '', '/');
});

describe('console route access (#1777)', () => {
  it('does not open the console for a bidder session and sends nothing', () => {
    saveSession(ROOM, { token: 'bidderword', bidderId: 'bidder-1' });
    render(<App initialPath={CONSOLE} liveBase="ws://localhost:1" />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(t('err.tokenMissing'));
    expect(screen.queryByRole('form', { name: t('console.manual') })).toBeNull();
    expect(screen.queryByRole('button', { name: t('kill.button') })).toBeNull();
    expect(FakeSocket.last).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the fragment token as the bearer, never the bidder session token', async () => {
    saveSession(ROOM, { token: 'bidderword', bidderId: 'bidder-1' });
    renderConsole();
    fireEvent.click(screen.getByRole('button', { name: t('console.pause') }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(lastCall().auth).toBe('Bearer pelican');
  });

  it('does not start the audit room for a bidder session', () => {
    saveSession(ROOM, { token: 'bidderword', bidderId: 'bidder-1' });
    render(<App initialPath={`/r/${ROOM}/audit`} liveBase="ws://localhost:1" />);
    expect(FakeSocket.last).toBeNull();
  });

  it('keeps the screen token out of session storage', () => {
    window.history.pushState(null, '', `/r/${ROOM}/screen#token=pelican`);
    render(<App initialPath={`/r/${ROOM}/screen`} liveBase="ws://localhost:1" />);
    expect(loadSession(ROOM)).toBeNull();
    expect(window.sessionStorage.length).toBe(0);
  });
});

describe('hammer expectation (#1772)', () => {
  it('sends the price, leader and seq the auctioneer confirmed', async () => {
    renderConsole();
    holdHammer();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(lastCall().body['action']).toBe('hammer');
    expect(lastCall().body['args']).toEqual({
      expectedPriceCents: 40_000,
      expectedLeaderPaddle: 12,
      expectedSeq: 2,
    });
  });

  it('says nothing was hammered when the server refuses with a conflict', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 409 });
    renderConsole();
    holdHammer();
    await waitFor(() => expect(texts('status')).toContain(t('controls.hammerChanged')), {
      timeout: 3000,
    });
  });
});

describe('control timeout (#1773)', () => {
  it('releases busy, reports an unknown outcome and retries under the same id', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(() => new Promise<FetchReply>(() => undefined));
    renderConsole();
    fireEvent.click(screen.getByRole('button', { name: t('console.pause') }));
    // While the request waits, the hammer is still available.
    expect(
      screen.getByRole('button', { name: t('console.hammer') }).getAttribute('aria-disabled'),
    ).not.toBe('true');
    expect(
      screen
        .getByRole('button', { name: t('console.extend', { s: 30 }) })
        .getAttribute('aria-disabled'),
    ).toBe('true');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    const first = JSON.parse(fetchMock.mock.calls[0]?.[1].body ?? '{}') as { controlId: string };
    expect(lastCall().body['controlId']).toBe(first.controlId);
    expect(texts('status')).toContain(t('controls.unknown', { action: t('console.pause') }));
    expect(
      screen
        .getByRole('button', { name: t('console.extend', { s: 30 }) })
        .getAttribute('aria-disabled'),
    ).not.toBe('true');
  });
});

describe('manual entry (#1775)', () => {
  function fill(): void {
    fireEvent.change(screen.getByLabelText(t('console.manual.paddle')), {
      target: { value: '12' },
    });
    fireEvent.change(screen.getByLabelText(t('console.manual.amount')), {
      target: { value: '500' },
    });
  }
  const bids = (): string[] =>
    (FakeSocket.last?.frames ?? []).filter((f) => f.includes('"t":"bid"'));

  it('keeps the amount and says it was not sent when the socket is down', () => {
    renderConsole();
    fill();
    act(() => {
      FakeSocket.last?.onclose?.();
    });
    fireEvent.submit(screen.getByRole('form', { name: t('console.manual') }));
    const amount = screen.getByLabelText(t('console.manual.amount'));
    expect((amount as HTMLInputElement).value).toBe('500');
    expect(screen.getByText(t('console.manual.offline'))).toBeTruthy();
    expect(bids()).toHaveLength(0);
    const send = screen.getByRole('button', { name: t('console.manual.submit') });
    expect(send.getAttribute('aria-disabled')).toBe('true');
  });

  it('shows no answer for a bid that could not go out and resends it under the same id', () => {
    renderConsole();
    fill();
    if (FakeSocket.last !== null) FakeSocket.last.readyState = 3;
    fireEvent.submit(screen.getByRole('form', { name: t('console.manual') }));
    expect(screen.getByText(t('console.manual.unknown'))).toBeTruthy();
    if (FakeSocket.last !== null) FakeSocket.last.readyState = 1;
    fireEvent.click(screen.getByRole('button', { name: t('console.manual.retry') }));
    expect(bids()).toHaveLength(1);
    expect(screen.getByText(t('console.manual.pending'))).toBeTruthy();
  });
});

describe('stop request (#1717)', () => {
  function stop(): void {
    fireEvent.click(screen.getByRole('button', { name: t('kill.button') }));
    fireEvent.change(screen.getByLabelText(t('kill.type')), { target: { value: 'STOP' } });
    fireEvent.keyDown(screen.getByRole('button', { name: t('kill.hold') }), { key: 'Enter' });
  }

  it('explains a 404 from the server', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404 });
    renderConsole();
    stop();
    await waitFor(() => expect(texts('alert')).toContain(t('kill.notAvailable')), {
      timeout: 3000,
    });
    expect(lastCall().url).toContain('/kill');
  });

  it('explains a 409 from the server', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 409 });
    renderConsole();
    stop();
    await waitFor(() => expect(texts('alert')).toContain(t('kill.conflict')), {
      timeout: 3000,
    });
  });

  it('shows the error the server sent for any other refusal', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve('{"error":"store unavailable"}'),
    });
    renderConsole();
    stop();
    await waitFor(
      () =>
        expect(texts('alert')).toContain(t('kill.failedDetail', { detail: 'store unavailable' })),
      { timeout: 3000 },
    );
  });
});

describe('stop switch through the console route (T-WEB-040)', () => {
  const stopButton = (): HTMLElement => screen.getByRole('button', { name: t('kill.hold') });
  function openStopDialog(): void {
    fireEvent.click(screen.getByRole('button', { name: t('kill.button') }));
  }
  function type(text: string): void {
    fireEvent.change(screen.getByLabelText(t('kill.type')), { target: { value: text } });
  }
  const killCalls = (): number => fetchMock.mock.calls.filter((c) => c[0].endsWith('/kill')).length;

  it('keeps Stop disabled until STOP is typed exactly', () => {
    renderConsole();
    openStopDialog();
    expect(stopButton().getAttribute('aria-disabled')).toBe('true');
    type('stop');
    expect(stopButton().getAttribute('aria-disabled')).toBe('true');
    type('STOP ');
    expect(stopButton().getAttribute('aria-disabled')).toBe('true');
    type('STOP');
    expect(stopButton().getAttribute('aria-disabled')).not.toBe('true');
  });

  it('sends nothing after 1499 ms and one request after 1500 ms', async () => {
    vi.useFakeTimers();
    renderConsole();
    openStopDialog();
    type('STOP');
    fireEvent.pointerDown(stopButton());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1499);
    });
    fireEvent.pointerUp(stopButton());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.pointerDown(stopButton());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(lastCall().url.endsWith(`/api/auctions/${ROOM}/kill`)).toBe(true);
    expect(lastCall().auth).toBe('Bearer pelican');
    expect(lastCall().body).toEqual({ controlId: expect.any(String), confirm: 'STOP' });
    expect(killCalls()).toBe(1);
  });

  it('shows the stopped state and announces it once after a 200', async () => {
    vi.useFakeTimers();
    renderConsole();
    openStopDialog();
    type('STOP');
    fireEvent.pointerDown(stopButton());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(screen.queryByRole('button', { name: t('kill.button') })).toBeNull();
    expect(screen.getAllByText(t('kill.stopped')).length).toBeGreaterThan(0);
    expect(screen.getByTestId('live-assertive').textContent).toBe(t('kill.stopped'));
    const pause = screen.getByRole('button', { name: t('console.pause') });
    expect(pause.getAttribute('aria-disabled')).toBe('true');
  });

  it('cancels on Escape and sends nothing', () => {
    renderConsole();
    openStopDialog();
    type('STOP');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('opens the confirm dialog from the keyboard and never sends on Enter alone', () => {
    renderConsole();
    const open = screen.getByRole('button', { name: t('kill.button') });
    fireEvent.click(open);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [401, 'kill.unauthorized'],
    [403, 'kill.unauthorized'],
    [500, 'kill.serverError'],
  ] as const)('gives status %i its own words', async (status, key) => {
    fetchMock.mockResolvedValueOnce({ ok: false, status });
    renderConsole();
    openStopDialog();
    type('STOP');
    fireEvent.keyDown(stopButton(), { key: 'Enter' });
    await waitFor(() => expect(texts('alert')).toContain(t(key)), { timeout: 3000 });
  });

  it('shows the stopped state from the snapshot flag on the console and the screen view', () => {
    const stoppedSnapshot = {
      ...openSnapshot(roster([12, 'Priya']), baseConfig, 'SETTLING', ROOM as AuctionId),
      stopped: true,
    };
    renderConsole();
    deliver(stateMsg(3, stoppedSnapshot));
    expect(screen.queryByRole('button', { name: t('kill.button') })).toBeNull();
    expect(screen.getAllByText(t('kill.stopped')).length).toBeGreaterThan(0);
    cleanup();
    window.history.pushState(null, '', `/r/${ROOM}/screen#token=pelican`);
    render(<App initialPath={`/r/${ROOM}/screen`} liveBase="ws://localhost:1" />);
    act(() => {
      FakeSocket.last?.onopen?.();
    });
    deliver(stateMsg(1, stoppedSnapshot));
    expect(screen.getAllByText(t('screen.stopped')).length).toBeGreaterThan(0);
  });
});

describe('hammer conflict messages (#1772)', () => {
  const conflict = (message: string): FetchReply => ({
    ok: false,
    status: 409,
    text: () => Promise.resolve(JSON.stringify({ error: { code: 'conflict', message } })),
  });
  const sentText = t('controls.sent', { action: t('console.hammer') });

  it('tells a changed price from a changed leader and reopens with the new values', async () => {
    fetchMock.mockResolvedValueOnce(conflict('price_changed'));
    renderConsole();
    holdHammer();
    await waitFor(() => expect(texts('status')).toContain(t('controls.hammerPriceChanged')), {
      timeout: 3000,
    });
    expect(lastCall().body['args']).toMatchObject({
      expectedPriceCents: 40_000,
      expectedLeaderPaddle: 12,
    });
    expect(texts('status')).not.toContain(sentText);
    deliver(priceMsg(3, 12, 45_000));
    fireEvent.click(screen.getByRole('button', { name: t('console.hammer') }));
    expect(screen.getByRole('dialog').textContent).toContain(formatUsd(45_000));
    fetchMock.mockResolvedValueOnce(conflict('leader_changed'));
    fireEvent.keyDown(screen.getByRole('button', { name: t('console.hammerHold') }), {
      key: 'Enter',
    });
    await waitFor(() => expect(texts('status')).toContain(t('controls.hammerLeaderChanged')), {
      timeout: 3000,
    });
    expect(lastCall().body['args']).toMatchObject({
      expectedPriceCents: 45_000,
      expectedLeaderPaddle: 12,
    });
    expect(texts('status')).not.toContain(sentText);
  });

  it('keeps the generic message for any other conflict', async () => {
    fetchMock.mockResolvedValueOnce(conflict('wrong_state'));
    renderConsole();
    holdHammer();
    await waitFor(() => expect(texts('status')).toContain(t('controls.hammerChanged')), {
      timeout: 3000,
    });
  });
});
