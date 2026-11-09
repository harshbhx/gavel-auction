import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { ROUTE_CHROME_WATCH_MS, useRouteChrome } from '../../src/a11y/useRouteChrome';
import { matchRoute } from '../../src/routes';
import { t } from '../../src/copy/t';
import { loadSession, saveSession } from '../../src/net/session';
import { saveRegistration } from '../../src/payments/registrationStore';
import { resetApprovalMemory } from '../../src/payments/useApproval';
import { roomStore } from '../../src/store/roomStore';
import { clearAuctioneerToken, readAuctioneerToken } from '../../src/store/session';
import {
  auctionId,
  baseConfig,
  bidderId,
  openSnapshot,
  roster,
  stateMsg,
} from '../../src/testing/builders';

const ROOM = auctionId(7);

/** A route whose page has a main landmark but no heading: the watcher has nothing to wait for. */
function ChromeProbe() {
  useRouteChrome(matchRoute('/r/r1/bid', { gallery: false }));
  return <main />;
}
const ME = bidderId(1);
const API = { apiBase: 'http://api.test', payments: 'paypal', paypalClientId: 'none' } as const;

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

function reply(status: number, json: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(json),
  } as Response;
}

interface Call {
  url: string;
  method: string;
  body: string | null;
}

function stubApi(extra: (c: Call) => Response | undefined = () => undefined): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const call: Call = {
        url,
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? init.body : null,
      };
      calls.push(call);
      if (url === `http://api.test/api/auctions/${ROOM}`) {
        return Promise.resolve(
          reply(200, { auctionId: ROOM, title: 'Lot', joinCode: 'EMY48N', status: 'OPEN' }),
        );
      }
      return Promise.resolve(extra(call) ?? reply(404, { error: 'not_found' }));
    }),
  );
  return calls;
}

beforeEach(() => {
  vi.stubGlobal('WebSocket', FakeSocket);
  resetApprovalMemory();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
  window.history.replaceState(null, '', '/');
  clearAuctioneerToken();
  roomStore.enter('');
  resetApprovalMemory();
  FakeSocket.all = [];
});

describe('title, main landmark and focus on every route (#2055, #2093, #2117)', () => {
  const PATHS = [
    '/demo',
    '/join/r1',
    '/r/r1/register',
    '/r/r1/bid',
    '/r/r1/receipt',
    '/r/r1/screen',
    '/replay/abc',
    '/nope/at/all',
  ];

  it.each(PATHS)('%s has a titled page, a #main landmark and focus on the heading', (path) => {
    render(<App initialPath={path} />);
    const main = document.getElementById('main');
    expect(main?.tagName).toBe('MAIN');
    expect(main?.getAttribute('tabindex')).toBe('-1');
    expect(document.title.length).toBeGreaterThan(0);
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }));
  });

  it('gives each route its own title, with the room name', () => {
    const titles = new Set<string>();
    for (const path of ['/join/r1', '/r/r1/register', '/r/r1/bid', '/r/r1/screen']) {
      const { unmount } = render(<App initialPath={path} />);
      titles.add(document.title);
      unmount();
    }
    expect(titles.size).toBe(4);
    for (const title of titles) expect(title).toContain('r1');
  });

  it('updates title and focus on client-side navigation', async () => {
    const { navigate } = await import('../../src/App');
    render(<App initialPath="/join/r1" />);
    const before = document.title;
    act(() => navigate('/r/r1/bid'));
    await waitFor(() => expect(document.title).not.toBe(before));
    expect(document.title).toContain('r1');
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }));
  });

  it('moves the skip link focus to the main landmark', () => {
    render(<App initialPath="/join/r1" />);
    (document.activeElement as HTMLElement).blur();
    fireEvent.click(screen.getByText(t('a11y.skip')));
    expect(document.activeElement).toBe(document.getElementById('main'));
  });
});

describe('the skip link target exists on every route (#2439)', () => {
  it.each(['/', '/about'])('%s has one main landmark and it answers to #main', async (path) => {
    render(<App initialPath={path} api={API} />);
    await waitFor(() => expect(document.getElementById('main')).not.toBeNull());
    const mains = document.querySelectorAll('main');
    expect(mains.length).toBe(1);
    expect(mains[0]?.id).toBe('main');
    const skip = screen.getByText(t('a11y.skip')) as HTMLAnchorElement;
    expect(document.getElementById(skip.hash.slice(1))).toBe(mains[0]);
  });
});

describe('the route chrome observer does not outlive its job (#2444)', () => {
  function watchObservers(): { made: number; disconnected: number } {
    const count = { made: 0, disconnected: 0 };
    class Counting {
      constructor() {
        count.made += 1;
      }
      observe(): void {}
      takeRecords(): [] {
        return [];
      }
      disconnect(): void {
        count.disconnected += 1;
      }
    }
    vi.stubGlobal('MutationObserver', Counting);
    return count;
  }

  it('starts none when the screen route already has its main landmark', () => {
    const count = watchObservers();
    render(<App initialPath="/r/r1/screen" />);
    expect(count.made).toBe(0);
  });

  it('disconnects the watcher when the page never gets a heading', () => {
    vi.useFakeTimers();
    const count = watchObservers();
    const { unmount } = render(<ChromeProbe />);
    expect(count.made).toBe(1);
    vi.advanceTimersByTime(ROUTE_CHROME_WATCH_MS);
    expect(count.disconnected).toBe(1);
    unmount();
    vi.useRealTimers();
  });
});

describe('a refused token clears only its own slot (#2057)', () => {
  it('keeps the bidder session and forgets the console token', () => {
    saveSession(ROOM, { token: 'bidderword', bidderId: ME });
    window.history.replaceState(null, '', '/#token=pelican');
    render(<App initialPath={`/r/${ROOM}/console`} liveBase="ws://x" />);
    const socket = lastSocket();
    act(() => socket.open());
    act(() => socket.receive({ v: 1, t: 'error', code: 'unauthorized', message: 'refused' }));
    expect(screen.getByText(t('err.tokenMissing'))).toBeTruthy();
    expect(loadSession(ROOM)).toEqual({ token: 'bidderword', bidderId: ME });
    expect(readAuctioneerToken(ROOM)).toBeNull();
  });
});

describe('the register route recovers from a refused session (#2054)', () => {
  it('forgets the dead session and joins again with the room code', async () => {
    saveSession(ROOM, { token: 'dead-token', bidderId: ME });
    const calls = stubApi((c) =>
      c.url === 'http://api.test/api/judge/join'
        ? reply(200, { sessionToken: 'fresh-token', bidderId: 'B2' })
        : undefined,
    );
    render(<App initialPath={`/r/${ROOM}/register`} api={API} liveBase="ws://x" />);
    const socket = lastSocket();
    act(() => socket.open());
    act(() => socket.receive({ v: 1, t: 'error', code: 'unauthorized', message: 'refused' }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/api/judge/join'))).toBe(true));
    await waitFor(() =>
      expect(loadSession(ROOM)).toEqual({ token: 'fresh-token', bidderId: 'B2' }),
    );
  });

  it('prefers a fresh invite in the link over a stored session', async () => {
    saveSession(ROOM, { token: 'old-token', bidderId: ME });
    window.history.replaceState(null, '', '/#inviteword');
    const calls = stubApi((c) =>
      c.url === `http://api.test/api/auctions/${ROOM}/join`
        ? reply(200, { sessionToken: 'invited-token', bidderId: 'B3' })
        : undefined,
    );
    render(<App initialPath={`/r/${ROOM}/register`} api={API} />);
    await waitFor(() => expect(loadSession(ROOM)?.token).toBe('invited-token'));
    const join = calls.find((c) => c.url.endsWith(`/${ROOM}/join`));
    expect(JSON.parse(join?.body ?? '{}')).toEqual({ invite: 'inviteword' });
  });
});

describe('a session with no registered hold can still join (#2120)', () => {
  it('offers Join as bidder on the join page instead of redirecting to watch only', async () => {
    saveSession(ROOM, { token: 'tok', bidderId: ME });
    stubApi();
    window.history.replaceState(null, '', `/join/${ROOM}?c=EMY48N`);
    render(<App initialPath={`/join/${ROOM}`} api={API} />);
    expect(await screen.findByRole('button', { name: t('join.asBidder') })).toBeTruthy();
    expect(window.location.pathname).toBe(`/join/${ROOM}`);
  });

  it('still sends a bidder with a registered hold to the bid page', async () => {
    saveSession(ROOM, { token: 'tok', bidderId: ME });
    saveRegistration(ROOM, ME, { clientRegistrationId: 'c1', ceilingCents: 25_000 });
    stubApi();
    render(<App initialPath={`/join/${ROOM}`} api={API} />);
    await waitFor(() => expect(window.location.pathname).toBe(`/r/${ROOM}/bid`));
  });

  it('gives the watch-only bid page a way back to registration', () => {
    saveSession(ROOM, { token: 'tok', bidderId: ME });
    render(<App initialPath={`/r/${ROOM}/bid`} liveBase="ws://x" />);
    const socket = lastSocket();
    act(() => socket.open());
    const watching = openSnapshot([...roster([1, 'Priya'])], baseConfig, 'OPEN', ROOM);
    act(() => socket.receive(stateMsg(1, watching)));
    fireEvent.click(screen.getByRole('button', { name: t('join.asBidder') }));
    expect(window.location.pathname).toBe(`/r/${ROOM}/register`);
  });
});
