import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { t } from '../../src/copy/t';

const API = { apiBase: 'http://localhost:1', payments: 'fake', paypalClientId: 'none' } as const;
const OPERATOR_KEY = 'pelican';

type Reply = { status: number; json?: () => Promise<unknown> };
const fetchMock = vi.fn(
  (_url: string, _init?: { method?: string; headers?: Record<string, string> }): Promise<Reply> =>
    Promise.reject(new Error('unset')),
);

const realPush = window.history.pushState;
const pushed = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  // Stay on the launcher so its links can be read; the console opening is checked on the spy.
  window.history.pushState(null, '', '/demo');
  pushed.mockReset();
  window.history.pushState = pushed;
});

afterEach(() => {
  window.history.pushState = realPush;
  vi.unstubAllGlobals();
});

function start(): void {
  render(<App initialPath="/demo" api={API} />);
  fireEvent.change(screen.getByLabelText(t('ops.keyLabel')), { target: { value: OPERATOR_KEY } });
  fireEvent.click(screen.getByRole('button', { name: t('landing.start') }));
}

async function expectFallback(message: string): Promise<void> {
  await waitFor(() => expect(screen.getAllByText(message).length).toBeGreaterThan(0));
  expect(screen.getByRole('button', { name: t('demo.scriptedInstead') })).toBeTruthy();
  expect(screen.queryByRole('region', { name: t('demo.linksTitle') })).toBeNull();
}

describe('demo launcher on the real route (R-WEB-036..038)', () => {
  it('links to the scripted demo and the judge guide', () => {
    render(<App initialPath="/demo" api={API} />);
    expect(screen.getByRole('link', { name: t('demo.tour') }).getAttribute('href')).toBe(
      '/demo/scripted',
    );
    expect(screen.getByRole('link', { name: t('demo.judge') }).getAttribute('href')).toBe('/try');
  });

  it('opens a code dialog, rejects empty and odd codes, and goes to the join page', () => {
    render(<App initialPath="/demo" api={API} />);
    fireEvent.click(screen.getByRole('button', { name: t('demo.haveCode') }));
    const input = screen.getByLabelText(t('demo.codeLabel'));
    fireEvent.click(screen.getByRole('button', { name: t('demo.codeGo') }));
    expect(screen.getByText(t('demo.codeEmpty'))).toBeTruthy();
    fireEvent.change(input, { target: { value: 'a b/c' } });
    fireEvent.click(screen.getByRole('button', { name: t('demo.codeGo') }));
    expect(screen.getByText(t('demo.codeBad'))).toBeTruthy();
    fireEvent.change(input, { target: { value: ' room-4 ' } });
    fireEvent.click(screen.getByRole('button', { name: t('demo.codeGo') }));
    expect(pushed).toHaveBeenLastCalledWith(null, '', '/join/room-4');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('posts to the demo route with the operator key and shows four links, copy buttons and LIVE', async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      json: () => Promise.resolve({ auctionId: 'room-9', bidders: [] }),
    });
    start();
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: t('generic.copy') })).toHaveLength(4),
    );
    const call = fetchMock.mock.calls.find(([url]) => url.endsWith('/api/demo/rooms'));
    expect(call?.[0]).toBe('http://localhost:1/api/demo/rooms');
    expect(call?.[1]?.method).toBe('POST');
    expect(call?.[1]?.headers?.['x-admin-key']).toBe(OPERATOR_KEY);
    expect(screen.getByText(t('prov.live'))).toBeTruthy();
    expect(pushed).toHaveBeenLastCalledWith(null, '', '/r/room-9/console');
    expect(screen.getByRole('link', { name: '/r/room-9/audit' })).toBeTruthy();
    expect(screen.getByRole('link', { name: '/join/room-9' })).toBeTruthy();
  });

  it('treats a 200 without an auction id as a failure', async () => {
    fetchMock.mockResolvedValue({ status: 200, json: () => Promise.resolve({ bidders: [] }) });
    start();
    await expectFallback(t('demo.failed'));
  });

  it('explains a 404 (demo mode off) and offers the scripted demo', async () => {
    fetchMock.mockResolvedValue({ status: 404 });
    start();
    await expectFallback(t('demo.failedOff'));
    fireEvent.click(screen.getByRole('button', { name: t('demo.scriptedInstead') }));
    expect(pushed).toHaveBeenLastCalledWith(null, '', '/r/demo/console');
  });

  it('explains a 401 and offers the scripted demo', async () => {
    fetchMock.mockResolvedValue({ status: 401 });
    start();
    await expectFallback(t('demo.failedKey'));
  });

  it('explains a 429 and offers the scripted demo', async () => {
    fetchMock.mockImplementation((url) =>
      Promise.resolve({ status: url.endsWith('/api/judge/capabilities') ? 404 : 429 }),
    );
    start();
    await expectFallback(t('demo.failedCap'));
  });

  it('explains a network error and offers the scripted demo', async () => {
    fetchMock.mockRejectedValue(new Error('down'));
    start();
    await expectFallback(t('demo.failed'));
  });

  describe('when the host offers judge rooms', () => {
    const room = {
      auctionId: 'room-7',
      auctioneerToken: 'auc-token',
      screenToken: 'scr-token',
    };
    const answer = (create: Reply): void => {
      fetchMock.mockImplementation((url) => {
        if (url.endsWith('/api/judge/capabilities')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ judgeRooms: true, accepting: true }),
          } as Reply);
        }
        return Promise.resolve(create);
      });
    };
    const startKeyless = async (): Promise<void> => {
      render(<App initialPath="/demo" api={API} />);
      await waitFor(() => expect(screen.queryByLabelText(t('ops.keyLabel'))).toBeNull());
      fireEvent.click(screen.getByRole('button', { name: t('landing.start') }));
    };

    it('creates a room with no operator key and opens the console with its token', async () => {
      answer({ status: 201, json: () => Promise.resolve(room) });
      await startKeyless();
      await waitFor(() =>
        expect(screen.getAllByRole('button', { name: t('generic.copy') })).toHaveLength(4),
      );
      const call = fetchMock.mock.calls.find(([url]) => url.endsWith('/api/judge/rooms'));
      expect(call?.[1]?.method).toBe('POST');
      expect(call?.[1]?.headers?.['x-admin-key']).toBeUndefined();
      expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/api/demo/rooms'))).toBe(false);
      expect(pushed).toHaveBeenLastCalledWith(
        null,
        '',
        '/r/room-7/hub#token=auc-token&screen=scr-token',
      );
      expect(screen.getByRole('link', { name: '/join/room-7' })).toBeTruthy();
    });

    it('says to wait and offers the scripted demo on 429', async () => {
      answer({ status: 429 });
      await startKeyless();
      await expectFallback(t('demo.failedRateUnknown'));
    });
  });

  it('falls back to the operator-key route when the capability probe fails', async () => {
    fetchMock.mockImplementation((url) =>
      url.endsWith('/api/judge/capabilities')
        ? Promise.reject(new Error('down'))
        : Promise.resolve({ status: 404 } as Reply),
    );
    start();
    await expectFallback(t('demo.failedOff'));
  });
});
