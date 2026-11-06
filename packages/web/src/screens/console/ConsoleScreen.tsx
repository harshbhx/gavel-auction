import { useEffect, useState, type ReactNode } from 'react';

import { t } from '../../copy/t';
import { FakePaymentsLabel } from '../../design/FakePaymentsLabel';
import { LadderCompact } from '../../ladder/LadderCompact';
import type { SettlementView } from '../../ladder/ladderModel';
import { useServerNow } from '../../net/clock';
import { selectConfirmQueue, selectPrice, selectStream } from '../../store/selectors';
import { roomStore, useRoom, type RoomStore } from '../../store/roomStore';
import { formatUsd } from '../../util/money';
import { BidStream, rowsFromAudit } from './BidStream';
import { ConfirmQueue } from './ConfirmQueue';
import { PriceHeader } from './PriceHeader';

/** Desktop layout from this width up (R-WEB-063). */
export const WIDE_MIN_PX = 1024;

function noAnswer(): void {
  // No sender is wired: the queue lists requests and cannot answer them.
}

type TabId = 'lot' | 'stream' | 'side';

export interface ConsoleScreenProps {
  store?: RoomStore;
  /** Latest settlement detail, for the bottom strip. */
  settlementView: SettlementView | null;
  /** Lot controls under the price header. */
  controls?: ReactNode;
  /** Voice feed content for the right column. */
  voiceFeed?: ReactNode;
  /** Sends the auctioneer's answer to one confirmation. Without it the queue only lists. */
  onConfirmAnswer?: (confirmId: string, accept: boolean) => void;
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

/** Auctioneer console layout: three columns on desktop, tabs below 1024 px. */
export function ConsoleScreen({
  store = roomStore,
  settlementView,
  controls,
  voiceFeed,
  onConfirmAnswer,
  wide: forcedWide,
}: ConsoleScreenProps) {
  const wide = useWide(forcedWide);
  const [tab, setTab] = useState<TabId>('lot');
  const price = useRoom(selectPrice, store);
  const stream = useRoom(selectStream, store);
  const confirms = useRoom(selectConfirmQueue, store);
  const reserve = useRoom((s) => s.snapshot?.config.reserve ?? 0, store);
  const leaderName = useRoom(
    (s) => s.snapshot?.roster.find((r) => r.bidderId === s.snapshot?.leaderId)?.name ?? null,
    store,
  );
  const audit = useRoom((s) => s.audit, store);
  const roster = useRoom((s) => s.snapshot?.roster, store);
  const now = useServerNow(store);

  const left = (
    <section aria-label={t('bid.price')}>
      <PriceHeader
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

  const centre = (
    <section aria-label={t('console.stream')}>
      <h2>{t('console.stream')}</h2>
      {audit.length > 0 ? (
        <BidStream
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
              {b.paddle === null ? null : <span>{t('bid.leader', { n: b.paddle })} </span>}
              <span>{formatUsd(b.amount)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );

  const right = (
    <section aria-label={t('console.voice')}>
      <h2>{t('console.voice')}</h2>
      {voiceFeed}
      <h2>{t('console.confirmQueue')}</h2>
      <ConfirmQueue requests={confirms} now={now} onAnswer={onConfirmAnswer ?? noAnswer} />
    </section>
  );

  const strip = (
    <footer aria-label={t('ladder.title')}>
      <LadderCompact view={settlementView} />
    </footer>
  );

  if (wide) {
    return (
      <main data-layout="wide">
        <FakePaymentsLabel />
        <div
          style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}
          data-testid="console-columns"
        >
          {left}
          {centre}
          {right}
        </div>
        {strip}
      </main>
    );
  }

  const tabs: readonly { id: TabId; label: string }[] = [
    { id: 'lot', label: t('bid.price') },
    { id: 'stream', label: t('console.stream') },
    { id: 'side', label: t('console.voice') },
  ];
  return (
    <main data-layout="stacked">
      <FakePaymentsLabel />
      <div role="tablist">
        {tabs.map((x) => (
          <button
            key={x.id}
            type="button"
            role="tab"
            id={`console-tab-${x.id}`}
            aria-selected={tab === x.id}
            aria-controls={`console-panel-${x.id}`}
            onClick={() => setTab(x.id)}
          >
            {x.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`console-panel-${tab}`} aria-labelledby={`console-tab-${tab}`}>
        {tab === 'lot' && left}
        {tab === 'stream' && centre}
        {tab === 'side' && right}
      </div>
      {strip}
    </main>
  );
}
