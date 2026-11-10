import { useEffect, useState, type ReactNode } from 'react';

import { t } from '../../copy/t';
import { FakePaymentsLabel } from '../../design/FakePaymentsLabel';
import { LadderCompact } from '../../ladder/LadderCompact';
import type { SettlementView } from '../../ladder/ladderModel';
import { useServerNow, useSkew } from '../../net/clock';
import { Icon } from '../../design/icons';
import { Banner } from '../../design/primitives/Banner';
import { selectConfirmQueue, selectPrice, selectStream, selectors } from '../../store/selectors';
import { roomStore, useRoom, type RoomStore } from '../../store/roomStore';
import type { AuctionStatus } from '../../wire';
import { formatUsd } from '../../util/money';
import { rowsFromAudit } from './BidStream';
import { BidHistory } from './BidHistory';
import { ConfirmQueue } from './ConfirmQueue';
import { Instructor, consoleStep } from '../../help';
import { ConsoleGuide } from './ConsoleGuide';
import { PriceHeader } from './PriceHeader';
import '../../a11y/a11y.css';
import './console.css';

/** Desktop layout from this width up (R-WEB-063). */
export const WIDE_MIN_PX = 1000;

function noAnswer(): void {
  // No sender is wired: the queue lists requests and cannot answer them.
}

export interface ConsoleScreenProps {
  store?: RoomStore;
  /** Latest settlement detail, for the bottom strip. */
  settlementView: SettlementView | null;
  /** The fixed-slot control bar under the price header. */
  controls?: ReactNode;
  /** Manual floor bid form. */
  floor?: ReactNode;
  /** The bidders list. */
  bidders?: ReactNode;
  /** The stop-auction danger zone, last in the lot column. */
  danger?: ReactNode;
  /** Voice feed content for the right column. */
  voiceFeed?: ReactNode;
  /** Sends the auctioneer's answer to one confirmation. Without it the queue only lists. */
  onConfirmAnswer?: (confirmId: string, accept: boolean) => void;
  /** The stop was accepted here before the room frame arrived. */
  stoppedHere?: boolean;
  /** Forces the layout; defaults to a media query on the viewport width. */
  wide?: boolean;
}

function useWide(forced: boolean | undefined): boolean {
  const query = `(min-width: ${WIDE_MIN_PX}px)`;
  const read = (): boolean =>
    typeof window === 'undefined' || typeof window.matchMedia !== 'function'
      ? true
      : window.matchMedia(query).matches;
  const [wide, setWide] = useState(read);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia(query);
    const on = (): void => setWide(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return forced ?? wide;
}

/** Auctioneer console layout: one balanced grid from 1000 px, one column below. */
export function ConsoleScreen({
  store = roomStore,
  settlementView,
  controls,
  floor,
  bidders,
  danger,
  voiceFeed,
  onConfirmAnswer,
  stoppedHere = false,
  wide: forcedWide,
}: ConsoleScreenProps) {
  const wide = useWide(forcedWide);
  const price = useRoom(selectPrice, store);
  const stream = useRoom(selectStream, store);
  const confirms = useRoom(selectConfirmQueue, store);
  const reserve = useRoom((s) => s.snapshot?.config.reserve ?? 0, store);
  const leaderName = useRoom(
    (s) => s.snapshot?.roster.find((r) => r.bidderId === s.snapshot?.leaderId)?.name ?? null,
    store,
  );
  const audit = useRoom((s) => s.audit, store);
  // The hammer frame closes the lot before any later snapshot says so.
  const status = useRoom((s) => selectors.auctionStatus(s) ?? 'SCHEDULED', store) as AuctionStatus;
  const stopped = useRoom(selectors.stopped, store) || stoppedHere;
  const hammer = useRoom((s) => s.hammer, store);
  const closed = status === 'CLOSING' || status === 'SETTLING' || status === 'DONE';
  const auctionId = useRoom((s) => s.snapshot?.auctionId ?? null, store);
  const roster = useRoom((s) => s.snapshot?.roster, store);
  const winnerPaddle = useRoom(
    (s) => s.snapshot?.roster.find((r) => r.bidderId === s.hammer?.winnerId)?.paddle ?? null,
    store,
  );
  const now = useServerNow(store);
  const skewMs = useSkew(store);
  const skew =
    skewMs > 0 ? (
      <Banner tone="warn" icon={<Icon name="warning" />}>
        {t('console.skew', { s: Math.round(skewMs / 1000) })}
      </Banner>
    ) : null;

  const left = (
    <section className="gv-console-panel gv-console-panel--lot" aria-label={t('bid.price')}>
      {/* Reserved for the voice mic button (voice-web-mic); collapses while empty. */}
      <div className="gv-console-header" data-slot="console-header-mic" />
      <Instructor
        screen="console"
        {...(auctionId === null ? {} : { roomId: auctionId })}
        current={consoleStep({ status, ended: stopped || status === 'DONE' })}
      />
      <ConsoleGuide status={status} stopped={stopped} roomId={auctionId} />
      {closed && hammer !== null && hammer.winnerId !== null && winnerPaddle !== null && (
        <p className="gv-console-result" role="status" data-field="result">
          {t('console.result.sold', { n: winnerPaddle, amount: formatUsd(hammer.price) })}
        </p>
      )}
      <PriceHeader
        stopped={stopped}
        closed={closed}
        priceCents={price?.currentCents ?? null}
        reserveCents={reserve}
        leaderPaddle={price?.leaderPaddle ?? null}
        leaderName={leaderName}
        bidCount={stream.length}
        endTs={price?.endTs ?? 0}
        frozenMs={price?.paused === true ? (price.remainingMs ?? null) : null}
        now={now}
        nextMinCents={price?.nextMinCents ?? reserve}
      />
      {controls}
    </section>
  );

  const floorPanel =
    floor === undefined ? null : (
      <section
        className="gv-console-panel gv-console-panel--floor"
        aria-label={t('console.manual')}
      >
        {floor}
      </section>
    );
  const biddersPanel =
    bidders === undefined ? null : (
      <div className="gv-console-panel gv-console-panel--bidders">{bidders}</div>
    );
  const dangerZone =
    danger === undefined ? null : (
      <div className="gv-console-panel gv-console-panel--danger gv-console-danger">{danger}</div>
    );

  const centre = (
    <section className="gv-console-panel gv-console-panel--stream" aria-label={t('console.stream')}>
      <h2 className="ui-kicker">{t('console.stream')}</h2>
      {audit.length > 0 ? (
        <BidHistory
          roomId={auctionId ?? 'room'}
          rows={rowsFromAudit(
            audit,
            (id) => roster?.find((r) => r.bidderId === id)?.paddle ?? null,
          )}
        />
      ) : stream.length === 0 ? (
        <p>{t('console.noBids')}</p>
      ) : (
        <ol reversed>
          {[...stream].reverse().map((b) => (
            <li key={b.seq} style={{ fontVariantNumeric: 'tabular-nums' }}>
              {b.paddle === null ? null : (
                <span>
                  {t(b.seq === stream[0]?.seq ? 'bid.rowLeading' : 'bid.row', { n: b.paddle })}{' '}
                </span>
              )}
              <span>{formatUsd(b.amount)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );

  const right = (
    <section className="gv-console-panel gv-console-panel--voice" aria-label={t('console.voice')}>
      <h2 className="ui-kicker">{t('console.voice')}</h2>
      {voiceFeed}
      <h2 className="ui-kicker gv-console-panel__sub">{t('console.confirmQueue')}</h2>
      <ConfirmQueue requests={confirms} now={now} onAnswer={onConfirmAnswer ?? noAnswer} />
    </section>
  );

  const strip = (
    <footer className="gv-console-strip" aria-label={t('ladder.title')}>
      <LadderCompact view={settlementView} />
    </footer>
  );

  if (wide) {
    return (
      <main className="gv-console" data-layout="wide">
        <h1 className="gv-sr-only">{t('demo.roleConsole')}</h1>
        <FakePaymentsLabel />
        {skew}
        <div className="gv-console-grid" data-testid="console-columns">
          {left}
          <div className="gv-console-stack" data-area="floor">
            {floorPanel}
            {centre}
          </div>
          {right}
          {biddersPanel}
          {dangerZone}
        </div>
        {strip}
      </main>
    );
  }

  return (
    <main className="gv-console" data-layout="stacked">
      <h1 className="gv-sr-only">{t('demo.roleConsole')}</h1>
      <FakePaymentsLabel />
      {skew}
      <div className="gv-console-col" data-testid="console-columns">
        {left}
        {floorPanel}
        {centre}
        {biddersPanel}
        {right}
        {dangerZone}
      </div>
      {strip}
    </main>
  );
}
