import { useEffect, useRef, type ReactNode } from 'react';

import { t } from './copy/t';
import { Icon } from './design/icons';
import { Banner } from './design/primitives/Banner';
import { hasAuctioneerAccess } from './store/session';

export type RouteTitleKey =
  | 'landing.start'
  | 'landing.join'
  | 'reg.step1'
  | 'bid.price'
  | 'receipt.none'
  | 'demo.roleConsole'
  | 'demo.roleScreen'
  | 'audit.title'
  | 'replay.readonly'
  | 'app.name'
  | 'err.notFound';

export type RouteId =
  | 'landing'
  | 'demo'
  | 'join'
  | 'register'
  | 'bid'
  | 'receipt'
  | 'console'
  | 'screen'
  | 'audit'
  | 'replay'
  | 'gallery'
  | 'notFound';

export interface RouteDef {
  readonly id: RouteId;
  /** Path pattern; `:name` segments are parameters. `*` matches anything. */
  readonly path: string;
  readonly titleKey: RouteTitleKey;
  /** The route needs a stored session token for its room. */
  readonly needsToken?: boolean;
  /** Only present in dev and preview builds. */
  readonly devOnly?: boolean;
}

/** Route table (R-WEB-030). The first match wins; the catch-all is last. */
export const ROUTES: readonly RouteDef[] = [
  { id: 'landing', path: '/', titleKey: 'app.name' },
  { id: 'demo', path: '/demo', titleKey: 'landing.start' },
  { id: 'join', path: '/join/:roomId', titleKey: 'landing.join' },
  { id: 'register', path: '/r/:roomId/register', titleKey: 'reg.step1' },
  { id: 'bid', path: '/r/:roomId/bid', titleKey: 'bid.price' },
  { id: 'receipt', path: '/r/:roomId/receipt', titleKey: 'receipt.none' },
  { id: 'console', path: '/r/:roomId/console', titleKey: 'demo.roleConsole', needsToken: true },
  { id: 'screen', path: '/r/:roomId/screen', titleKey: 'demo.roleScreen' },
  { id: 'audit', path: '/r/:roomId/audit', titleKey: 'audit.title' },
  { id: 'replay', path: '/replay/:recordingId', titleKey: 'replay.readonly' },
  { id: 'gallery', path: '/gallery', titleKey: 'app.name', devOnly: true },
  { id: 'notFound', path: '*', titleKey: 'err.notFound' },
];

export interface RouteMatch {
  readonly route: RouteDef;
  readonly params: Readonly<Record<string, string>>;
}

function matchPath(pattern: string, pathname: string): Record<string, string> | null {
  if (pattern === '*') return {};
  const want = pattern.split('/').filter((s) => s !== '');
  const have = pathname.split('/').filter((s) => s !== '');
  if (want.length !== have.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < want.length; i += 1) {
    const w = want[i];
    const h = have[i];
    if (w === undefined || h === undefined) return null;
    if (w.startsWith(':')) {
      try {
        params[w.slice(1)] = decodeURIComponent(h);
      } catch {
        return null;
      }
    } else if (w !== h) {
      return null;
    }
  }
  return params;
}

export function matchRoute(pathname: string, options: { gallery: boolean }): RouteMatch {
  for (const route of ROUTES) {
    if (route.devOnly === true && !options.gallery) continue;
    const params = matchPath(route.path, pathname);
    if (params !== null) return { route, params };
  }
  const fallback = ROUTES[ROUTES.length - 1];
  if (fallback === undefined) throw new Error('route table is empty');
  return { route: fallback, params: {} };
}

/** Title is the route name, then the room name when the route has one (R-WEB-033). */
export function titleFor(match: RouteMatch): string {
  const name = t(match.route.titleKey);
  const room = match.params['roomId'];
  return room === undefined ? name : `${name} | ${room}`;
}

export interface RouteScreenProps {
  match: RouteMatch;
  /** Content shown under the main heading, for routes that have a real screen. */
  children?: ReactNode;
}

/** Placeholder screen for a route: sets the title and moves focus to the main heading. */
export function RouteScreen({ match, children }: RouteScreenProps): ReactNode {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const title = titleFor(match);
  const roomId = match.params['roomId'];
  const blocked =
    match.route.needsToken === true && (roomId === undefined || !hasAuctioneerAccess(roomId));

  useEffect(() => {
    document.title = title;
    headingRef.current?.focus();
  }, [title, match.route.id]);

  const showBanner = match.route.id === 'notFound' || blocked;
  return (
    <main data-route={match.route.id}>
      {showBanner && (
        <Banner tone="info" icon={<Icon name="lock" />}>
          {t('banner.sandbox')}
        </Banner>
      )}
      <h1 ref={headingRef} tabIndex={-1}>
        {blocked ? t('err.tokenMissing') : t(match.route.titleKey)}
      </h1>
      {children}
    </main>
  );
}
