import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { t } from '../../src/copy/t';
import { HelpLayer } from '../../src/help';
import { readScriptedRequest } from '../../src/net/scriptedMode';
import { PALETTE_STORAGE_KEY } from '../../src/ui/palette';
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

describe('palette control in the help menu', () => {
  it('is mounted, keyboard operable and stores the choice', () => {
    render(<HelpLayer autoStart={false} />);
    fireEvent.click(screen.getByRole('button', { name: t('help.button') }));
    const group = screen.getByRole('group', { name: t('ui.palette.group') });
    expect(group).toBeTruthy();
    const night = screen.getByRole('button', { name: t('ui.palette.b') });
    expect(night.tagName).toBe('BUTTON');
    fireEvent.click(night);
    expect(night.getAttribute('aria-pressed')).toBe('true');
    expect(window.localStorage.getItem(PALETTE_STORAGE_KEY)).toBe('b');
  });

  it('has no axe violations', async () => {
    const { container } = render(<HelpLayer autoStart={false} />);
    fireEvent.click(screen.getByRole('button', { name: t('help.button') }));
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toEqual([]);
  });
});
