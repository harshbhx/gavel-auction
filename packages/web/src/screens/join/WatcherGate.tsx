import { useEffect, useState } from 'react';

import { t } from '../../copy/t';
import { Button } from '../../design/primitives/Button';
import { formatUsd } from '../../util/money';
import '../flows.css';

export interface WatcherGateProps {
  readonly roomId: string;
  /** Moves the app to another path. */
  readonly onNavigate: (path: string) => void;
  /** The API origin; with it the page shows the room's public price and status. */
  readonly apiBase?: string | undefined;
}

interface Live {
  readonly title: string | null;
  readonly status: string | null;
  readonly currentCents: number | null;
  readonly leaderPaddle: number | null;
  readonly bidders: number | null;
  /** The room no longer takes new bidders (hammer fallen or registration closed). */
  readonly closed: boolean;
}

const POLL_MS = 4000;

function liveOf(body: unknown): Live {
  const v = (body ?? {}) as Record<string, unknown>;
  const num = (x: unknown): number | null =>
    typeof x === 'number' && Number.isFinite(x) ? x : null;
  return {
    title: typeof v['title'] === 'string' ? v['title'] : null,
    status: typeof v['status'] === 'string' ? v['status'] : null,
    currentCents: num(v['currentCents']),
    leaderPaddle: num(v['leaderPaddle']),
    bidders: num(v['bidderCount']),
    closed: v['registrationClosed'] === true || v['status'] === 'DONE',
  };
}

/** Polls the room's public summary: no token needed, and nothing in it is private. */
function useLive(roomId: string, apiBase: string | undefined): Live | null | 'down' {
  const [live, setLive] = useState<Live | null | 'down'>(null);
  useEffect(() => {
    if (apiBase === undefined) return undefined;
    let alive = true;
    const pull = (): void => {
      fetch(`${apiBase}/api/auctions/${encodeURIComponent(roomId)}`)
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error('summary'))))
        .then((body: unknown) => {
          if (alive) setLive(liveOf(body));
        })
        .catch(() => {
          if (alive) setLive('down');
        });
    };
    pull();
    const timer = window.setInterval(pull, POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [roomId, apiBase]);
  return live;
}

/**
 * What a person sees on the bid or receipt page of a room they have not joined: the lot, the
 * price, who leads and whether bidding is open, with one clear way to join as a bidder.
 */
export function WatcherGate({ roomId, onNavigate, apiBase }: WatcherGateProps) {
  const id = encodeURIComponent(roomId);
  const live = useLive(roomId, apiBase);
  const summary = live !== null && live !== 'down' ? live : null;
  const statusKey =
    summary?.status === 'OPEN' || summary?.status === 'DONE'
      ? (`watch.status.${summary.status}` as const)
      : 'watch.status.other';
  return (
    <main className="gv-flow" data-route="watcher" data-state="not-joined">
      <p className="ui-kicker">{t('app.name')}</p>
      <h1 tabIndex={-1}>{t('watch.title')}</h1>
      {summary !== null && (
        <section className="gv-watch" aria-label={t('watch.price')} aria-live="polite">
          {summary.title !== null && (
            <p className="gv-watch__lot">{t('watch.lot', { title: summary.title })}</p>
          )}
          <p className="ui-kicker">{t('watch.price')}</p>
          <p className="gv-watch__price" data-testid="watch-price">
            {summary.currentCents === null ? t('watch.noBids') : formatUsd(summary.currentCents)}
          </p>
          {summary.leaderPaddle !== null && (
            <p className="gv-watch__leader">{t('watch.leader', { n: summary.leaderPaddle })}</p>
          )}
          <p role="status" className="gv-watch__status">
            {t(statusKey)}
            {summary.bidders !== null ? `. ${t('watch.bidders', { n: summary.bidders })}` : ''}
          </p>
        </section>
      )}
      {live === 'down' && (
        <p role="status" className="gv-join__note">
          {t('watch.unavailable')}
        </p>
      )}
      {summary?.closed !== true && <p className="gv-join__help">{t('watch.lead')}</p>}
      <p className="gv-join__note">{t('join.sandboxNote')}</p>
      <div className="gv-join__actions">
        {summary?.closed === true ? (
          <p role="status" className="gv-join__note" data-testid="watch-closed">
            {t('watch.closed')}
          </p>
        ) : (
          <Button size="bid" onClick={() => onNavigate(`/r/${id}/register`)}>
            {t('join.asBidder')}
          </Button>
        )}
        <Button variant="outline" onClick={() => onNavigate(`/join/${id}`)}>
          {t('watch.openJoin')}
        </Button>
      </div>
    </main>
  );
}

export default WatcherGate;
