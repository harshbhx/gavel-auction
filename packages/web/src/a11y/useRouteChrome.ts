import { useEffect } from 'react';

import { titleFor, type RouteId, type RouteMatch } from '../routes';

/** Routes that manage their own title and focus: the landing page and the /try judge panel. */
const SELF_MANAGED: ReadonlySet<RouteId> = new Set<RouteId>([
  'landing',
  'about',
  'try',
  'gallery',
  'scriptedJoin',
]);

/** The longest a route may take to render its landmark and heading before the observer is dropped. */
export const ROUTE_CHROME_WATCH_MS = 60_000;

const INDEX_TITLE = typeof document === 'undefined' ? '' : document.title;

/**
 * What every real route owes a visitor who navigates without a page load (WCAG 2.4.1, 2.4.2):
 * a distinct document title, a main landmark the skip link can reach (id="main", focusable), and
 * focus moved to the page heading. Screens render late (a loading state, then the live room), so
 * the landmark and heading are looked up again whenever the page changes, until the focus moved.
 */
export function useRouteChrome(match: RouteMatch): void {
  const routeId = match.route.id;
  const title = titleFor(match);
  const key = `${routeId}|${match.params['roomId'] ?? ''}`;
  const selfManaged = SELF_MANAGED.has(routeId);

  useEffect(() => {
    if (routeId === 'landing' || routeId === 'about') {
      if (INDEX_TITLE !== '') document.title = INDEX_TITLE;
    } else if (!selfManaged) document.title = title;
  }, [routeId, selfManaged, title]);

  useEffect(() => {
    if (routeId === 'try' || routeId === 'gallery') return undefined;
    let focused: 'none' | 'main' | 'heading' = 'none';
    /** Looks the page over; true once there is nothing left to wait for. */
    const apply = (): boolean => {
      const main = document.querySelector<HTMLElement>('main');
      if (main === null) return false;
      // The skip link points at #main: a main that carries another id still has to answer to it.
      if (main.id !== 'main' && document.getElementById('main') === null) main.id = 'main';
      if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
      // The big screen is a display for a room, not a page a visitor works in: no focus ring on it.
      if (routeId === 'landing' || routeId === 'about' || routeId === 'screen') return true;
      if (focused === 'heading') return true;
      const heading = main.querySelector<HTMLElement>('h1');
      // Never take focus from something the visitor is already using.
      const active = document.activeElement;
      const free =
        active === null || active === document.body || active === main || active.tagName === 'H1';
      if (heading !== null) {
        if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
        if (free) heading.focus();
        focused = 'heading';
        return true;
      }
      if (focused === 'none' && free) {
        main.focus();
        focused = 'main';
      }
      return false;
    };
    if (apply()) return undefined;
    // Screens render late (a loading state, then the live room). The observer watches the whole
    // body, so it goes as soon as the landmark and heading are settled, and never outlives a
    // page that has no heading to wait for.
    let observer: MutationObserver | null = null;
    let giveUp: ReturnType<typeof setTimeout> | null = null;
    const stop = (): void => {
      observer?.disconnect();
      observer = null;
      if (giveUp !== null) clearTimeout(giveUp);
      giveUp = null;
    };
    observer = new MutationObserver(() => {
      if (apply()) stop();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    giveUp = setTimeout(stop, ROUTE_CHROME_WATCH_MS);
    return stop;
  }, [key, routeId]);
}
