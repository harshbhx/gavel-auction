import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App, navigate } from '../../src/App';
import { t } from '../../src/copy/t';
import { matchRoute } from '../../src/routes';
import { saveSession } from '../../src/net/session';
import { clearAuctioneerToken } from '../../src/store/session';

afterEach(() => {
  window.sessionStorage.clear();
});

const CASES: ReadonlyArray<[string, string]> = [
  ['/', 'landing'],
  ['/demo', 'demo'],
  ['/join/r1', 'join'],
  ['/r/r1/register', 'register'],
  ['/r/r1/bid', 'bid'],
  ['/r/r1/receipt', 'receipt'],
  ['/r/r1/screen', 'screen'],
  ['/replay/abc', 'replay'],
  ['/gallery', 'gallery'],
  ['/nope/at/all', 'notFound'],
];

describe('routes', () => {
  it.each(CASES)('%s maps to %s, sets the title and focuses the h1', (path, id) => {
    const { container } = render(<App initialPath={path} gallery />);
    expect(container.querySelector(`[data-route="${id}"]`)).not.toBeNull();
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(document.activeElement).toBe(h1);
    expect(document.title.length).toBeGreaterThan(0);
  });

  it('maps the audit path to the audit route, behind a token', () => {
    expect(matchRoute('/r/r1/audit', { gallery: false }).route).toMatchObject({
      id: 'audit',
      needsToken: true,
      tokenRole: 'reviewer',
    });
  });

  it('puts the room name in the title', () => {
    render(<App initialPath="/r/room-7/bid" />);
    expect(document.title).toContain('room-7');
  });

  it('hides the gallery outside dev and preview builds', () => {
    expect(matchRoute('/gallery', { gallery: false }).route.id).toBe('notFound');
    expect(matchRoute('/gallery', { gallery: true }).route.id).toBe('gallery');
  });

  it('shows the token message on the console without a token', () => {
    render(<App initialPath="/r/r1/console" />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(t('err.tokenMissing'));
  });

  it('opens the console when the link carries an auctioneer token', () => {
    window.location.hash = '#token=pelican';
    render(<App initialPath="/r/r1/console" />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(t('demo.roleConsole'));
    clearAuctioneerToken();
  });

  it('keeps the console closed for a bidder session', () => {
    saveSession('r1', { token: 'bidderword', bidderId: 'bidder-1' });
    render(<App initialPath="/r/r1/console" />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(t('err.tokenMissing'));
  });

  it('shows the sandbox banner on the 404 page', () => {
    render(<App initialPath="/missing/page" />);
    expect(screen.getAllByText(t('banner.sandbox'))).toHaveLength(1);
  });

  it('moves focus and title after navigation', () => {
    render(<App initialPath="/" />);
    act(() => {
      navigate('/demo');
    });
    expect(document.title).toBe(t('landing.start'));
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }));
  });
});
