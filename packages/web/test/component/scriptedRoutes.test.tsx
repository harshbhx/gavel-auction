import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { t } from '../../src/copy/t';
import { ScenarioTransport } from '../../src/net/scenarioTransport';
import { rememberBidderSession } from '../../src/store/session';

const ROOM = '01HAAAAAAAAAAAAAAAAAAAAAAA';
const WS_BASE = 'ws://localhost:1';

const opened: string[] = [];

/** A socket that records where it was pointed and never connects. */
class QuietSocket {
  readonly readyState = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  constructor(url: string) {
    opened.push(url);
  }
  send(): void {
    // Nothing is sent: the socket never opens.
  }
  close(): void {
    // Nothing to close.
  }
}

beforeEach(() => {
  opened.length = 0;
  window.sessionStorage.clear();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

describe('default mode keeps the real connection', () => {
  it('opens a socket on bid, screen and console and never builds the scripted transport', () => {
    vi.stubGlobal('WebSocket', QuietSocket);
    const scripted = vi.spyOn(ScenarioTransport.prototype, 'connect');

    rememberBidderSession(ROOM, { token: 'walnut', bidderId: 'bidder-one' });
    const bid = render(<App initialPath={`/r/${ROOM}/bid`} gallery={false} liveBase={WS_BASE} />);
    expect(opened).toEqual([`${WS_BASE}/ws`]);
    bid.unmount();

    for (const route of ['screen', 'console']) {
      opened.length = 0;
      window.history.replaceState(null, '', `/r/${ROOM}/${route}#walnut`);
      const view = render(
        <App initialPath={`/r/${ROOM}/${route}`} gallery={false} liveBase={WS_BASE} />,
      );
      expect(opened, route).toEqual([`${WS_BASE}/ws`]);
      expect(screen.queryByText(t('prov.scripted')), route).toBeNull();
      view.unmount();
    }
    expect(scripted).not.toHaveBeenCalled();
  });
});

describe('scripted mode on the happy scenario', () => {
  function at(route: string, ms: number): void {
    window.history.replaceState(null, '', `/r/demo/${route}?scripted=1&at=${ms}`);
  }

  it('shows the scripted price on the bid route, with the banner once and the label', async () => {
    at('bid', 5_000);
    const { container } = render(<App initialPath="/r/demo/bid" gallery={false} />);
    await waitFor(() => expect(container.textContent).toContain('$350'));
    expect(screen.getByText(t('prov.scripted'))).toBeTruthy();
    expect(screen.getAllByText(t('banner.sandbox'))).toHaveLength(1);
  });

  it('shows the scripted price and then the hammer on the screen route', async () => {
    at('screen', 5_000);
    const first = render(<App initialPath="/r/demo/screen" gallery={false} />);
    await waitFor(() => expect(screen.getByTestId('screen-price').textContent).toBe('$350.00'));
    first.unmount();
    at('screen', 16_000);
    render(<App initialPath="/r/demo/screen" gallery={false} />);
    await waitFor(() => expect(screen.getByTestId('sold')).toBeTruthy());
    expect(screen.getByText(t('prov.scripted'))).toBeTruthy();
    expect(screen.getAllByText(t('banner.sandbox'))).toHaveLength(1);
  });

  it('shows the scripted roster on the console route without a token', async () => {
    at('console', 5_000);
    const { container } = render(<App initialPath="/r/demo/console" gallery={false} />);
    await waitFor(() => expect(container.textContent).toContain('Priya'));
    expect(container.querySelector('[data-route="token-gate"]')).toBeNull();
    expect(screen.getByText(t('prov.scripted'))).toBeTruthy();
    expect(screen.getAllByText(t('banner.sandbox'))).toHaveLength(1);
  });

  it('does not turn on without the flag, even on the demo room', () => {
    render(<App initialPath="/r/demo/bid" gallery={false} />);
    expect(screen.queryByText(t('prov.scripted'))).toBeNull();
    expect(screen.getAllByText(t('banner.sandbox'))).toHaveLength(1);
  });
});
