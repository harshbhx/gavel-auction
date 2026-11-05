import { useEffect, useState } from 'react';

import { t } from '../../copy/t';
import { Icon } from '../../design/icons';
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
    <header aria-label={t('bid.price')}>
      <p style={{ ...NUMERIC, minWidth: '10ch', margin: 0 }} data-field="price">
        {formatUsd(priceCents ?? reserveCents)}
      </p>
      <p data-field="leader" style={{ minHeight: '1.5em', margin: 0 }}>
        {leaderPaddle === null ? null : t('bid.leader', { n: leaderPaddle })}
        {leaderName === null ? null : <span> {leaderName}</span>}
      </p>
      <p style={{ ...NUMERIC, margin: 0 }} data-field="count">
        {bidCount}
      </p>
      <p style={{ ...NUMERIC, minWidth: '6ch', margin: 0 }} data-field="countdown">
        <Icon name="clock" />
        <span>{formatCountdown(remaining)}</span>
      </p>
      <p style={{ ...NUMERIC, margin: 0 }} data-field="next">
        {t('bid.quick', { amount: formatUsd(nextMinCents) })}
      </p>
    </header>
  );
}
