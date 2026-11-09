import type { MouseEvent } from 'react';

import { t } from '../copy/t';
import { Logo } from '../design/Logo';
import './homeLink.css';

/** Same event the app shell listens to for client-side navigation (see navigate in App.tsx). */
const NAVIGATE_EVENT = 'gavel:navigate';

export interface HomeLinkProps {
  /** The current route id. The landing page has no link to itself. */
  routeId: string;
}

/**
 * The one way back to the landing page from every other screen: the GAVEL mark and a text 'Home'
 * link, first in the page chrome under the sandbox notice. It only navigates; leaving never closes
 * a room. On the projection screen it stays out of sight and shows only on keyboard focus.
 */
export function HomeLink({ routeId }: HomeLinkProps) {
  if (routeId === 'landing' || routeId === 'gallery') return null;
  const onClick = (e: MouseEvent<HTMLAnchorElement>): void => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
      return;
    }
    e.preventDefault();
    window.history.pushState(null, '', '/');
    window.dispatchEvent(new Event(NAVIGATE_EVENT));
  };
  return (
    <div
      className={routeId === 'screen' ? 'gv-home gv-home--quiet' : 'gv-home'}
      data-testid="home-nav"
    >
      <a className="gv-home__link" href="/" aria-label={t('nav.homeLabel')} onClick={onClick}>
        <Logo variant="mark" height={24} decorative />
        <span aria-hidden="true">{t('nav.home')}</span>
      </a>
    </div>
  );
}
