import { useEffect, useRef, useState } from 'react';

import { errorCopy } from '../../copy/errors';
import { t } from '../../copy/t';
import { formatUsd, formatUsdCompact } from '../../util/money';

export const REJECTION_CLEAR_MS = 6000;

export interface BidRejection {
  /** Error code from the bid_rejected message. */
  reason: string;
  /** The id of the rejected bid, so two identical rejections in a row are told apart. */
  mid?: string;
}

export interface RejectionProps {
  rejection: BidRejection | null;
  /** Current price in cents; a change clears the message. */
  priceCents: number | null;
  maxCents: number | null;
  minCents: number;
}

export function rejectionText(reason: string, maxCents: number | null, minCents: number): string {
  const { key } = errorCopy(reason);
  switch (key) {
    case 'bid.rej.over_ceiling':
      return maxCents === null
        ? t('bid.rej.over_ceiling_unknown')
        : t('bid.rej.over_ceiling', { max: formatUsdCompact(maxCents) });
    case 'bid.rej.below_increment':
      return t('bid.rej.below_increment', { min: formatUsd(minCents) });
    default:
      return t(key);
  }
}

/** Inline rejection under the buttons: stays until the price changes or 6000 ms pass (R-WEB-059). */
export function Rejection({ rejection, priceCents, maxCents, minCents }: RejectionProps) {
  const [shown, setShown] = useState<BidRejection | null>(rejection);
  const baseline = useRef<number | null>(priceCents);
  const latestPrice = useRef<number | null>(priceCents);
  latestPrice.current = priceCents;

  // Keyed on the reason and the bid id, not on the object: a parent that rebuilds an equal object
  // on every render must not show an old rejection again or restart its timer.
  const latestRejection = useRef(rejection);
  latestRejection.current = rejection;
  const reason = rejection?.reason ?? null;
  const mid = rejection?.mid ?? null;

  useEffect(() => {
    setShown(latestRejection.current);
    baseline.current = latestPrice.current;
    if (reason === null) return undefined;
    const id = setTimeout(() => setShown(null), REJECTION_CLEAR_MS);
    return () => clearTimeout(id);
  }, [reason, mid]);

  useEffect(() => {
    if (priceCents !== baseline.current) {
      baseline.current = priceCents;
      setShown(null);
    }
  }, [priceCents]);

  if (shown === null) return null;
  return <p role="alert">{rejectionText(shown.reason, maxCents, minCents)}</p>;
}
