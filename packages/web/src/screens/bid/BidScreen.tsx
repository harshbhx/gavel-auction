import { useEffect, useRef, useState, type FormEvent } from 'react';

import { announce } from '../../a11y/announce';
import { t } from '../../copy/t';
import { Icon } from '../../design/icons';
import { Banner } from '../../design/primitives/Banner';
import { Button } from '../../design/primitives/Button';
import { Field } from '../../design/primitives/Field';
import { useConnection } from '../../net/connection';
import {
  selectCeilingUsage,
  selectMyStatus,
  selectPrice,
  selectStream,
} from '../../store/selectors';
import { roomStore, useRoom, type RoomStore } from '../../store/roomStore';
import { formatUsd, formatUsdCompact, parseUsdToCents } from '../../util/money';
import { CeilingMeter } from './CeilingMeter';
import { myStatus, StatusChip } from './StatusChip';

export const REJECTION_CLEAR_MS = 6000;
const TAP_LOCK_MS = 800;
const QUICK_STEPS = 3;
const LAST_EVENTS = 5;

export interface BidRejection {
  /** Error code from the bid_rejected message. */
  reason: string;
}

export interface BidScreenProps {
  store?: RoomStore;
  /** Sends one bid, in cents. */
  onBid: (amountCents: number) => void;
  /** True while a sent bid has no answer yet. */
  pending?: boolean;
  /** The latest rejection, shown for 6 seconds. */
  rejection?: BidRejection | null;
}

function rejectionText(reason: string, maxCents: number | null, minCents: number): string {
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

/** Layout and read-only parts of the bidder screen (R-WEB-053). */
export function BidScreen({
  store = roomStore,
  onBid,
  pending = false,
  rejection = null,
}: BidScreenProps) {
  const price = useRoom(selectPrice, store);
  const base = useRoom(selectMyStatus, store);
  const usage = useRoom(selectCeilingUsage, store);
  const stream = useRoom(selectStream, store);
  const increment = useRoom((s) => s.snapshot?.config.minIncrement ?? 0, store);
  const reserve = useRoom((s) => s.snapshot?.config.reserve ?? 0, store);
  const auctionStatus = useRoom((s) => s.snapshot?.status ?? null, store);
  const connection = useConnection();

  const [custom, setCustom] = useState('');
  const [shown, setShown] = useState<BidRejection | null>(rejection);
  const lock = useRef(false);

  const status = myStatus(base, pending);
  const nextMin = price?.nextMinCents ?? reserve;
  const ceiling = usage?.maxCents ?? null;
  const canBid = base !== 'watching' && auctionStatus === 'OPEN';

  useEffect(() => {
    setShown(rejection);
    if (rejection === null) return undefined;
    const id = setTimeout(() => setShown(null), REJECTION_CLEAR_MS);
    return () => clearTimeout(id);
  }, [rejection]);

  const prevStatus = useRef(base);
  useEffect(() => {
    if (prevStatus.current !== 'outbid' && base === 'outbid') {
      announce(
        'polite',
        t('bid.announce.outbid', { amount: formatUsd(price?.currentCents ?? 0) }),
        'outbid',
      );
    }
    prevStatus.current = base;
  }, [base, price?.currentCents]);

  const send = (cents: number): void => {
    if (lock.current || pending) return;
    lock.current = true;
    setTimeout(() => {
      lock.current = false;
    }, TAP_LOCK_MS);
    onBid(cents);
  };

  const quick = Array.from({ length: QUICK_STEPS }, (_, i) => nextMin + i * increment);
  const customCents = parseUsdToCents(custom);
  const overCeiling = (cents: number): boolean => ceiling !== null && cents > ceiling;

  const submitCustom = (e: FormEvent): void => {
    e.preventDefault();
    if (customCents !== null && !overCeiling(customCents)) send(customCents);
  };

  const leader =
    price?.leaderPaddle === null || price === null
      ? null
      : t('bid.leader', { n: price.leaderPaddle });

  return (
    <main>
      <div>
        <Banner tone="info" icon={<Icon name="lock" />}>
          {t('banner.sandbox')}
        </Banner>
        {connection.offline && (
          <Banner tone="warn" icon={<Icon name="warning" />}>
            {t('net.offline')}
          </Banner>
        )}
        {auctionStatus === 'PAUSED' && (
          <Banner tone="warn" icon={<Icon name="pause" />}>
            {t('bid.paused')}
          </Banner>
        )}
        {(auctionStatus === 'CLOSING' ||
          auctionStatus === 'SETTLING' ||
          auctionStatus === 'DONE') && (
          <Banner tone="info" icon={<Icon name="stop" />}>
            {t('bid.closedBanner')}
          </Banner>
        )}
      </div>

      <section>
        <div data-slot="lot-image" aria-hidden="true" style={{ minHeight: 120 }} />
        {price === null && <p>{t('bid.waitingLot')}</p>}
      </section>

      <section aria-label={t('bid.price')}>
        <h1 tabIndex={-1}>{t('bid.price')}</h1>
        <p style={{ fontVariantNumeric: 'tabular-nums', minWidth: '8ch' }}>
          {formatUsd(price?.currentCents ?? reserve)}
        </p>
        {leader !== null && <p>{leader}</p>}
      </section>

      <StatusChip status={status} />

      {canBid && (
        <section>
          {quick.map((cents) => (
            <Button
              key={cents}
              size="bid"
              disabled={overCeiling(cents)}
              onClick={() => send(cents)}
            >
              {t('bid.quick', { amount: formatUsdCompact(cents) })}
            </Button>
          ))}
          {ceiling !== null && overCeiling(nextMin + increment) && <p>{t('bid.aboveCeiling')}</p>}
          <form onSubmit={submitCustom} noValidate>
            <Field
              label={t('bid.custom')}
              value={custom}
              inputMode="decimal"
              onChange={(e) => setCustom(e.target.value)}
            />
            <Button type="submit" disabled={customCents === null || overCeiling(customCents)}>
              {t('bid.place')}
            </Button>
          </form>
        </section>
      )}

      {shown !== null && <p role="alert">{rejectionText(shown.reason, ceiling, nextMin)}</p>}

      {usage !== null && <CeilingMeter usedCents={usage.usedCents} maxCents={usage.maxCents} />}

      <ul aria-label={t('console.stream')}>
        {stream.slice(-LAST_EVENTS).map((b) => (
          <li key={b.seq}>
            <span>{b.paddle === null ? null : t('bid.leader', { n: b.paddle })}</span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatUsd(b.amount)}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}
