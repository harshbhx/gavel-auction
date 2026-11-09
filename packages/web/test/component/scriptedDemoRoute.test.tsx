import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { t } from '../../src/copy/t';
import { HelpLayer } from '../../src/help';
import { readScriptedRequest } from '../../src/net/scriptedMode';
import { matchRoute } from '../../src/routes';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('/demo/scripted', () => {
  it('matches its own route', () => {
    expect(matchRoute('/demo/scripted', { gallery: false }).route.id).toBe('scriptedDemo');
    expect(matchRoute('/demo', { gallery: false }).route.id).toBe('demo');
  });

  it('plays the scenario with no socket and the scripted label', async () => {
    const sockets: string[] = [];
    class Spy {
      readonly readyState = 0;
      constructor(url: string) {
        sockets.push(url);
      }
      close(): void {
        // Nothing to close.
      }
    }
    vi.stubGlobal('WebSocket', Spy);
    render(<App initialPath="/demo/scripted" gallery={false} />);
    await waitFor(() => expect(screen.getByText(t('prov.scripted'))).toBeTruthy());
    expect(sockets).toEqual([]);
  });

  it('keeps the query flag off in a production build', () => {
    expect(readScriptedRequest('?scripted=1', false)).toBeNull();
  });
});

describe('help menu', () => {
  it('has no colour or theme control and ignores an old stored palette', () => {
    window.localStorage.setItem('gavel.palette', 'b');
    render(<HelpLayer />);
    fireEvent.click(screen.getByRole('button', { name: t('help.button') }));
    expect(screen.queryByRole('group', { name: /palette|theme|colour/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /night board|salon/i })).toBeNull();
    expect(document.documentElement.hasAttribute('data-pal')).toBe(false);
  });

  it('has no axe violations', async () => {
    const { container } = render(<HelpLayer />);
    fireEvent.click(screen.getByRole('button', { name: t('help.button') }));
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toEqual([]);
  });
});
