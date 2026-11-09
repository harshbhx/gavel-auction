import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { t } from '../../src/copy/t';
import { roomStore } from '../../src/store/roomStore';
import { clearAuctioneerToken, dropInMemoryTokens } from '../../src/store/session';

const ROOM = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const TOKEN = 'pelican-token-1234';

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

/** Sends the join the way a real open socket would, and returns the token it carried. */
function joinedWith(): string | null {
  act(() => {
    FakeSocket.last?.onopen?.();
  });
  const frame = FakeSocket.last?.frames[0];
  return frame === undefined ? null : ((JSON.parse(frame) as { token?: string }).token ?? null);
}

/** Opens the route with its fragment, then reloads: memory is gone, the address has no fragment. */
function openThenReload(route: string, extra: Record<string, unknown> = {}): void {
  window.history.pushState(null, '', `/r/${ROOM}/${route}#token=${TOKEN}`);
  const first = render(
    <App initialPath={`/r/${ROOM}/${route}`} liveBase="ws://localhost:1" {...extra} />,
  );
  expect(window.location.hash).toBe('');
  first.unmount();
  dropInMemoryTokens();
  FakeSocket.last = null;
  render(<App initialPath={`/r/${ROOM}/${route}`} liveBase="ws://localhost:1" {...extra} />);
}

beforeEach(() => {
  FakeSocket.last = null;
  vi.stubGlobal('WebSocket', FakeSocket);
  window.sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  clearAuctioneerToken();
  roomStore.enter('');
  window.sessionStorage.clear();
  window.history.pushState(null, '', '/');
});

describe('a reload keeps the key of the page (#2225)', () => {
  it.each(['console', 'screen', 'audit'])('%s still joins with its token after F5', (route) => {
    openThenReload(route);
    expect(screen.queryByRole('heading', { name: t('err.tokenMissing') })).toBeNull();
    expect(joinedWith()).toBe(TOKEN);
  });

  it('keeps the token in sessionStorage for this tab only, never localStorage', () => {
    window.history.pushState(null, '', `/r/${ROOM}/console#token=${TOKEN}`);
    render(<App initialPath={`/r/${ROOM}/console`} liveBase="ws://localhost:1" />);
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBeGreaterThan(0);
  });

  it('shows the token gate again after the stored token is cleared', () => {
    openThenReload('console');
    clearAuctioneerToken(ROOM);
    cleanup();
    dropInMemoryTokens();
    const { container } = render(
      <App initialPath={`/r/${ROOM}/console`} liveBase="ws://localhost:1" />,
    );
    expect(container.querySelector('[data-route="token-gate"]')).not.toBeNull();
  });

  it('a shared receipt link keeps its token across a reload', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: false, status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    const api = { apiBase: 'http://api.test', payments: 'fake', paypalClientId: '' } as const;
    openThenReload('receipt', { api });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const calls = fetchMock.mock.calls as unknown as Array<
      [string, { headers: Record<string, string> }]
    >;
    expect(calls.at(-1)?.[1].headers['authorization']).toBe(`Bearer ${TOKEN}`);
  });
});
