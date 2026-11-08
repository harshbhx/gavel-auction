import { useEffect, useState } from 'react';
import { t } from '../copy/t';
import { Icon } from '../design/icons';
import { Banner } from '../design/primitives/Banner';
import { useConnection } from '../net/connection';
import './a11y.css';

function browserOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

/** True while the browser reports no network. */
export function useBrowserOnline(): boolean {
  const [online, setOnline] = useState(browserOnline);
  useEffect(() => {
    const sync = (): void => setOnline(browserOnline());
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, []);
  return online;
}

/**
 * A live-region notice for pages with no banner of their own (hub, screen, join, console): the
 * browser lost its network, or the room's socket has been down long enough to count as offline.
 */
export function OfflineBanner() {
  const online = useBrowserOnline();
  const connection = useConnection();
  if (online && !connection.offline) return null;
  return (
    <div className="gv-offline" data-testid="offline-banner">
      <Banner tone="warn" icon={<Icon name="warning" />}>
        {t('net.offline')}
      </Banner>
    </div>
  );
}
