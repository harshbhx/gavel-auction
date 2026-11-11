import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { t } from '../../src/copy/t';
import { confirmHold } from '../support/approveHold';
import { saveSession } from '../../src/net/session';
import { openJoin } from '../../src/net/openJoin';
import { JudgeHub } from '../../src/screens/hub/JudgeHub';
import { NO_KEYS, hubHref, forgetHubKeys, rememberHubKeys } from '../../src/screens/hub/hubKeys';
import { clearAuctioneerToken } from '../../src/store/session';

const API = { apiBase: 'http://api.test', payments: 'paypal', paypalClientId: 'client-x' } as const;
const ROOM = 'room-77';

interface Call {
  url: string;
  method: string;
  body: string | null;
}

function reply(status: number, json: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(json),
  } as Response;
}

function stubApi(answer: (call: Call) => Response | undefined, calls: Call[] = []): Call[] {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const call: Call = {
        url,
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? init.body : null,
      };
      calls.push(call);
      return Promise.resolve(answer(call) ?? reply(404, { error: 'not_found' }));
    }),
  );
  return calls;
}

const summary = (call: Call): Response | undefined =>
  call.url === `http://api.test/api/auctions/${ROOM}`
    ? reply(200, { auctionId: ROOM, title: 'Lot', joinCode: 'EMY48N', status: 'OPEN' })
    : undefined;

afterEach(() => {
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
  window.history.replaceState(null, '', '/');
  clearAuctioneerToken();
  forgetHubKeys();
});

describe('openJoin', () => {
  it('posts the code and keeps the session it gets back', async () => {
    const calls = stubApi(() => reply(200, { sessionToken: 'tok-1234', bidderId: 'B1' }));
    expect(await openJoin('http://api.test', 'EMY48N')).toEqual({
      ok: true,
      token: 'tok-1234',
      bidderId: 'B1',
    });
    expect(calls[0]?.url).toBe('http://api.test/api/judge/join');
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({ code: 'EMY48N', displayName: 'Guest' });
  });

  it('names why it failed', async () => {
    stubApi(() => reply(404, { error: 'not_found' }));
    expect(await openJoin('http://api.test', 'X')).toEqual({ ok: false, reason: 'notOpen' });
    stubApi(() => reply(410, { error: 'judge_room_expired' }));
    expect(await openJoin('http://api.test', 'X')).toEqual({ ok: false, reason: 'expired' });
    stubApi(() => reply(429, { error: 'judge_room_full' }));
    expect(await openJoin('http://api.test', 'X')).toEqual({ ok: false, reason: 'full' });
    stubApi(() => reply(429, { error: 'judge_join_locked' }));
    expect(await openJoin('http://api.test', 'X')).toEqual({ ok: false, reason: 'locked' });
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
    expect(await openJoin('http://api.test', 'X')).toEqual({ ok: false, reason: 'failed' });
  });
});

describe('register with the room code and no invite', () => {
  it('joins by the room code and opens the register form', async () => {
    const calls = stubApi((c) =>
      c.url.endsWith('/api/judge/join')
        ? reply(200, { sessionToken: 'plainly-fake-session', bidderId: 'B7' })
        : summary(c),
    );
    render(<App initialPath={`/r/${ROOM}/register`} api={API} />);
    expect(await screen.findByLabelText(t('reg.name'))).toBeTruthy();
    const join = calls.find((c) => c.url.endsWith('/api/judge/join'));
    expect(JSON.parse(join?.body ?? '{}').code).toBe('EMY48N');
    expect(screen.queryByText(t('reg.noInviteTitle'))).toBeNull();
  });

  it('prefers the code in the link and skips the summary', async () => {
    window.history.replaceState(null, '', `/r/${ROOM}/register?c=ZZZ999`);
    const calls = stubApi((c) =>
      c.url.endsWith('/api/judge/join')
        ? reply(200, { sessionToken: 'plainly-fake-session', bidderId: 'B7' })
        : undefined,
    );
    render(<App initialPath={`/r/${ROOM}/register`} api={API} />);
    expect(await screen.findByLabelText(t('reg.name'))).toBeTruthy();
    expect(calls.map((c) => c.url)).toEqual(['http://api.test/api/judge/join']);
  });

  it('asks for an invite when the room is not a judge room', async () => {
    stubApi(summary);
    render(<App initialPath={`/r/${ROOM}/register`} api={API} />);
    expect(await screen.findByRole('heading', { name: t('reg.noInviteTitle') })).toBeTruthy();
    expect(screen.queryByText(t('reg.expired'))).toBeNull();
    expect(screen.queryByText(t('reg.step1'))).toBeNull();
    expect(screen.getByText(t('tokenHelp.registerLead'))).toBeTruthy();
  });

  it('says the room is full', async () => {
    stubApi((c) =>
      c.url.endsWith('/api/judge/join') ? reply(429, { error: 'judge_room_full' }) : summary(c),
    );
    render(<App initialPath={`/r/${ROOM}/register`} api={API} />);
    expect(await screen.findByText(t('join.full'))).toBeTruthy();
    expect(screen.getByRole('link', { name: t('join.watch') })).toBeTruthy();
  });
});

describe('a watcher on the bid page', () => {
  it('is offered a way to join as a bidder instead of a blank page', async () => {
    stubApi(summary);
    render(<App initialPath={`/r/${ROOM}/bid`} api={API} />);
    expect(await screen.findByRole('heading', { level: 1, name: t('watch.title') })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: t('join.asBidder') }));
    await waitFor(() => expect(window.location.pathname).toBe(`/r/${ROOM}/register`));
  });
});

describe('judge hub join link', () => {
  const origin = 'https://gavel.example';

  it('carries the room code in the QR, the visible link and the copied link', async () => {
    const copied: string[] = [];
    stubApi(() => undefined);
    render(
      <JudgeHub
        roomId={ROOM}
        keys={{ ...NO_KEYS, code: 'EMY48N' }}
        origin={origin}
        writeClipboard={(text) => {
          copied.push(text);
          return Promise.resolve();
        }}
      />,
    );
    const want = `${origin}/join/${ROOM}?c=EMY48N`;
    expect((await screen.findByRole('img')).getAttribute('aria-label')).toBe(want);
    expect(screen.getByTestId('hub-join-link').textContent).toContain(want);
    expect(screen.getByTestId('hub-join-open').getAttribute('href')).toBe(want);
    fireEvent.click(screen.getByRole('button', { name: t('hub.copyInvite') }));
    await waitFor(() => expect(copied).toEqual([want]));
  });

  it('lets a keyless watcher join without the room keys and says why nothing else opens', async () => {
    render(<JudgeHub roomId={ROOM} keys={{ ...NO_KEYS, code: 'EMY48N' }} origin={origin} />);
    expect(screen.getByTestId('hub-join-open')).toBeTruthy();
    expect(screen.getAllByText(t('hub.noToken'))).toHaveLength(1);
  });

  it('reads the code from the room summary when the link had none', async () => {
    stubApi(summary);
    render(<JudgeHub roomId={ROOM} keys={NO_KEYS} apiBase="http://api.test" origin={origin} />);
    await waitFor(() =>
      expect(screen.getByTestId('hub-join-link').textContent).toContain('?c=EMY48N'),
    );
    expect(
      screen.getByRole('button', { name: t('hub.copyInvite') }).getAttribute('aria-disabled'),
    ).toBeNull();
  });

  it('holds the copy button until the code is known', () => {
    render(<JudgeHub roomId={ROOM} keys={NO_KEYS} origin={origin} />);
    expect(
      screen.getByRole('button', { name: t('hub.copyInvite') }).getAttribute('aria-disabled'),
    ).toBe('true');
  });
});

describe('hub link back from the console', () => {
  it('keeps the join code when this tab never saw it', () => {
    rememberHubKeys(ROOM, { ...NO_KEYS, screen: 'scr-token-1' });
    expect(hubHref(ROOM, 'aud-token-1', 'EMY48N')).toBe(
      `/r/${ROOM}/hub#token=aud-token-1&screen=scr-token-1&code=EMY48N`,
    );
  });
});

describe('two ways to hold on a judge room (SRV-34)', () => {
  const room = (judgeRoom: boolean, simHolds: boolean) => (call: Call) => {
    if (call.url === 'http://api.test/api/judge/capabilities') {
      return reply(200, { judgeRooms: true, accepting: true, simHolds });
    }
    if (call.url === `http://api.test/api/auctions/${ROOM}`) {
      return reply(200, {
        auctionId: ROOM,
        title: 'Lot',
        joinCode: 'EMY48N',
        status: 'OPEN',
        ...(judgeRoom ? { judgeRoom: true } : {}),
      });
    }
    return undefined;
  };

  it('shows the PayPal sandbox and the demo side by side with one line of why', async () => {
    stubApi(room(true, true));
    render(<App initialPath={`/join/${ROOM}`} api={API} />);
    expect(await screen.findByRole('button', { name: t('join.wayPaypal') })).toBeTruthy();
    expect(screen.getByRole('button', { name: t('join.wayDemo') })).toBeTruthy();
    expect(screen.getByText(t('join.waysWhy'))).toBeTruthy();
    expect(t('join.waysWhy')).toMatch(/held, not charged/);
    fireEvent.click(screen.getByRole('button', { name: t('join.wayDemo') }));
    await waitFor(() => expect(window.location.search).toBe('?mode=demo'));
    expect(window.location.pathname).toBe(`/r/${ROOM}/register`);
  });

  it('keeps the single button for a normal room or a host with the demo off', async () => {
    stubApi(room(false, true));
    const first = render(<App initialPath={`/join/${ROOM}`} api={API} />);
    expect(await first.findByRole('button', { name: t('join.asBidder') })).toBeTruthy();
    expect(screen.queryByRole('button', { name: t('join.wayDemo') })).toBeNull();
    first.unmount();
    stubApi(room(true, false));
    render(<App initialPath={`/join/${ROOM}`} api={API} />);
    expect(await screen.findByRole('button', { name: t('join.asBidder') })).toBeTruthy();
    expect(screen.queryByRole('button', { name: t('join.wayDemo') })).toBeNull();
  });

  it('places a simulated hold in demo mode, with no PayPal call', async () => {
    window.history.replaceState(null, '', `/r/${ROOM}/register?mode=demo`);
    saveSession(ROOM, { token: 'plainly-fake-session', bidderId: 'B7' });
    const calls = stubApi((c) =>
      c.url.endsWith('/sim-hold')
        ? reply(200, { holdId: 'sim-hold-B7', simulated: true })
        : undefined,
    );
    render(<App initialPath={`/r/${ROOM}/register`} api={API} />);
    fireEvent.change(screen.getByLabelText(t('reg.name')), { target: { value: 'Priya' } });
    fireEvent.click(screen.getByRole('button', { name: t('reg.continue') }));
    fireEvent.click(screen.getByLabelText('$250'));
    confirmHold();
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/sim-hold'))).toBe(true));
    const sim = calls.find((c) => c.url.endsWith('/sim-hold'));
    expect(sim?.url).toBe(`http://api.test/api/judge/rooms/${ROOM}/sim-hold`);
    expect(JSON.parse(sim?.body ?? '{}')).toEqual({ ceilingCents: 25_000, name: 'Priya' });
    expect(calls.some((c) => c.url.endsWith('/api/holds'))).toBe(false);
  });
});
