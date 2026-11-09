import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useHammerAlert } from '../../alerts/useAlerts';
import { t } from '../../copy/t';
import { useConnection } from '../../net/connection';
import { useServerNow } from '../../net/clock';
import { roomStore, useRoom, type RoomStore } from '../../store/roomStore';
import { selectors } from '../../store/selectors';
import { formatUsd } from '../../util/money';
import { formatCountdown } from '../../util/time';
import { publicSource } from '../../ladder/fromWire';
import { SettlementPanel } from '../../ladder/SettlementPanel';
import { capturedTotal, lotRaise, thermometer } from './fundraiser';
import { FundraiserThermometer } from './Thermometer';

// The QR encoder is a lazy chunk (R-WEB-009), like on the join page and the hub.
const QrCode = lazy(() => import('../join/QrCode'));
import { StoryRail } from './StoryRail';
import { FrozenChip, PriceFlash, Sold, type SettleCounts, type SoldOutcome } from './Sold';
import type { SettlementDetail } from '../../store/roomReducer';

type SettlementHold = SettlementDetail['holds'][number];
import { Logo } from '../../design/Logo';
import './screen.css';

/** The ticker shows the last five accepted bids (R-WEB-075). */
export const TICKER_SIZE = 5;

/** The clock turns to the soft close colour in the last ten seconds. */
const SOFT_CLOSE_MS = 10_000;

export interface ScreenViewProps {
  lotTitle: string;
  /** Short join code shown beside the QR code; null when the server has none to show. */
  code: string | null;
  /** Address encoded in the QR code. */
  joinUrl: string;
  store?: RoomStore;
  /** `projector` is the dark big screen theme; `newsprint` keeps the page theme (scripted demo). */
  theme?: 'projector' | 'newsprint';
  /** A small, silent copy inside another page (the room hub): no sound, no theme change, no offline chip. */
  preview?: boolean;
}

/** Ladder summary counts from the latest per-hold settlement data. */
export function settleCounts(holds: readonly SettlementHold[]): SettleCounts {
  const captured = holds.filter((h) => h.capturedCents > 0).length;
  const released = holds.filter(
    (h) => h.capturedCents === 0 && (h.releasedCents > 0 || h.state === 'SETTLED'),
  ).length;
  return { captured, released };
}

/** Ladder summary from the server's public per-state counts (ladder.counts). */
export function countsToSettle(counts: Readonly<Record<string, number>>): SettleCounts {
  return { captured: counts['CAPTURED'] ?? 0, released: counts['SETTLED'] ?? 0 };
}

/** Plays the hammer sound for the real projector; the hub preview never renders it. */
function HammerSound({ store }: { store: RoomStore }) {
  useHammerAlert(store);
  return null;
}

/** Projector view: no controls, no personal data beyond the paddle number. */
export function ScreenView({
  lotTitle,
  code,
  joinUrl,
  store = roomStore,
  theme = 'projector',
  preview = false,
}: ScreenViewProps) {
  const price = useRoom(selectors.price, store);
  const stream = useRoom(selectors.stream, store);
  const hammer = useRoom((s) => s.hammer, store);
  const connection = useConnection();
  const offline = connection.offline && !preview;
  const stopped = useRoom(selectors.stopped, store);
  const leaderPaddle = useRoom((s) => s.leaderPaddle, store);
  const roster = useRoom((s) => s.snapshot?.roster ?? null, store);
  const status = useRoom((s) => s.snapshot?.status ?? null, store);
  const snapPrice = useRoom((s) => s.snapshot?.price ?? null, store);
  const snapLeader = useRoom((s) => s.snapshot?.leaderId ?? null, store);
  const settlementState = useRoom((s) => s, store);
  const detail = useRoom((s) => s.settlementDetail ?? null, store);
  const roomId = useRoom((s) => s.auctionId, store);
  const now = useServerNow(store);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (theme !== 'projector' || preview) return undefined;
    const root = document.documentElement;
    const previous = root.getAttribute('data-theme');
    root.setAttribute('data-theme', 'projector');
    return () => {
      if (previous === null) root.removeAttribute('data-theme');
      else root.setAttribute('data-theme', previous);
    };
  }, [theme, preview]);

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, []);

  // A reload or a late join gets a snapshot but not the hammer message: the snapshot status and
  // its final price and leader carry the result.
  const snapClosed = status === 'CLOSING' || status === 'SETTLING' || status === 'DONE';
  const closed = hammer !== null || snapClosed;
  const finalPrice = hammer !== null ? hammer.price : snapPrice;
  const winnerId = hammer !== null ? hammer.winnerId : snapLeader;
  const winnerPaddle =
    winnerId !== null ? (roster?.find((r) => r.bidderId === winnerId)?.paddle ?? null) : null;
  // The server's own counts win; the per-hold derivation is only for frames without them.
  const serverCounts = useRoom((s) => s.settlementLadderCounts ?? null, store);
  const settlement =
    serverCounts !== null
      ? countsToSettle(serverCounts)
      : detail === null
        ? null
        : settleCounts(detail.holds);
  const liveRemaining =
    price === null
      ? null
      : price.paused && price.remainingMs !== null
        ? price.remainingMs
        : price.endTs - now();
  // While the connection is down the clock keeps the last value it showed: a local count down
  // could read 0:00 for a lot the server has already extended.
  const frozenRemaining = useRef<number | null>(null);
  if (!offline) frozenRemaining.current = null;
  else if (frozenRemaining.current === null) frozenRemaining.current = liveRemaining;
  const remaining = frozenRemaining.current ?? liveRemaining;
  // Hidden unless the auctioneer set a goal. Only captured holds count as raised.
  const goalCents = useRoom((s) => s.snapshot?.fundraiser?.goalCents ?? null, store);
  const auctionState = useRoom(
    (s) => s.settlementMeta?.auctionState ?? s.snapshot?.settlement?.auctionState ?? null,
    store,
  );
  const reportedCaptured = useRoom((s) => s.settlementMeta?.capturedCents, store);
  const thermo = thermometer(
    goalCents,
    lotRaise(
      capturedTotal(reportedCaptured, detail?.holds),
      closed && winnerId !== null ? finalPrice : null,
      auctionState,
    ),
  );
  const ticker = stream.slice(0, TICKER_SIZE);
  const outcome: SoldOutcome =
    winnerId === null || finalPrice === null
      ? { kind: 'passed' }
      : { kind: 'sold', paddle: winnerPaddle, amountCents: finalPrice };

  const soft = !closed && remaining !== null && remaining <= SOFT_CLOSE_MS;
  const screenState = closed
    ? outcome.kind === 'sold'
      ? 'sold'
      : 'unsold'
    : stopped || price?.paused === true
      ? 'paused'
      : price === null || price.currentCents === null
        ? 'lobby'
        : soft
          ? 'soft'
          : 'leading';

  // The hub's small copy is decoration: no second main landmark and no second page heading.
  const Root = preview ? 'div' : 'main';
  const Title = preview ? 'p' : 'h1';
  return (
    <Root
      className={preview ? 'gv-screen gv-screen--preview' : 'gv-screen'}
      {...(preview ? {} : { 'aria-label': lotTitle })}
      data-state={screenState}
    >
      {!preview && <HammerSound store={store} />}
      <header className="gv-screen__head">
        <Title className="gv-screen__lot">{lotTitle}</Title>
        <FrozenChip disconnected={offline} />
        <StoryRail phase={closed ? (settlement !== null ? 2 : 1) : 0} />
        {stopped && (
          <p role="status" className="gv-screen__notice">
            {t('screen.stopped')}
          </p>
        )}
        {!preview && <Logo variant="mark" height={56} className="gv-logo--end" />}
      </header>
      <div className="gv-screen__stage">
        <div className="gv-screen__board">
          {closed ? (
            <Sold
              outcome={outcome}
              settlement={settlement}
              review={auctionState === 'FAILED_NEEDS_REVIEW'}
            />
          ) : price === null ? (
            <p className="gv-screen__opening">{t('screen.lobby')}</p>
          ) : price.currentCents === null ? (
            <p className="gv-screen__opening tabular">
              {t('screen.opening', { amount: formatUsd(price?.nextMinCents ?? 0) })}
            </p>
          ) : (
            <>
              <PriceFlash cents={price.currentCents} />
              <p className="gv-screen__leader tabular">
                {leaderPaddle !== null ? `${t('reg.paddle')} ${leaderPaddle}` : ''}
              </p>
            </>
          )}
          {!closed && remaining !== null && (
            <p
              className="gv-screen__clock tabular"
              data-frozen={offline ? 'true' : 'false'}
              data-soft={soft ? 'true' : 'false'}
            >
              {stopped ? t('screen.clockStopped') : formatCountdown(remaining)}
              {offline && <span> {t('screen.clockFrozen')}</span>}
            </p>
          )}
        </div>
      </div>
      <div className="gv-screen__side">
        {thermo !== null && <FundraiserThermometer data={thermo} />}
        <section className="gv-screen__ticker" aria-label={t('screen.latest')}>
          <h2 className="gv-screen__ticker-title">{t('screen.latest')}</h2>
          <ol>
            {ticker.map((bid) => (
              <li key={bid.seq} className="tabular">
                {bid.paddle !== null ? `${bid.paddle}  ` : ''}
                {formatUsd(bid.amount)}
              </li>
            ))}
          </ol>
        </section>
        {closed && (
          <SettlementPanel
            view={publicSource(settlementState)}
            auditHref={`/r/${encodeURIComponent(roomId)}/audit`}
          />
        )}
        {!closed && (
          <div className="gv-screen__join">
            <Suspense fallback={null}>
              <QrCode url={joinUrl} size={260} />
            </Suspense>
            {code !== null && <p className="tabular">{t('screen.join', { code })}</p>}
          </div>
        )}
      </div>
    </Root>
  );
}

export default ScreenView;
