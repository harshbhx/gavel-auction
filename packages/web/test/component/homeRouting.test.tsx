import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { t } from '../../src/copy/t';
import { HISTORY_KEY, readHistory, recordRoom } from '../../src/home/history';
import { matchRoute, titleFor } from '../../src/routes';

const API = { apiBase: 'http://localhost:1', payments: 'fake', paypalClientId: 'none' } as const;

const fetchMock = vi.fn(() => Promise.resolve(new Response('{}', { status: 404 })));

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.pushState(null, '', '/');
});

function remember(): void {
  recordRoom('roomA', {
    role: 'bidder',
    paddle: 7,
    lotTitle: 'Signed print',
    lastPriceCents: 54000,
    result: 'won',
  });
}

describe('the start page', () => {
  it('shows the landing page when this browser has no history', () => {
    render(<App initialPath="/" api={API} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(t('landing.title'));
  });

  it('shows the Home screen when it has history', async () => {
    remember();
    render(<App initialPath="/" api={API} />);
    expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe(
      'Welcome back, Paddle 7.',
    );
    expect(screen.getByRole('button', { name: /Join a room/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Create a room/ })).toBeTruthy();
  });

  it('keeps the landing page at /about, with or without history', () => {
    const first = render(<App initialPath="/about" api={API} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(t('landing.title'));
    first.unmount();
    remember();
    render(<App initialPath="/about" api={API} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(t('landing.title'));
  });

  it('ignores a history it cannot read and shows the landing page', async () => {
    window.localStorage.setItem(HISTORY_KEY, '{broken');
    render(<App initialPath="/" api={API} />);
    expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe(t('landing.title'));
  });

  it('Clear my history empties the store and falls back to the landing page', async () => {
    remember();
    render(<App initialPath="/" api={API} />);
    fireEvent.click(await screen.findByRole('button', { name: t('home.footer.clear') }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(t('landing.title')),
    );
    expect(readHistory()).toEqual([]);
    expect(window.localStorage.getItem(HISTORY_KEY)).toBeNull();
  });

  it('Create a room opens the judge room flow at /try', async () => {
    remember();
    render(<App initialPath="/" api={API} />);
    fireEvent.click(await screen.findByRole('button', { name: /Create a room/ }));
    await waitFor(() => expect(window.location.pathname).toBe('/try'));
  });

  it('asks the host about the last room once, with a read-only request', async () => {
    remember();
    recordRoom('roomA', { expiresAt: 4_000_000_000_000 });
    render(<App initialPath="/" api={API} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit | undefined][];
    const url = calls.map((c) => c[0]).find((u) => u.includes('/api/auctions/roomA'));
    expect(url).toBeDefined();
    expect(calls.every((c) => c[1]?.method === undefined || c[1].method === 'GET')).toBe(true);
    expect(await screen.findByText(/This room is deleted/)).toBeTruthy();
  });
});

describe('route table', () => {
  it('has /about, titled like the landing page', () => {
    const match = matchRoute('/about', { gallery: false });
    expect(match.route.id).toBe('about');
    expect(titleFor(match)).toBe(t('app.name'));
  });

  it('still matches / as the start page', () => {
    expect(matchRoute('/', { gallery: false }).route.id).toBe('landing');
  });
});
