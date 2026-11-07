import { useEffect } from 'react';

import { announce } from '../../a11y/announce';
import { MuteToggle } from '../../alerts/MuteToggle';
import { useAlerts } from '../../alerts/useAlerts';
import { t } from '../../copy/t';
import { Icon } from '../../design/icons';
import { Banner } from '../../design/primitives/Banner';
import { Button } from '../../design/primitives/Button';
import { useServerNow } from '../../net/clock';
import { useConnection } from '../../net/connection';
import {
  selectCeilingUsage,
  selectConfirmQueue,
  selectMyStatus,
  selectAuctionStatus,
  selectPrice,
  selectStream,
} from '../../store/selectors';
import { roomStore, useRoom, type RoomStore } from '../../store/roomStore';
import { formatUsd } from '../../util/money';
import { HoldCard, PriceRoll, Skeleton, SkeletonGroup } from '../../ui';
import './bid.css';
import { CeilingMeter } from './CeilingMeter';
import { ConfirmSheet } from './ConfirmSheet';
import { CustomBid } from './CustomBid';
import { QuickBid, useSendGuard } from './QuickBid';
import { Rejection, REJECTION_CLEAR_MS, type BidRejection } from './Rejection';
import { StateBanner, bidsLocked, bidsNotice } from './StateBanner';
import { myStatus, StatusChip, type ChipStatus } from './StatusChip';
import { useOutbid } from './useOutbid';

export { REJECTION_CLEAR_MS };
export type { BidRejection };

const LAST_EVENTS = 5;

/** Whole-screen state colour: win for leading or won, out for outbid, danger for review. */
function kindOf(status: ChipStatus): 'win' | 'out' | 'review' | 'idle' {
  if (status === 'leading' || status === 'won') return 'win';
  if (status === 'outbid') return 'out';
  if (status === 'review') return 'review';
  return 'idle';
}

export interface BidScreenProps {
  store?: RoomStore;
  /** Sends one bid, in cents. */
  onBid: (amountCents: number) => void;
  /** True while a sent bid has no answer yet. */
  pending?: boolean;
  /** The latest rejection, shown until the price changes or 6 seconds pass. */
  rejection?: BidRejection | null;
  /** False while there is nowhere to send a bid yet. */
  canSend?: boolean;
  /** The latest bid got no answer or was never sent; the bidder may resend it. */
  unsent?: boolean;
  /** Sends the unanswered bid again under its original id. */
  onResend?: () => void;
  /** The amount a resend would send; shown next to the button. */
  unsentCents?: number | null;
  /** Replaces the unanswered bid with a new one when the price has moved above it. */
  onReplace?: (amountCents: number) => void;
  /** This bidder's paddle; with onConfirm it enables the confirm sheet. */
  myPaddle?: number;
  /** Sends one confirm_response. */
  onConfirm?: (confirmId: string, accept: boolean) => void;
  /** The room was stopped by the operator. */
  stopped?: boolean;
}

/** Layout of the bidder screen (R-WEB-053). */
export function BidScreen({
  store = roomStore,
  onBid,
  pending = false,
  rejection = null,
  canSend = true,
  unsent = false,
  onResend,
  unsentCents = null,
  onReplace,
  myPaddle,
  onConfirm,
  stopped = false,
}: BidScreenProps) {
  const price = useRoom(selectPrice, store);
  const base = useRoom(selectMyStatus, store);
  const usage = useRoom(selectCeilingUsage, store);
  const stream = useRoom(selectStream, store);
  const confirms = useRoom(selectConfirmQueue, store);
  const increment = useRoom((s) => s.snapshot?.config.minIncrement ?? 0, store);
  const reserve = useRoom((s) => s.snapshot?.config.reserve ?? 0, store);
  const auctionStatus = useRoom(selectAuctionStatus, store);
  const connection = useConnection();
  const serverNow = useServerNow(store);

  const status = myStatus(base, pending);
  const nextMin = price?.nextMinCents ?? reserve;
  const ceiling = usage?.maxCents ?? null;
  // Bid controls stay off while the connection is down: the offline banner says why.
  const canBid =
    base !== 'watching' && !bidsLocked(auctionStatus, stopped) && canSend && !connection.offline;

  const { vibrate, setVibrate } = useOutbid(base, price?.currentCents ?? 0);
  useAlerts(store);
  // A bid with no answer keeps new bids locked until it is answered or resent, so two amounts
  // can never both stand.
  const send = useSendGuard(onBid, pending || unsent);

  const notice = bidsNotice(auctionStatus, stopped);
  useEffect(() => {
    if (notice !== null) announce('assertive', t(notice), 'stop');
  }, [notice]);

  const offline = connection.offline;
  useEffect(() => {
    if (offline) announce('assertive', t('net.offline'), 'offline');
  }, [offline]);

  const leader =
    price?.leaderPaddle === null || price === null
      ? null
      : t('bid.leader', { n: price.leaderPaddle });
  const request = confirms[0] ?? null;
  const requestId = request?.confirmId ?? null;
  const requestAmount = request?.amount ?? null;
  useEffect(() => {
    if (requestId === null || requestAmount === null || myPaddle === undefined) return;
    announce('assertive', t('confirm.title', { amount: formatUsd(requestAmount), n: myPaddle }));
  }, [requestId, requestAmount, myPaddle]);

  const screenKind = request !== null && myPaddle !== undefined ? 'confirm' : kindOf(status);
  const ceilingHold = usage === null ? null : usage.maxCents;

  return (
    <main className="bid" data-k={screenKind}>
      <div className="bid__notices">
        {connection.offline && (
          <Banner tone="warn" icon={<Icon name="warning" />}>
            {t('net.offline')}
          </Banner>
        )}
        <StateBanner status={auctionStatus} stopped={stopped} />
      </div>

      <div className="bid__status">
        <StatusChip status={status} />
      </div>

      <section className="bid__lot">
        <div data-slot="lot-image" aria-hidden="true" className="bid__lotimg" />
        {price === null && <p className="bid__wait">{t('bid.waitingLot')}</p>}
      </section>

      <section aria-label={t('bid.price')} className="bid__panel bid__priceboard">
        <h1 tabIndex={-1} className="bid__kicker">
          {t('bid.price')}
        </h1>
        {price === null ? (
          <SkeletonGroup>
            <Skeleton height="3.5rem" width="70%" />
          </SkeletonGroup>
        ) : (
          <PriceRoll cents={price.currentCents ?? reserve} className="bid__price" />
        )}
        {leader !== null && <p className="bid__leader">{leader}</p>}
      </section>

      {ceilingHold !== null && (
        <HoldCard
          state="held"
          ceilingCents={ceilingHold}
          {...(myPaddle === undefined ? {} : { caption: t('reg.yourPaddle', { n: myPaddle }) })}
        />
      )}

      <label className="bid__vibrate">
        <input type="checkbox" checked={vibrate} onChange={(e) => setVibrate(e.target.checked)} />
        <span>{t('bid.vibrate')}</span>
      </label>
      <MuteToggle />

      {canBid && !unsent && (
        <section
          data-testid="bid-bar"
          className="bid__bar"
          style={{
            position: 'sticky',
            bottom: 0,
            paddingBottom: 'env(safe-area-inset-bottom)',
          }}
        >
          <QuickBid
            nextMinCents={nextMin}
            incrementCents={increment}
            ceilingCents={ceiling}
            onBid={send}
          />
          <CustomBid nextMinCents={nextMin} ceilingCents={ceiling} onBid={send} />
        </section>
      )}

      <Rejection
        rejection={rejection}
        priceCents={price?.currentCents ?? null}
        maxCents={ceiling}
        minCents={nextMin}
      />

      {unsent && !pending && (
        <div role="status" className="bid__panel bid__unsent">
          <p>{t('bid.unknown')}</p>
          {unsentCents !== null && unsentCents < nextMin && onReplace !== undefined ? (
            <Button disabled={connection.offline} onClick={() => onReplace(nextMin)}>
              {t('bid.resendCurrent', { amount: formatUsd(nextMin) })}
            </Button>
          ) : (
            onResend !== undefined && (
              <Button disabled={connection.offline} onClick={onResend}>
                {unsentCents === null
                  ? t('bid.resend')
                  : t('bid.resendAmount', { amount: formatUsd(unsentCents) })}
              </Button>
            )
          )}
        </div>
      )}

      {usage !== null && <CeilingMeter usedCents={usage.usedCents} maxCents={usage.maxCents} />}

      <ul aria-label={t('console.stream')} className="bid__stream">
        {stream.slice(0, LAST_EVENTS).map((b) => (
          <li key={b.seq}>
            <span>{b.paddle === null ? null : t('bid.leader', { n: b.paddle })}</span>
            <span className="bid__amt">{formatUsd(b.amount)}</span>
          </li>
        ))}
      </ul>

      {onConfirm !== undefined && myPaddle !== undefined && (
        <ConfirmSheet
          request={request}
          paddle={myPaddle}
          currentCents={price?.currentCents ?? null}
          onRespond={onConfirm}
          now={serverNow}
        />
      )}
    </main>
  );
}
