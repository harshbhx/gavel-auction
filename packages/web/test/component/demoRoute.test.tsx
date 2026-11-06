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

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.pushState(null, '', '/');
});

function start(): void {
  render(<App initialPath="/demo" api={API} />);
  fireEvent.change(screen.getByLabelText(t('ops.keyLabel')), { target: { value: OPERATOR_KEY } });
  fireEvent.click(screen.getByRole('button', { name: t('landing.start') }));
}

async function expectFallback(message: string): Promise<void> {
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain(message));
  expect(screen.getByRole('button', { name: t('demo.scriptedInstead') })).toBeTruthy();
  expect(screen.queryByRole('region', { name: t('demo.linksTitle') })).toBeNull();
}

describe('demo launcher on the real route (R-WEB-036..038)', () => {
  it('posts to the demo route with the operator key and shows four links, copy buttons and LIVE', async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      json: () => Promise.resolve({ auctionId: 'room-9', bidders: [] }),
    });
    start();
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: t('generic.copy') })).toHaveLength(4),
    );
    const call = fetchMock.mock.calls[0];
    expect(call?.[0]).toBe('http://localhost:1/api/demo/rooms');
    expect(call?.[1]?.method).toBe('POST');
    expect(call?.[1]?.headers?.['x-admin-key']).toBe(OPERATOR_KEY);
    expect(screen.getByText(t('prov.live'))).toBeTruthy();
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
    expect(window.location.pathname).toBe('/r/demo/console');
  });

  it('explains a 401 and offers the scripted demo', async () => {
    fetchMock.mockResolvedValue({ status: 401 });
    start();
    await expectFallback(t('demo.failedKey'));
  });

  it('explains a 429 and offers the scripted demo', async () => {
    fetchMock.mockResolvedValue({ status: 429 });
    start();
    await expectFallback(t('demo.failedCap'));
  });

  it('explains a network error and offers the scripted demo', async () => {
    fetchMock.mockRejectedValue(new Error('down'));
    start();
    await expectFallback(t('demo.failed'));
  });
});
