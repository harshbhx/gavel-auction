import { useEffect, useState } from 'react';
import { t } from '../../copy/t';
import { useServerNow } from '../../net/clock';
import { roomStore, useRoom, type RoomStore } from '../../store/roomStore';
import { selectors } from '../../store/selectors';
import { formatUsd } from '../../util/money';
import { formatCountdown } from '../../util/time';
import { QrCode } from '../join/QrCode';
import './screen.css';

/** The ticker shows the last five accepted bids (R-WEB-075). */
export const TICKER_SIZE = 5;

export interface ScreenViewProps {
  lotTitle: string;
  /** Short join code shown beside the QR code. */
  code: string;
  /** Address encoded in the QR code. */
  joinUrl: string;
  store?: RoomStore;
}

/** Projector view: no controls, no personal data beyond the paddle number. */
export function ScreenView({ lotTitle, code, joinUrl, store = roomStore }: ScreenViewProps) {
  const price = useRoom(selectors.price, store);
  const stream = useRoom(selectors.stream, store);
  const hammer = useRoom((s) => s.hammer, store);
  const leaderPaddle = useRoom((s) => s.leaderPaddle, store);
  const roster = useRoom((s) => s.snapshot?.roster ?? null, store);
  const now = useServerNow(store);
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

  const closed = hammer !== null;
  const winnerPaddle =
    hammer !== null && hammer.winnerId !== null
      ? (roster?.find((r) => r.bidderId === hammer.winnerId)?.paddle ?? null)
      : null;
  const ticker = stream.slice(0, TICKER_SIZE);

  return (
    <main className="gv-screen" aria-label={lotTitle}>
      <h1 className="gv-screen__lot">{lotTitle}</h1>
      <div className="gv-screen__stage">
        {hammer !== null ? (
          <p className="gv-screen__price tabular" data-closed="true">
            {winnerPaddle !== null
              ? t('screen.sold', { n: winnerPaddle, amount: formatUsd(hammer.price) })
              : t('screen.passed')}
          </p>
        ) : price === null || price.currentCents === null ? (
          <p className="gv-screen__price tabular">
            {t('screen.opening', { amount: formatUsd(price?.nextMinCents ?? 0) })}
          </p>
        ) : (
          <>
            <p className="gv-screen__price tabular" data-testid="screen-price">
              {formatUsd(price.currentCents)}
            </p>
            <p className="gv-screen__leader tabular">
              {leaderPaddle !== null ? `${t('reg.paddle')} ${leaderPaddle}` : ''}
            </p>
          </>
        )}
        {!closed && price !== null && (
          <p className="gv-screen__clock tabular">
            {formatCountdown(
              price.paused && price.remainingMs !== null ? price.remainingMs : price.endTs - now(),
            )}
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
      {!closed && (
        <aside className="gv-screen__join">
          <QrCode url={joinUrl} size={200} />
          <p className="tabular">{t('screen.join', { code })}</p>
        </aside>
      )}
    </main>
  );
}

export default ScreenView;
