import { Suspense, lazy, useEffect, useState } from 'react';

import { announce } from '../../a11y/announce';
import { MuteToggle } from '../../alerts/MuteToggle';
import { useAlerts } from '../../alerts/useAlerts';
import { t } from '../../copy/t';
import { Icon } from '../../design/icons';
import { Banner } from '../../design/primitives/Banner';
import { Button } from '../../design/primitives/Button';
import { useServerNow } from '../../net/clock';
import { useConnection } from '../../net/connection';
import type { PaymentApprovalPort } from '../../payments/port';
import {
  selectCeilingUsage,
  selectConfirmQueue,
  selectMyStatus,
  type MyStatus,
  selectAuctionStatus,
  selectPrice,
  selectStream,
} from '../../store/selectors';
import { roomStore, useRoom, type RoomStore } from '../../store/roomStore';
import { formatUsd, formatUsdCompact } from '../../util/money';
import { HoldCard, PriceRoll, Skeleton, SkeletonGroup } from '../../ui';
import './bid.css';
import { CeilingMeter } from './CeilingMeter';
import { CustomBid } from './CustomBid';
import { QuickBid, useSendGuard } from './QuickBid';
import { RaiseLimit } from './RaiseLimit';
import { Rejection, REJECTION_CLEAR_MS, type BidRejection } from './Rejection';
import { StateBanner, bidsLocked, bidsNotice } from './StateBanner';
import { myStatus, StatusChip, type ChipStatus } from './StatusChip';
import { useBidAnnounce } from './useBidAnnounce';
import { useOutbid } from './useOutbid';
import type { EndOutcome } from './EndDialog';
import { markWinnerSeen, winnerSeen, winnerSeenKey } from './winnerSeen';

// Loaded on first use: a confirm question is rare, and this keeps the first route small.
const ConfirmSheet = lazy(() =>
  import('./ConfirmSheet').then((m) => ({ default: m.ConfirmSheet })),
);

// Loaded when the lot ends: most visits never see it.
const EndDialog = lazy(() => import('./EndDialog').then((m) => ({ default: m.EndDialog })));

export { REJECTION_CLEAR_MS };
export type { BidRejection };

const LAST_EVENTS = 5;
/** The next bid is within this share of the limit: the screen starts offering a raise. */
const NEAR_LIMIT_SHARE = 0.8;

/** Whole-screen state colour: win for leading or won, out for outbid, danger for review. */
function kindOf(status: ChipStatus): 'win' | 'out' | 'review' | 'idle' {
  if (status === 'leading' || status === 'won') return 'win';
  if (status === 'outbid') return 'out';
  if (status === 'review') return 'review';
  return 'idle';
}

/** How the lot ended for this person, or null while it is still running (or under review). */
function endOutcome(base: MyStatus, closedLot: boolean, cents: number): EndOutcome | null {
  if (!closedLot || base === 'review') return null;
  if (cents <= 0) return 'noSale';
  if (base === 'won' || base === 'leading') return 'won';
  return base === 'watching' ? 'sold' : 'lost';
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
  /** End pop-up: "Go home". The pop-up shows only when onHome and onJoinCode are given. */
  onHome?: () => void;
  /** End pop-up: "Join room" (the join entry with the code field focused). */
  onJoinCode?: () => void;
  /** End pop-up: "View receipt", offered to bidders who have one. */
  onReceipt?: () => void;
  /** Lot title from the room's public summary, used while the live snapshot has none. */
  lotTitleFallback?: string | null;
  /** A recording plays instead of a room: bids cannot be taken, so the controls give the reason. */
  recorded?: boolean;
  /** Sends a bidder with no registered hold back to registration. */
  onJoin?: () => void;
  /**
   * What the bidder needs to hold a higher limit (FEAT-61). Without it the screen does not offer
   * a raise (replays, the scripted demo).
   */
  raise?: {
    port: PaymentApprovalPort;
    roomId: string;
    bidderId: string;
    /** Whether the room takes a typed limit (false: only its presets). */
    allowCustom?: boolean;
  };
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
  onJoin,
  lotTitleFallback = null,
  recorded = false,
  onHome,
  onJoinCode,
  onReceipt,
  raise,
}: BidScreenProps) {
  const price = useRoom(selectPrice, store);
  const base = useRoom(selectMyStatus, store);
  const usage = useRoom(selectCeilingUsage, store);
  const stream = useRoom(selectStream, store);
  const confirms = useRoom(selectConfirmQueue, store);
  const increment = useRoom((s) => s.snapshot?.config.minIncrement ?? 0, store);
  const reserve = useRoom((s) => s.snapshot?.config.reserve ?? 0, store);
  const auctionStatus = useRoom(selectAuctionStatus, store);
  const lotTitle = useRoom((s) => s.snapshot?.lotTitle ?? null, store);
  const loaded = useRoom((s) => s.snapshot !== null, store);
  const connection = useConnection();
  const serverNow = useServerNow(store);
  const presets = useRoom((s) => s.snapshot?.config.ceilingPresets, store);
  const cap = useRoom((s) => s.snapshot?.maxCeilingCents, store);
  const [raising, setRaising] = useState(false);
  const roomId = useRoom((s) => s.auctionId, store);

  const status = myStatus(base, pending);
  const nextMin = price?.nextMinCents ?? reserve;
  const ceiling = usage?.maxCents ?? null;
  // Bid controls stay off while the connection is down: the offline banner says why.
  const canBid =
    base !== 'watching' && !bidsLocked(auctionStatus, stopped) && canSend && !connection.offline;

  // The reason the bid controls are missing; paused, closed, stopped and offline have banners.
  let blockedReason: string | null = null;
  if (base === 'watching' && loaded) blockedReason = t('bid.watchingOnly');
  else if (!canSend && !bidsLocked(auctionStatus, stopped)) blockedReason = t('bid.notConnected');

  const { vibrate, setVibrate } = useOutbid(base, price?.currentCents ?? 0);
  const closedLot =
    auctionStatus === 'CLOSING' || auctionStatus === 'SETTLING' || auctionStatus === 'DONE';
  useBidAnnounce(base, price?.currentCents ?? 0, closedLot);
  useAlerts(store);
  // A bid with no answer keeps new bids locked until it is answered or resent, so two amounts
  // can never both stand.
  const send = useSendGuard(onBid, pending || unsent);

  // The end pop-up: once per lot, for everyone in the room (winner, loser, watcher, no sale).
  const wonCents = price?.currentCents ?? 0;
  const winKey = winnerSeenKey(roomId, wonCents);
  const [winClosed, setWinClosed] = useState<string | null>(null);
  const outcome = endOutcome(base, closedLot, wonCents);
  const showEnd =
    outcome !== null &&
    onHome !== undefined &&
    onJoinCode !== undefined &&
    winClosed !== winKey &&
    !winnerSeen(winKey);
  const closeEnd = (after?: () => void): void => {
    markWinnerSeen(winKey);
    setWinClosed(winKey);
    after?.();
  };

  const notice = bidsNotice(auctionStatus, stopped);
  // The result line ("You won at ...") already says the lot closed, so the bare notice stays quiet.
  const resultSpoken =
    closedLot &&
    (price?.currentCents ?? 0) > 0 &&
    (base === 'won' || base === 'lost' || base === 'watching');
  useEffect(() => {
    if (notice === 'bid.closedBanner' && resultSpoken) return;
    if (notice !== null) announce('assertive', t(notice), 'stop');
  }, [notice, resultSpoken]);

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

  // A bidder can raise the limit while the lot takes bids; the cap is the real server cap.
  const canRaise =
    raise !== undefined &&
    base !== 'watching' &&
    ceiling !== null &&
    !bidsLocked(auctionStatus, stopped) &&
    (cap === undefined || ceiling < cap);
  const mustRaise = ceiling !== null && nextMin > ceiling;
  const raiseHint =
    ceiling === null
      ? null
      : base === 'outbid'
        ? t('raise.hintOutbid')
        : !mustRaise && nextMin >= ceiling * NEAR_LIMIT_SHARE
          ? t('raise.hintNear')
          : null;
  if (raising && canRaise && raise !== undefined && ceiling !== null) {
    return (
      <RaiseLimit
        port={raise.port}
        roomId={raise.roomId}
        bidderId={raise.bidderId}
        currentCents={ceiling}
        maxCents={cap ?? Math.max(ceiling, ...(presets ?? []))}
        {...(raise.allowCustom === undefined ? {} : { allowCustom: raise.allowCustom })}
        onClose={() => setRaising(false)}
      />
    );
  }

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

      <div className="bid__cols">
        <div className="bid__col bid__col--lot">
          <section aria-label={t('bid.price')} className="bid__panel bid__priceboard">
            <div className="bid__pricehead">
              <h1 tabIndex={-1} className="bid__kicker">
                {t('bid.price')}
              </h1>
              <StatusChip status={status} />
            </div>
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
            <section aria-label={t('bid.position.title')} className="bid__position">
              <HoldCard
                state="held"
                legend={false}
                ceilingCents={ceilingHold}
                {...(myPaddle === undefined
                  ? {}
                  : { caption: t('reg.yourPaddle', { n: myPaddle }) })}
              />
              {usage !== null && (
                <CeilingMeter usedCents={usage.usedCents} maxCents={usage.maxCents} />
              )}
            </section>
          )}

          {canRaise && (
            <section className="bid__panel bid__raise" data-testid="raise-limit">
              {raiseHint !== null && (
                <p role="status" data-testid="raise-hint">
                  {raiseHint}
                </p>
              )}
              <Button
                variant={raiseHint === null && !mustRaise ? 'outline' : 'solid'}
                onClick={() => setRaising(true)}
              >
                {t('raise.cta')}
              </Button>
            </section>
          )}

          <section className="bid__lot">
            {price === null && <p className="bid__wait">{t('bid.waitingLot')}</p>}
          </section>
        </div>

        <div className="bid__col bid__col--act">
          <div className="bid__prefs">
            <label className="bid__vibrate">
              <input
                type="checkbox"
                checked={vibrate}
                onChange={(e) => setVibrate(e.target.checked)}
              />
              <span>{t('bid.vibrate')}</span>
            </label>
            <MuteToggle />
          </div>
          {base === 'watching' && onJoin !== undefined && (
            <Button size="bid" onClick={onJoin}>
              {t('join.asBidder')}
            </Button>
          )}

          {blockedReason !== null && (
            <p role="status" data-testid="bid-blocked" className="bid__panel">
              {blockedReason}
            </p>
          )}

          {canBid && !unsent && pending && (
            <p role="status" data-testid="bid-sent">
              {t('bid.sentWaiting')}
            </p>
          )}

          {canBid && !unsent && ceiling !== null && nextMin > ceiling && (
            <p role="status" data-testid="bid-at-ceiling">
              {t('bid.atCeiling', { min: formatUsd(nextMin), max: formatUsdCompact(ceiling) })}
            </p>
          )}

          {canBid && recorded && (
            <section className="bid__panel bid__recorded" data-testid="bid-recorded">
              <p role="status">{t('bid.recorded')}</p>
              <a className="ui-link" href="/demo">
                {t('bid.recordedLive')}
              </a>
            </section>
          )}

          {canBid && !recorded && !unsent && (
            <section
              data-testid="bid-bar"
              className="bid__bar"
              style={{
                position: 'sticky',
                paddingBottom: 'env(safe-area-inset-bottom)',
              }}
            >
              <p className="bid__barprice" data-testid="bid-bar-price">
                <span>{t('bid.barNow', { price: formatUsd(price?.currentCents ?? reserve) })}</span>
                {ceiling !== null && (
                  <span>{t('bid.barLimit', { max: formatUsdCompact(ceiling) })}</span>
                )}
              </p>
              <QuickBid
                nextMinCents={nextMin}
                incrementCents={increment}
                ceilingCents={ceiling}
                onBid={send}
              />
              <CustomBid
                nextMinCents={nextMin}
                ceilingCents={ceiling}
                incrementCents={increment}
                onBid={send}
                {...(canRaise ? { onRaise: () => setRaising(true) } : {})}
              />
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

          <ul aria-label={t('console.stream')} className="bid__stream">
            {stream.slice(0, LAST_EVENTS).map((b, i) => (
              <li key={b.seq}>
                <span>
                  {b.paddle === null
                    ? null
                    : t(i === 0 ? 'bid.rowLeading' : 'bid.row', { n: b.paddle })}
                </span>
                <span className="bid__amt">{formatUsd(b.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {showEnd && outcome !== null && (
        <Suspense fallback={null}>
          <EndDialog
            outcome={outcome}
            lotTitle={lotTitle ?? lotTitleFallback}
            amountCents={wonCents}
            winnerPaddle={
              outcome === 'lost' || outcome === 'sold' ? (price?.leaderPaddle ?? null) : null
            }
            onHome={() => closeEnd(onHome)}
            onJoinCode={() => closeEnd(onJoinCode)}
            onReceipt={onReceipt === undefined ? undefined : () => closeEnd(onReceipt)}
            onClose={() => closeEnd()}
          />
        </Suspense>
      )}

      {onConfirm !== undefined && myPaddle !== undefined && request !== null && (
        <Suspense fallback={null}>
          <ConfirmSheet
            request={request}
            paddle={myPaddle}
            currentCents={price?.currentCents ?? null}
            onRespond={onConfirm}
            onDismiss={(confirmId) => store.dispatch({ kind: 'confirm_resolved', confirmId })}
            now={serverNow}
          />
        </Suspense>
      )}
    </main>
  );
}
