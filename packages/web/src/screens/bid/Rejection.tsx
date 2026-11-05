import { useEffect, useRef, useState } from 'react';

import { t } from '../../copy/t';
import { formatUsd, formatUsdCompact } from '../../util/money';

export const REJECTION_CLEAR_MS = 6000;

export interface BidRejection {
  /** Error code from the bid_rejected message. */
  reason: string;
}

export interface RejectionProps {
  rejection: BidRejection | null;
  /** Current price in cents; a change clears the message. */
  priceCents: number | null;
  maxCents: number | null;
  minCents: number;
}

export function rejectionText(reason: string, maxCents: number | null, minCents: number): string {
  switch (reason) {
    case 'over_ceiling':
      return t('bid.rej.over_ceiling', { max: formatUsdCompact(maxCents ?? 0) });
    case 'below_increment':
      return t('bid.rej.below_increment', { min: formatUsd(minCents) });
    case 'closed':
      return t('bid.rej.closed');
    case 'already_leading':
      return t('bid.rej.already_leading');
    case 'below_reserve':
      return t('bid.rej.below_reserve');
    case 'unregistered':
      return t('bid.rej.unregistered');
    default:
      return t('bid.rej.generic');
  }
}

/** Inline rejection under the buttons: stays until the price changes or 6000 ms pass (R-WEB-059). */
export function Rejection({ rejection, priceCents, maxCents, minCents }: RejectionProps) {
  const [shown, setShown] = useState<BidRejection | null>(rejection);
  const baseline = useRef<number | null>(priceCents);
  const latestPrice = useRef<number | null>(priceCents);
  latestPrice.current = priceCents;

  useEffect(() => {
    setShown(rejection);
    baseline.current = latestPrice.current;
    if (rejection === null) return undefined;
    const id = setTimeout(() => setShown(null), REJECTION_CLEAR_MS);
    return () => clearTimeout(id);
  }, [rejection]);

  useEffect(() => {
    if (priceCents !== baseline.current) {
      baseline.current = priceCents;
      setShown(null);
    }
  }, [priceCents]);

  if (shown === null) return null;
  return <p role="alert">{rejectionText(shown.reason, maxCents, minCents)}</p>;
}
