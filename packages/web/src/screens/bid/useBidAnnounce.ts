import { useEffect, useRef } from 'react';

import { announce } from '../../a11y/announce';
import { t } from '../../copy/t';
import { formatUsd } from '../../util/money';

/** A price frame this soon after the bidder turned outbid is the one the outbid message says. */
export const OUTBID_PRICE_WINDOW_MS = 1000;

/**
 * Speaks what changes on the bidder route through the app announcer (WCAG 4.1.3): the bidder
 * taking the lead, a rival's bid, and the result at the hammer. The outbid message has its own
 * hook (`useOutbid`), so a price change that only repeats it stays silent. Nothing is spoken for
 * the state a page loads with.
 */
export function useBidAnnounce(status: string, cents: number, closed: boolean): void {
  const prev = useRef({ status, cents, closed });
  const outbidAt = useRef<number | null>(null);

  useEffect(() => {
    const before = prev.current;
    prev.current = { status, cents, closed };
    const amount = formatUsd(cents);

    if (status === 'outbid' && before.status !== 'outbid') outbidAt.current = Date.now();

    if (closed) {
      const resultChanged = before.status !== status || !before.closed;
      if (!resultChanged || cents <= 0) return;
      if (status === 'won') announce('assertive', t('bid.announce.won', { amount }), 'summary');
      else if (status === 'lost')
        announce('assertive', t('bid.announce.lost', { amount }), 'summary');
      else if (status === 'watching')
        announce('assertive', t('bid.announce.closed', { amount }), 'summary');
      return;
    }

    if (cents <= 0) return;
    if (status === 'leading' && before.status !== 'leading') {
      announce('polite', t('bid.announce.leading', { amount }), 'price');
      return;
    }
    if (cents === before.cents || status === 'leading') return;
    const justOutbid =
      status === 'outbid' &&
      outbidAt.current !== null &&
      Date.now() - outbidAt.current < OUTBID_PRICE_WINDOW_MS;
    if (justOutbid) return;
    announce('polite', t('bid.announce.rival', { amount }), 'price');
  }, [status, cents, closed]);
}
