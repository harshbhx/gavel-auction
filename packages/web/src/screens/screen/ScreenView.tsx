import { useEffect, useRef, useState } from 'react';
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
import { QrCode } from '../join/QrCode';
import { FrozenChip, PriceFlash, Sold, type SettleCounts, type SoldOutcome } from './Sold';
import type { SettlementDetail } from '../../store/roomReducer';

type SettlementHold = SettlementDetail['holds'][number];
import './screen.css';

/** The ticker shows the last five accepted bids (R-WEB-075). */
export const TICKER_SIZE = 5;

export interface ScreenViewProps {
  lotTitle: string;
  /** Short join code shown beside the QR code; null when the server has none to show. */
  code: string | null;
  /** Address encoded in the QR code. */
  joinUrl: string;
  store?: RoomStore;
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

/** Projector view: no controls, no personal data beyond the paddle number. */
export function ScreenView({ lotTitle, code, joinUrl, store = roomStore }: ScreenViewProps) {
  const price = useRoom(selectors.price, store);
  const stream = useRoom(selectors.stream, store);
  const hammer = useRoom((s) => s.hammer, store);
  useHammerAlert(store);
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
  const connection = useConnection();
  const [, setTick] = useState(0);

  useEffect(() => {
    const root = document.documentElement;
    const previous = root.getAttribute('data-theme');
    root.setAttribute('data-theme', 'projector');
    return () => {
      if (previous === null) root.removeAttribute('data-theme');
      else root.setAttribute('data-theme', previous);
    };
  }, []);

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
  if (!connection.offline) frozenRemaining.current = null;
  else if (frozenRemaining.current === null) frozenRemaining.current = liveRemaining;
  const remaining = frozenRemaining.current ?? liveRemaining;
  const ticker = stream.slice(0, TICKER_SIZE);
  const outcome: SoldOutcome =
    winnerId === null || finalPrice === null
      ? { kind: 'passed' }
      : { kind: 'sold', paddle: winnerPaddle, amountCents: finalPrice };

  return (
    <main className="gv-screen" aria-label={lotTitle}>
      <h1 className="gv-screen__lot">{lotTitle}</h1>
      <FrozenChip disconnected={connection.offline} />
      {stopped && <p role="status">{t('screen.stopped')}</p>}
      <div className="gv-screen__stage">
        {closed ? (
          <Sold outcome={outcome} settlement={settlement} />
        ) : price === null || price.currentCents === null ? (
          <p className="gv-screen__price tabular">
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
            data-frozen={connection.offline ? 'true' : 'false'}
          >
            {formatCountdown(remaining)}
            {connection.offline && <span> {t('screen.clockFrozen')}</span>}
          </p>
        )}
      </div>
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
        <aside className="gv-screen__join">
          <QrCode url={joinUrl} size={200} />
          {code !== null && <p className="tabular">{t('screen.join', { code })}</p>}
        </aside>
      )}
    </main>
  );
}

export default ScreenView;
