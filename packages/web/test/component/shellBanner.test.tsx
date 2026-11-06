import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { t } from '../../src/copy/t';
import { saveSession } from '../../src/net/session';
import { clearAuctioneerToken } from '../../src/store/session';

const ROOM = 'shellroom';
const API = { apiBase: 'http://localhost:1', payments: 'fake', paypalClientId: 'none' } as const;
const LIVE = 'ws://localhost:1';

class QuietSocket {
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  readyState = 0;
  send(): void {
    // Nothing is sent.
  }
  close(): void {
    // Nothing to release.
  }
}

beforeEach(() => {
  vi.stubGlobal('WebSocket', QuietSocket);
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new Error('offline'))),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearAuctioneerToken();
  window.sessionStorage.clear();
  window.history.pushState(null, '', '/');
});

function banners(): number {
  return screen.queryAllByText(t('banner.sandbox')).length;
}

/** The address bar must show the route first: reading the fragment rewrites it. */
function renderWithToken(path: string): void {
  window.history.pushState(null, '', `${path}#token=pelican`);
  render(<App initialPath={path} liveBase={LIVE} api={API} />);
}

describe('sandbox banner at the app root (R-WEB-034)', () => {
  it('shows it once on the landing page', () => {
    render(<App initialPath="/" api={API} />);
    expect(banners()).toBe(1);
  });

  it('shows it once on the register route', () => {
    render(<App initialPath={`/r/${ROOM}/register`} api={API} />);
    expect(banners()).toBe(1);
  });

  it('shows it once on the bid screen', () => {
    saveSession(ROOM, { token: 'bidderword', bidderId: 'bidder-1' });
    render(<App initialPath={`/r/${ROOM}/bid`} liveBase={LIVE} api={API} />);
    expect(document.querySelector('[data-route="bid"]')).not.toBeNull();
    expect(banners()).toBe(1);
  });

  it('shows it once on the console', () => {
    renderWithToken(`/r/${ROOM}/console`);
    expect(document.querySelector('[data-route="console"]')).not.toBeNull();
    expect(banners()).toBe(1);
  });

  it('shows it once on the big screen', () => {
    renderWithToken(`/r/${ROOM}/screen`);
    expect(document.querySelector('[data-route="screen"]')).not.toBeNull();
    expect(banners()).toBe(1);
  });

  it('shows it once on the audit route', () => {
    renderWithToken(`/r/${ROOM}/audit`);
    expect(document.querySelector('[data-route="audit"]')).not.toBeNull();
    expect(banners()).toBe(1);
  });

  it('shows it once on the replay route', () => {
    render(<App initialPath="/replay/abc" />);
    expect(banners()).toBe(1);
  });

  it('shows it once on the 404 page', () => {
    render(<App initialPath="/nope/at/all" />);
    expect(banners()).toBe(1);
  });

  it('shows it once on the console and audit token gates', () => {
    const first = render(<App initialPath={`/r/${ROOM}/console`} liveBase={LIVE} />);
    expect(banners()).toBe(1);
    first.unmount();
    render(<App initialPath={`/r/${ROOM}/audit`} liveBase={LIVE} />);
    expect(banners()).toBe(1);
  });
});

describe('audit token gate (R-WEB-031)', () => {
  it('shows err.tokenMissing and a link to the launcher without a token', () => {
    const { container } = render(<App initialPath={`/r/${ROOM}/audit`} liveBase={LIVE} />);
    expect(container.querySelector('[data-route="token-gate"]')?.getAttribute('data-role')).toBe(
      'reviewer',
    );
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(t('err.tokenMissing'));
    expect(screen.getByRole('link', { name: t('err.newLink') }).getAttribute('href')).toBe('/demo');
  });

  it('shows err.tokenMissing without a live server too', () => {
    render(<App initialPath={`/r/${ROOM}/audit`} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(t('err.tokenMissing'));
  });

  it('keeps the audit closed for a bidder session', () => {
    saveSession(ROOM, { token: 'bidderword', bidderId: 'bidder-1' });
    render(<App initialPath={`/r/${ROOM}/audit`} liveBase={LIVE} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(t('err.tokenMissing'));
  });

  it('opens the audit view with a reviewer link token', () => {
    renderWithToken(`/r/${ROOM}/audit`);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(t('audit.title'));
  });
});
