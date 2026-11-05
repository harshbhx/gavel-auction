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
import { CeilingMeter } from './CeilingMeter';
import { ConfirmSheet } from './ConfirmSheet';
import { CustomBid } from './CustomBid';
import { QuickBid, useSendGuard } from './QuickBid';
import { Rejection, REJECTION_CLEAR_MS, type BidRejection } from './Rejection';
import { StateBanner, bidsLocked } from './StateBanner';
import { myStatus, StatusChip } from './StatusChip';
import { useOutbid } from './useOutbid';

export { REJECTION_CLEAR_MS };
export type { BidRejection };

const LAST_EVENTS = 5;

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
  const send = useSendGuard(onBid, pending);

  const leader =
    price?.leaderPaddle === null || price === null
      ? null
      : t('bid.leader', { n: price.leaderPaddle });
  const request = confirms[0] ?? null;

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
        <StateBanner status={auctionStatus} stopped={stopped} />
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

      <label>
        <input type="checkbox" checked={vibrate} onChange={(e) => setVibrate(e.target.checked)} />
        <span>{t('bid.vibrate')}</span>
      </label>

      {canBid && (
        <section
          data-testid="bid-bar"
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
        <div role="status">
          <p>{t('bid.unknown')}</p>
          {onResend !== undefined && (
            <Button disabled={connection.offline} onClick={onResend}>
              {t('bid.resend')}
            </Button>
          )}
        </div>
      )}

      {usage !== null && <CeilingMeter usedCents={usage.usedCents} maxCents={usage.maxCents} />}

      <ul aria-label={t('console.stream')}>
        {stream.slice(0, LAST_EVENTS).map((b) => (
          <li key={b.seq}>
            <span>{b.paddle === null ? null : t('bid.leader', { n: b.paddle })}</span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatUsd(b.amount)}</span>
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
