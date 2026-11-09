import { useEffect, useState } from 'react';

import { t } from '../../copy/t';
import { Icon } from '../../design/icons';
import { PriceRoll } from '../../ui';
import { formatUsd } from '../../util/money';
import { formatCountdown } from '../../util/time';

export interface PriceHeaderProps {
  /** Current price in cents, or null before the first bid. */
  priceCents: number | null;
  /** Opening price shown while there is no bid yet. */
  reserveCents: number;
  leaderPaddle: number | null;
  leaderName: string | null;
  bidCount: number;
  /** When bidding closes, in server time (epoch ms). */
  endTs: number;
  /** Reads the current server time (see useServerNow). */
  now: () => number;
  nextMinCents: number;
  /** Tick period for the countdown, in ms. */
  tickMs?: number;
  /** Set while the clock is frozen: shown as is, and the countdown stops. */
  frozenMs?: number | null;
  /** The lot is closed: the clock stops and says so. */
  closed?: boolean;
}

/** Fixed width tabular numerals so a price change never moves the layout (R-WEB-064). */
const NUMERIC = { fontVariantNumeric: 'tabular-nums', fontFeatureSettings: '"tnum"' } as const;

/** Price, leader, bid count, time to close and next minimum for the auctioneer. */
export function PriceHeader({
  priceCents,
  reserveCents,
  leaderPaddle,
  leaderName,
  bidCount,
  endTs,
  now,
  nextMinCents,
  tickMs = 250,
  frozenMs = null,
  closed = false,
}: PriceHeaderProps) {
  const [ticking, setRemaining] = useState(() => endTs - now());
  const remaining = frozenMs ?? ticking;

  useEffect(() => {
    if (frozenMs !== null) return undefined;
    setRemaining(endTs - now());
    const id = setInterval(() => setRemaining(endTs - now()), tickMs);
    return () => clearInterval(id);
  }, [endTs, now, tickMs, frozenMs]);

  return (
    <header className="gv-console-board" aria-label={t('bid.price')}>
      <p
        className="gv-console-board__price"
        style={{ ...NUMERIC, minWidth: '10ch', margin: 0 }}
        data-field="price"
      >
        <PriceRoll cents={priceCents ?? reserveCents} />
      </p>
      <p
        className="gv-console-board__leader"
        data-field="leader"
        style={{ minHeight: '1.5em', margin: 0 }}
      >
        {leaderPaddle === null ? null : t('bid.leader', { n: leaderPaddle })}
        {leaderName === null ? null : <span> {leaderName}</span>}
      </p>
      <p className="gv-console-board__stat" style={{ ...NUMERIC, margin: 0 }} data-field="count">
        {bidCount}
      </p>
      <p
        className="gv-console-board__stat"
        style={{ ...NUMERIC, minWidth: '6ch', margin: 0 }}
        data-field="countdown"
      >
        <Icon name="clock" />
        <span>{closed ? t('console.clockClosed') : formatCountdown(remaining)}</span>
      </p>
      <p className="gv-console-board__stat" style={{ ...NUMERIC, margin: 0 }} data-field="next">
        {t('bid.quick', { amount: formatUsd(nextMinCents) })}
      </p>
    </header>
  );
}
