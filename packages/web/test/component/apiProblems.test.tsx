import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { t } from '../../src/copy/t';
import { waitText } from '../../src/net/apiError';
import { createJudgeRoom, judgeRoomsAvailable } from '../../src/net/judgeRooms';
import { DemoRoomError, failureText } from '../../src/screens/demo/DemoLauncher';

const API = { apiBase: 'http://localhost:1', payments: 'fake', paypalClientId: 'none' } as const;

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

function stubFetch(answer: (url: string) => Response | Error): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const out = answer(url);
      return out instanceof Error ? Promise.reject(out) : Promise.resolve(out);
    }),
  );
}

const limited = (seconds?: number): Response =>
  new Response('{"error":"rate_limited"}', {
    status: 429,
    ...(seconds === undefined ? {} : { headers: { 'retry-after': String(seconds) } }),
  });

describe('a failed room read says what went wrong (SRV-37)', () => {
  it('join page: 404 is not found, 429 asks for a pause, a network failure says so', async () => {
    stubFetch(() => new Response('{}', { status: 404 }));
    const first = render(<App initialPath="/join/nope" api={API} />);
    await screen.findByText(t('join.notFound'));
    first.unmount();

    stubFetch(() => limited(30));
    const second = render(<App initialPath="/join/busy" api={API} />);
    expect(await screen.findByText(t('join.rateTitle'))).toBeTruthy();
    expect(screen.getByText(t('api.rateHelp', { wait: waitText(30) }))).toBeTruthy();
    expect(screen.queryByText(t('join.notFound'))).toBeNull();
    second.unmount();

    stubFetch(() => new TypeError('Failed to fetch'));
    render(<App initialPath="/join/offline" api={API} />);
    expect(await screen.findByText(t('join.offlineTitle'))).toBeTruthy();
    expect(screen.queryByText(t('join.notFound'))).toBeNull();
  });

  it('a 429 on a room page retries in place after Retry-After and then shows the page', async () => {
    let calls = 0;
    stubFetch(() => {
      calls += 1;
      return calls === 1
        ? limited(1)
        : new Response('{"auctionId":"real","title":"Lot"}', { status: 200 });
    });
    render(<App initialPath="/r/real/bid" api={API} />);
    expect(await screen.findByText(t('join.rateTitle'))).toBeTruthy();
    expect(screen.getByText(t('api.rateHelp', { wait: waitText(1) }))).toBeTruthy();
    expect(screen.queryByText(t('room.missingTitle'))).toBeNull();
    expect(await screen.findByText(t('watch.title'), {}, { timeout: 4000 })).toBeTruthy();
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it('the retry button asks again at once, and a long lockout does not retry by itself', async () => {
    let calls = 0;
    stubFetch(() => {
      calls += 1;
      return calls < 3 ? limited(900) : new Response('{"auctionId":"real"}', { status: 200 });
    });
    render(<App initialPath="/r/real/bid" api={API} />);
    fireEvent.click(await screen.findByRole('button', { name: t('generic.retry') }));
    await waitFor(() => expect(calls).toBe(2));
    fireEvent.click(await screen.findByRole('button', { name: t('generic.retry') }));
    expect(await screen.findByText(t('watch.title'))).toBeTruthy();
    expect(calls).toBeGreaterThanOrEqual(3);
  });

  it('hub of a room that does not exist says so instead of "ready"', async () => {
    stubFetch(() => new Response('{}', { status: 404 }));
    render(<App initialPath="/r/nope/hub" api={API} />);
    expect(await screen.findByText(t('room.missingTitle'))).toBeTruthy();
    expect(screen.queryByText(t('hub.title'))).toBeNull();
    expect(screen.getByRole('button', { name: t('join.tryAgain') })).toBeTruthy();
    expect(screen.getByRole('button', { name: t('join.startDemo') })).toBeTruthy();
  });

  it('bid page of a room that does not exist says so, a real room keeps the watcher page', async () => {
    stubFetch(() => new Response('{}', { status: 404 }));
    const gone = render(<App initialPath="/r/nope/bid" api={API} />);
    expect(await screen.findByText(t('room.missingTitle'))).toBeTruthy();
    gone.unmount();

    stubFetch(() => new Response('{"auctionId":"real","title":"Lot"}', { status: 200 }));
    render(<App initialPath="/r/real/bid" api={API} />);
    expect(await screen.findByText(t('watch.title'))).toBeTruthy();
  });

  it('the replay page explains itself and links back', () => {
    render(<App initialPath="/replay/demo" />);
    expect(screen.getByText(t('replay.about'))).toBeTruthy();
    expect(screen.getByRole('link', { name: t('err.home') }).getAttribute('href')).toBe('/');
  });
});

describe('judge room limits (SRV-37)', () => {
  it('a 429 on create carries the wait and reads as a rate limit', async () => {
    stubFetch(() => limited(600));
    const error = await createJudgeRoom('http://x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DemoRoomError);
    expect((error as DemoRoomError).reason).toBe('rateLimited');
    expect((error as DemoRoomError).retryAfterS).toBe(600);
    expect(failureText('rateLimited', 600)).toBe(t('demo.failedRate', { wait: waitText(600) }));
    expect(failureText('rateLimited', null)).toBe(t('demo.failedRateUnknown'));
  });

  it('a full house stays "busy", not a rate limit', async () => {
    stubFetch(
      () =>
        new Response('{"error":"judge_room_cap"}', {
          status: 429,
          headers: { 'retry-after': '60' },
        }),
    );
    const error = await createJudgeRoom('http://x').catch((e: unknown) => e);
    expect((error as DemoRoomError).reason).toBe('judgeBusy');
  });

  it('a 429 on the capability probe keeps the key-less path', async () => {
    stubFetch(() => limited(5));
    expect(await judgeRoomsAvailable('http://x')).toBe(true);
  });

  it('/demo after a 429 shows the wait, not the operator key screen', async () => {
    stubFetch((url) => (url.endsWith('/api/judge/rooms') ? limited(120) : limited(5)));
    render(<App initialPath="/demo" api={API} />);
    await waitFor(() => expect(screen.queryByLabelText(t('ops.keyLabel'))).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: t('landing.start') }));
    expect(await screen.findByText(t('demo.failedRate', { wait: waitText(120) }))).toBeTruthy();
  });
});

describe('waitText', () => {
  it('reads seconds, minutes and hours', () => {
    expect(waitText(null)).toBe('');
    expect(waitText(30)).toBe(t('time.seconds', { n: 30 }));
    expect(waitText(600)).toBe(t('time.minutes', { n: 10 }));
    expect(waitText(3600)).toBe(t('time.hours', { n: 1 }));
  });
});

describe('an invite pasted into the same tab (SRV-37)', () => {
  it('is read when only the fragment changes', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        calls.push(`${init?.method ?? 'GET'} ${url}`);
        return Promise.resolve(new Response('{}', { status: 404 }));
      }),
    );
    window.history.replaceState(null, '', '/r/room1/register');
    render(<App initialPath="/r/room1/register" api={API} />);
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    window.location.hash = '#token=abc123';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await waitFor(() =>
      expect(calls.some((c) => c.startsWith('POST') && c.endsWith('/join'))).toBe(true),
    );
  });
});
