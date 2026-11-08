import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { OfflineBanner } from '../../src/a11y/OfflineBanner';
import { t } from '../../src/copy/t';
import { createJudgeRoom } from '../../src/net/judgeRooms';
import { DemoLauncher, type DemoLinks } from '../../src/screens/demo/DemoLauncher';
import { JudgeHub } from '../../src/screens/hub/JudgeHub';
import { NO_KEYS } from '../../src/screens/hub/hubKeys';
import { WatcherGate } from '../../src/screens/join/WatcherGate';

const LINKS: DemoLinks = {
  console: '/r/r1/console#token=a',
  screen: '/r/r1/screen#token=b',
  bidder: '/join/r1',
  audit: '/r/r1/audit',
  hub: '/r/r1/hub#token=a',
};

function reply(status: number, json: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(json),
  } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  window.history.replaceState(null, '', '/');
});

describe('watcher view', () => {
  it('shows the lot, price, leader and status, and a join button', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          reply(200, {
            title: 'Signed guitar',
            status: 'OPEN',
            currentCents: 25_000,
            leaderPaddle: 7,
            bidderCount: 3,
          }),
        ),
      ),
    );
    const onNavigate = vi.fn();
    render(<WatcherGate roomId="room-1" onNavigate={onNavigate} apiBase="http://api.test" />);
    expect((await screen.findByTestId('watch-price')).textContent).toBe('$250.00');
    expect(screen.getByText(t('watch.lot', { title: 'Signed guitar' }))).toBeTruthy();
    expect(screen.getByText(t('watch.leader', { n: 7 }))).toBeTruthy();
    expect(screen.getByText(/Bidding is open/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: t('join.asBidder') }));
    expect(onNavigate).toHaveBeenCalledWith('/r/room-1/register');
  });

  it('says there are no bids yet and survives a failed lookup', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(reply(200, { title: 'Lot', status: 'OPEN' }))),
    );
    const first = render(
      <WatcherGate roomId="room-1" onNavigate={vi.fn()} apiBase="http://api.test" />,
    );
    expect((await screen.findByTestId('watch-price')).textContent).toBe(t('watch.noBids'));
    first.unmount();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('down'))),
    );
    render(<WatcherGate roomId="room-1" onNavigate={vi.fn()} apiBase="http://api.test" />);
    expect(await screen.findByText(t('watch.unavailable'))).toBeTruthy();
    expect(screen.getByRole('button', { name: t('join.asBidder') })).toBeTruthy();
  });
});

describe('double submit guards', () => {
  it('sends one judge room request for rapid calls', async () => {
    let release: (r: Response) => void = () => undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const a = createJudgeRoom('http://api.test');
    const b = createJudgeRoom('http://api.test');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    release(reply(500, {}));
    await expect(a).rejects.toThrow();
    await expect(b).rejects.toThrow();
    // Once settled, a later click may try again.
    const c = createJudgeRoom('http://api.test');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    release(reply(500, {}));
    await expect(c).rejects.toThrow();
  });

  it('starts the demo room once however fast the button is clicked', async () => {
    let finish: (links: DemoLinks) => void = () => undefined;
    const createRoom = vi.fn(
      () =>
        new Promise<DemoLinks>((resolve) => {
          finish = resolve;
        }),
    );
    render(
      <DemoLauncher createRoom={createRoom} startScripted={() => LINKS} openConsole={vi.fn()} />,
    );
    const go = screen.getByRole('button', { name: t('landing.start') });
    fireEvent.click(go);
    fireEvent.click(go);
    fireEvent.click(go);
    expect(createRoom).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish(LINKS);
      await Promise.resolve();
    });
  });

  it('mints one invite however fast the button is clicked', async () => {
    const posts: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          posts.push(url);
          return new Promise<Response>(() => undefined);
        }
        return Promise.resolve(reply(404, {}));
      }),
    );
    render(
      <JudgeHub
        roomId="room-1"
        keys={{ ...NO_KEYS, auctioneer: 'aud-token', code: 'EMY48N' }}
        apiBase="http://api.test"
        origin="http://web.test"
      />,
    );
    await waitFor(() => expect(posts).toHaveLength(1));
    const button = screen.getByRole('button', { name: t('hub.newInvite') });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);
    expect(posts).toHaveLength(1);
  });
});

describe('offline notice', () => {
  it('appears when the browser loses the network and goes when it returns', () => {
    render(<OfflineBanner />);
    expect(screen.queryByTestId('offline-banner')).toBeNull();
    act(() => {
      Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false });
      window.dispatchEvent(new Event('offline'));
    });
    expect(screen.getByTestId('offline-banner').textContent).toContain(t('net.offline'));
    act(() => {
      Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
      window.dispatchEvent(new Event('online'));
    });
    expect(screen.queryByTestId('offline-banner')).toBeNull();
  });
});

describe('pages with a way out', () => {
  it('shows a skip link first on every page', () => {
    render(<App initialPath="/try" />);
    const skip = screen.getByRole('link', { name: t('a11y.skip') });
    expect(skip.getAttribute('href')).toBe('#main');
  });

  it('answers a malformed join code without asking the server', () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error('should not be called')));
    vi.stubGlobal('fetch', fetchMock);
    render(
      <App
        initialPath={`/join/${encodeURIComponent('../etc/passwd')}`}
        api={{ apiBase: 'http://api.test', payments: 'fake', paypalClientId: 'none' }}
      />,
    );
    expect(screen.getByRole('heading', { name: t('join.notFound') })).toBeTruthy();
    expect(screen.getByRole('button', { name: t('join.tryAgain') })).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('gives the ops page a heading before anything is loaded', () => {
    render(<App initialPath="/ops" />);
    expect(screen.getByRole('heading', { level: 1, name: t('ops.title') })).toBeTruthy();
  });
});
