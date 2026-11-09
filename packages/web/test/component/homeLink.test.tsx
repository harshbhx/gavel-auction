import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../../src/App';
import { t } from '../../src/copy/t';
import { HomeLink } from '../../src/nav/HomeLink';
import { ROUTES } from '../../src/routes';

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  window.history.replaceState(null, '', '/');
});

const samplePath = (pattern: string): string =>
  pattern === '*' ? '/nope/at/all' : pattern.replace(/:[A-Za-z]+/g, 'r1');

describe('home link', () => {
  it('has the copy keys', () => {
    expect(t('nav.home')).toBe('Home');
    expect(t('nav.homeLabel')).toBe('GAVEL home');
  });

  it('is absent on the landing page', () => {
    render(<App initialPath="/" gallery={false} />);
    expect(screen.queryByRole('link', { name: t('nav.homeLabel') })).toBeNull();
  });

  const others = ROUTES.filter((r) => r.id !== 'landing' && r.id !== 'gallery');

  it.each(others.map((r) => [r.id, samplePath(r.path)] as const))(
    'is a link to / on %s',
    (_id, path) => {
      const { container } = render(<App initialPath={path} gallery={false} />);
      const link = container.querySelector('a.gv-home__link');
      expect(link).not.toBeNull();
      expect(link?.getAttribute('href')).toBe('/');
      expect(link?.getAttribute('aria-label')).toBe('GAVEL home');
      expect(container.querySelectorAll('a.gv-home__link')).toHaveLength(1);
    },
  );

  it('is quiet (focus-only) on the projection screen and plain elsewhere', () => {
    const screenView = render(<HomeLink routeId="screen" />);
    expect(screenView.getByTestId('home-nav').className).toContain('gv-home--quiet');
    screenView.unmount();
    const bid = render(<HomeLink routeId="bid" />);
    expect(bid.getByTestId('home-nav').className).not.toContain('quiet');
  });

  it('navigates to / without a reload', () => {
    window.history.replaceState(null, '', '/verify');
    render(<App initialPath="/verify" gallery={false} />);
    fireEvent.click(screen.getByRole('link', { name: t('nav.homeLabel') }));
    expect(window.location.pathname).toBe('/');
  });

  it('has no serious axe violations', async () => {
    const { container } = render(<HomeLink routeId="bid" />);
    const result = await axe.run(container);
    const serious = result.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(serious).toEqual([]);
  });
});
