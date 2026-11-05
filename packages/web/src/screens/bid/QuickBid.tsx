import { useCallback, useEffect, useRef } from 'react';

import { t } from '../../copy/t';
import { Button } from '../../design/primitives/Button';
import { formatUsdCompact } from '../../util/money';

export const TAP_GUARD_MS = 600;
export const QUICK_STEPS = 3;
const REASON_ID = 'quick-bid-reason';

/**
 * Wraps a send function so a second call within 600 ms, or while a bid has no answer yet, is
 * dropped. One deliberate action sends exactly one bid (R-WEB-057).
 */
export function useSendGuard(
  send: (cents: number) => void,
  pending: boolean,
): (cents: number) => void {
  const locked = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  return useCallback(
    (cents: number): void => {
      if (locked.current || pending) return;
      locked.current = true;
      timer.current = setTimeout(() => {
        locked.current = false;
      }, TAP_GUARD_MS);
      send(cents);
    },
    [send, pending],
  );
}

export interface QuickBidProps {
  /** Server price.nextMinCents. */
  nextMinCents: number;
  incrementCents: number;
  /** The bidder's ceiling in cents, or null when unknown. */
  ceilingCents: number | null;
  /** The guarded send. */
  onBid: (cents: number) => void;
}

/** Quick-bid buttons: the next minimum, then steps of the increment (R-WEB-055). */
export function QuickBid({ nextMinCents, incrementCents, ceilingCents, onBid }: QuickBidProps) {
  const over = (cents: number): boolean => ceilingCents !== null && cents > ceilingCents;
  const amounts = Array.from({ length: QUICK_STEPS }, (_, i) => nextMinCents + i * incrementCents);
  const anyOver = amounts.some(over);

  return (
    <div>
      {amounts.map((cents) => (
        <Button
          key={cents}
          size="bid"
          disabled={over(cents)}
          {...(over(cents) ? { 'aria-describedby': REASON_ID } : {})}
          onClick={() => onBid(cents)}
        >
          {t('bid.quick', { amount: formatUsdCompact(cents) })}
        </Button>
      ))}
      {anyOver && <p id={REASON_ID}>{t('bid.aboveCeiling')}</p>}
    </div>
  );
}
