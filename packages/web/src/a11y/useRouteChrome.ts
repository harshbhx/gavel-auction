import { useEffect } from 'react';

import { titleFor, type RouteId, type RouteMatch } from '../routes';

/** Routes that manage their own title and focus: the landing page and the /try judge panel. */
const SELF_MANAGED: ReadonlySet<RouteId> = new Set<RouteId>([
  'landing',
  'try',
  'gallery',
  'scriptedJoin',
]);

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
    if (routeId === 'landing') {
      if (INDEX_TITLE !== '') document.title = INDEX_TITLE;
    } else if (!selfManaged) document.title = title;
  }, [routeId, selfManaged, title]);

  useEffect(() => {
    if (routeId === 'try' || routeId === 'gallery') return undefined;
    let focused: 'none' | 'main' | 'heading' = 'none';
    const apply = (): void => {
      const main = document.querySelector<HTMLElement>('main');
      if (main === null) return;
      if (main.id === '') main.id = 'main';
      if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
      if (routeId === 'landing' || focused === 'heading') return;
      const heading = main.querySelector<HTMLElement>('h1');
      // Never take focus from something the visitor is already using.
      const active = document.activeElement;
      const free =
        active === null || active === document.body || active === main || active.tagName === 'H1';
      if (heading !== null) {
        if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
        if (free) heading.focus();
        focused = 'heading';
      } else if (focused === 'none' && free) {
        main.focus();
        focused = 'main';
      }
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [key, routeId]);
}
