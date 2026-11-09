import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
  type MouseEvent,
} from 'react';
import { t } from '../copy/t';
import { Logo } from '../design/Logo';
import { lookupProblemText } from '../net/apiError';
import { ROOM_MINUTES } from '../screens/hub/hubKeys';
import { JoinCodeInput } from '../ui';
import { countAt, useReducedMotion } from '../ui/fx';
import { formatUsd, formatUsdCompact } from '../util/money';
import { pickGreeting, timeAgo } from './greeting';
import type { HistoryResult, HistoryRoom } from './history';
import './home.css';

/** What a cheap, read-only look at a room found. */
export type RoomCheck = 'live' | 'gone' | 'unknown';

export interface HomeScreenProps {
  /** The remembered rooms, newest first. Never empty: with none the landing page shows instead. */
  rooms: readonly HistoryRoom[];
  /** Fixed clock for tests and screenshots. */
  now?: number;
  /** Asks the host whether a room still exists. Left out when there is no server to ask. */
  checkRoom?: (roomId: string) => Promise<RoomCheck>;
  /** Resolves true when the code names a room (the caller navigates), false when it does not. */
  onJoin: (code: string) => Promise<boolean>;
  /** Starts the sandbox room flow. */
  onCreate: () => void;
  onClear: () => void;
  /** Client-side navigation for in-app links. */
  onNavigate: (to: string) => void;
}

const CODE_LENGTH = 6;
const ROOM_MS = ROOM_MINUTES * 60_000;
const JOIN_PATH = /\/join\/([A-Za-z0-9_-]+)/;

/** A room is certainly gone once its known end time passed; without one, the host is asked. */
export function expiredByTime(room: HistoryRoom, now: number): boolean {
  return (room.expiresAt ?? room.createdAt + ROOM_MS) <= now;
}

/** What the room counts as now: a lot still open in a deleted room is over. */
function effectiveResult(room: HistoryRoom, now: number): HistoryResult {
  return room.result === 'open' && expiredByTime(room, now) ? 'closed' : room.result;
}

function resultLine(room: HistoryRoom, result: HistoryResult): string {
  const price = room.lastPriceCents === null ? null : formatUsdCompact(room.lastPriceCents);
  const hold = room.holdCents === null ? null : formatUsdCompact(room.holdCents);
  if (result === 'won' && price !== null) {
    return hold === null
      ? t('home.result.wonNoHold', { price })
      : t('home.result.won', { hold, price });
  }
  if (result === 'lost' && price !== null) {
    return hold === null
      ? t('home.result.lostNoHold', { price })
      : t('home.result.lost', { hold, price });
  }
  if (result === 'stopped') return t('home.result.stopped');
  if (result === 'open') return t('home.result.open');
  return t('home.result.closed');
}

function shortResult(result: HistoryResult): string {
  const labels: Record<HistoryResult, string> = {
    won: t('home.short.won'),
    lost: t('home.short.lost'),
    stopped: t('home.short.stopped'),
    closed: t('home.short.closed'),
    open: t('home.short.open'),
  };
  return labels[result];
}

function roleLine(room: HistoryRoom): string {
  if (room.roles.includes('bidder')) {
    return room.paddle === null
      ? t('home.role.bidder')
      : t('home.role.bidderPaddle', { paddle: room.paddle });
  }
  return room.roles.includes('auctioneer') ? t('home.role.auctioneer') : t('home.role.watcher');
}

function returnPath(room: HistoryRoom): string {
  const id = encodeURIComponent(room.roomId);
  if (room.roles.includes('bidder')) return `/r/${id}/bid`;
  if (room.roles.includes('auctioneer')) return `/r/${id}/hub`;
  return `/r/${id}/screen`;
}

/** The price in big tabular numerals. It counts up once; the final figure sets the width, so nothing moves. */
function Price({ cents }: { cents: number }) {
  const reduced = useReducedMotion();
  const live = useRef<HTMLSpanElement>(null);
  const final = formatUsd(cents);
  useEffect(() => {
    const el = live.current;
    if (el === null || reduced || typeof requestAnimationFrame !== 'function') return undefined;
    const delay = 260;
    const span = 700;
    const start = performance.now() + delay;
    let frame = 0;
    const step = (now: number): void => {
      const p = (now - start) / span;
      el.textContent = formatUsd(countAt(cents, p));
      if (p < 1) frame = requestAnimationFrame(step);
    };
    el.textContent = formatUsd(0);
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      el.textContent = final;
    };
  }, [cents, reduced, final]);
  return (
    <span className="gv-home__price" data-testid="home-price">
      <span className="gv-home__price-size" aria-hidden="true">
        {final}
      </span>
      <span ref={live} className="gv-home__price-live">
        {final}
      </span>
    </span>
  );
}

/** A link the caller routes in-app; a modified click keeps the browser behaviour. */
function RouteLink({
  to,
  onNavigate,
  children,
}: {
  to: string;
  onNavigate: (to: string) => void;
  children: string;
}) {
  const click = (e: MouseEvent<HTMLAnchorElement>): void => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    onNavigate(to);
  };
  return (
    <a className="gv-home__link" href={to} onClick={click}>
      {children}
    </a>
  );
}

/**
 * The Home screen for a visitor who has been here before: a greeting, the last auction set like a
 * lot record, the earlier rooms as ruled rows, and the two ways in. Light Newsprint only.
 */
export function HomeScreen({
  rooms,
  now: fixedNow,
  checkRoom,
  onJoin,
  onCreate,
  onClear,
  onNavigate,
}: HomeScreenProps) {
  const [now] = useState(() => fixedNow ?? Date.now());
  const last = rooms[0];
  const earlier = rooms.slice(1);
  const lastExpired = last !== undefined && expiredByTime(last, now);
  const [check, setCheck] = useState<RoomCheck | 'checking' | 'none'>(() =>
    lastExpired ? 'gone' : checkRoom === undefined ? 'none' : 'checking',
  );
  const lastId = last?.roomId;
  useEffect(() => {
    if (lastId === undefined || lastExpired || checkRoom === undefined) return undefined;
    let live = true;
    checkRoom(lastId).then(
      (found) => {
        if (live) setCheck(found);
      },
      () => {
        if (live) setCheck('unknown');
      },
    );
    return () => {
      live = false;
    };
  }, [lastId, lastExpired, checkRoom]);

  const [joinOpen, setJoinOpen] = useState(false);
  const [code, setCode] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);
  const joinRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (joinOpen) joinRef.current?.querySelector<HTMLInputElement>('.ui-otp__slot')?.focus();
  }, [joinOpen]);

  const tryJoin = (value: string): void => {
    const trimmed = value.trim();
    if (trimmed === '' || looking) return;
    setLooking(true);
    onJoin(trimmed)
      .then((found) => {
        setProblem(null);
        setInvalid(!found);
      })
      .catch((error: unknown) => {
        setProblem(lookupProblemText(error));
        setInvalid(true);
      })
      .finally(() => setLooking(false));
  };
  const submit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    tryJoin(code);
  };
  // A whole join link pasted into the field opens that room, so a copied link needs no editing.
  const paste = (e: ClipboardEvent<HTMLFormElement>): void => {
    const link = JOIN_PATH.exec(e.clipboardData.getData('text'));
    if (link?.[1] === undefined) return;
    e.preventDefault();
    e.stopPropagation();
    tryJoin(link[1]);
  };

  if (last === undefined) return null;
  const result = effectiveResult(last, now);
  const greeting = pickGreeting(last, result, now);
  const recent = rooms
    .filter((r) => r.code !== null && !expiredByTime(r, now))
    .slice(0, 3)
    .map((r) => r.code)
    .filter((c): c is string => c !== null);
  const reachable = check === 'live';

  return (
    <div className="gv-home">
      <header className="gv-home__bar">
        <a className="gv-home__brand" href="/" aria-label={t('home.logoLabel')} aria-current="page">
          <Logo variant="wordmark" height={22} decorative />
        </a>
        <nav aria-label={t('home.nav')}>
          <a className="gv-home__link" href="/about">
            {t('home.about')}
          </a>
        </nav>
      </header>

      <main className="gv-home__main">
        <section className="gv-home__hero" aria-labelledby="home-hello">
          <div className="gv-home__kickrow">
            <span className="gv-home__mark" aria-hidden="true">
              <Logo variant="mark" height={28} decorative motion="load" />
            </span>
            <p className="ui-kicker gv-home__kicker">{t('home.kicker')}</p>
          </div>
          <h1 id="home-hello" className="gv-home__hello">
            <span className="gv-home__mask">
              <span className="gv-home__strike">{greeting.hello}</span>
            </span>
          </h1>
          <p className="gv-home__sub">{greeting.sub}</p>
          <span className="gv-home__rule" aria-hidden="true" />
        </section>

        <section className="gv-home__last" aria-labelledby="home-last">
          <h2 id="home-last" className="ui-kicker gv-home__label">
            {t('home.last.kicker')}
          </h2>
          <div className="gv-home__record">
            <div className="gv-home__lot">
              <p className="ui-kicker">{t('home.last.lot')}</p>
              <p className="gv-home__lot-title">{last.lotTitle ?? t('home.last.untitled')}</p>
              <p className="gv-home__meta">
                {roleLine(last)}
                <span aria-hidden="true">{' / '}</span>
                <span>{timeAgo(last.lastSeenAt, now)}</span>
              </p>
            </div>
            <div className="gv-home__fig">
              <p className="ui-kicker">
                {result === 'open' ? t('home.last.priceOpen') : t('home.last.priceFinal')}
              </p>
              {last.lastPriceCents === null ? (
                <p className="gv-home__nobids">{t('home.last.noBids')}</p>
              ) : (
                <Price cents={last.lastPriceCents} />
              )}
            </div>
            <p className="gv-home__result" data-result={result}>
              {resultLine(last, result)}
            </p>
          </div>
          <div className="gv-home__room" aria-label={t('home.links.label')} role="group">
            {check === 'checking' && <p className="gv-home__note">{t('home.room.checking')}</p>}
            {check === 'gone' && (
              <p className="gv-home__note">{t('home.room.gone', { minutes: ROOM_MINUTES })}</p>
            )}
            {check === 'unknown' && <p className="gv-home__note">{t('home.room.unknown')}</p>}
            {reachable && (
              <ul className="gv-home__links">
                {result === 'open' && (
                  <li>
                    <RouteLink to={returnPath(last)} onNavigate={onNavigate}>
                      {t('home.link.return')}
                    </RouteLink>
                  </li>
                )}
                {last.receipt && (
                  <li>
                    <RouteLink
                      to={`/r/${encodeURIComponent(last.roomId)}/receipt`}
                      onNavigate={onNavigate}
                    >
                      {t('home.link.receipt')}
                    </RouteLink>
                  </li>
                )}
                <li>
                  <RouteLink
                    to={`/r/${encodeURIComponent(last.roomId)}/audit`}
                    onNavigate={onNavigate}
                  >
                    {t('home.link.ledger')}
                  </RouteLink>
                </li>
                <li>
                  <RouteLink to="/verify" onNavigate={onNavigate}>
                    {t('home.link.verify')}
                  </RouteLink>
                </li>
              </ul>
            )}
          </div>
        </section>

        <section className="gv-home__actions" aria-labelledby="home-next">
          <h2 id="home-next" className="gv-home__sr">
            {t('home.actions.title')}
          </h2>
          <div className="gv-home__pair">
            <button
              type="button"
              className="gv-home__act"
              aria-expanded={joinOpen}
              aria-controls="home-join"
              onClick={() => setJoinOpen((open) => !open)}
            >
              <span className="gv-home__act-title">{t('home.join.title')}</span>
              <span className="gv-home__act-hint">{t('home.join.hint')}</span>
            </button>
            <button type="button" className="gv-home__act gv-home__act--primary" onClick={onCreate}>
              <span className="gv-home__act-title">{t('home.create.title')}</span>
              <span className="gv-home__act-hint">{t('home.create.hint')}</span>
            </button>
          </div>
          <div id="home-join" className="gv-home__join" ref={joinRef} hidden={!joinOpen}>
            <form onSubmit={submit} onPasteCapture={paste} aria-label={t('home.join.codeLabel')}>
              <p className="ui-kicker">{t('home.join.codeLabel')}</p>
              <div className="gv-home__code">
                <JoinCodeInput
                  value={code}
                  length={CODE_LENGTH}
                  prefix=""
                  disabled={looking}
                  invalid={invalid}
                  {...(invalid ? { message: problem ?? t('landing.codeInvalid') } : {})}
                  onChange={(next) => {
                    setCode(next);
                    setInvalid(false);
                    setProblem(null);
                  }}
                />
                <button type="submit" className="gv-home__go" aria-disabled={looking || undefined}>
                  {looking ? t('home.join.looking') : t('home.join.go')}
                </button>
              </div>
              <p className="gv-home__note">{t('home.join.paste')}</p>
              {recent.length > 0 && (
                <div className="gv-home__recent">
                  <p className="ui-kicker">{t('home.join.recent')}</p>
                  <ul>
                    {recent.map((c) => (
                      <li key={c}>
                        <button
                          type="button"
                          className="gv-home__recent-code"
                          aria-label={t('home.join.recentUse', { code: c })}
                          onClick={() => tryJoin(c)}
                        >
                          {c}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </form>
          </div>
        </section>

        {earlier.length > 0 && (
          <section className="gv-home__earlier" aria-labelledby="home-earlier">
            <h2 id="home-earlier" className="ui-kicker gv-home__label">
              {t('home.earlier.kicker')}
            </h2>
            <ol className="gv-home__rows">
              {earlier.map((room) => {
                const r = effectiveResult(room, now);
                return (
                  <li key={room.roomId} className="gv-home__row">
                    <span className="gv-home__row-title">
                      {room.lotTitle ?? t('home.last.untitled')}
                    </span>
                    <span className="gv-home__row-result">
                      {shortResult(r)}
                      {expiredByTime(room, now) && (
                        <span className="gv-home__row-gone">
                          {' / '}
                          {t('home.earlier.deleted')}
                        </span>
                      )}
                    </span>
                    <span className="gv-home__row-price">
                      {room.lastPriceCents === null ? '' : formatUsd(room.lastPriceCents)}
                    </span>
                    <span className="gv-home__row-ago">{timeAgo(room.lastSeenAt, now)}</span>
                  </li>
                );
              })}
            </ol>
          </section>
        )}
      </main>

      <footer className="gv-home__foot">
        <p>{t('home.footer.sandbox')}</p>
        <p>{t('home.footer.local')}</p>
        <button type="button" className="gv-home__clear" onClick={onClear}>
          {t('home.footer.clear')}
        </button>
      </footer>
    </div>
  );
}

export default HomeScreen;
