import { useEffect, useState } from 'react';
import { t } from '../copy/t';
import { Icon } from '../design/icons';
import { Banner } from '../design/primitives/Banner';
import { useConnection } from '../net/connection';
import './a11y.css';

/**
 * Shown while the server refuses this network as too busy (many devices behind one address, or a
 * burst of reconnects): says when the next attempt happens instead of a silent offline state.
 */
export function BusyBanner({ now = Date.now }: { now?: () => number }) {
  const { busyUntilMs } = useConnection();
  const [, tick] = useState(0);
  useEffect(() => {
    if (busyUntilMs === undefined) return undefined;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [busyUntilMs]);
  if (busyUntilMs === undefined) return null;
  const seconds = Math.max(1, Math.ceil((busyUntilMs - now()) / 1000));
  return (
    <div className="gv-offline" data-testid="busy-banner">
      <Banner tone="warn" icon={<Icon name="warning" />}>
        {t('err.net.tooMany', { seconds })}
      </Banner>
    </div>
  );
}
