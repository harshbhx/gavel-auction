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
const EARLIER_SHOWN = 4;
const DOCS_URL = 'https://docs.gavel.dualmindlab.tech';
/** The four ways on, under the two main actions. Internal ones route in-app; Docs leaves for the docs site. */
const TILES = [
  { id: 'demo', href: '/demo/scripted', internal: true },
  { id: 'judge', href: '/try', internal: true },
  { id: 'ledger', href: '/ledger', internal: true },
  { id: 'docs', href: DOCS_URL, internal: false },
] as const;
const JOIN_PATH = /\/join\/([A-Za-z0-9_-]+)/;

function wantsJoin(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('join') === '1';
  } catch {
    return false;
  }
}

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
    <span className="gv-homepage__price" data-testid="home-price">
      <span className="gv-homepage__price-size" aria-hidden="true">
        {final}
      </span>
      <span ref={live} className="gv-homepage__price-live">
        {final}
      </span>
    </span>
  );
}

/** A link the caller routes in-app; a modified click keeps the browser behaviour. */
function RouteLink({
  to,
  onNavigate,
  className = 'gv-homepage__link',
  children,
}: {
  to: string;
  onNavigate: (to: string) => void;
  className?: string;
  children: string;
}) {
  const click = (e: MouseEvent<HTMLAnchorElement>): void => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    onNavigate(to);
  };
  return (
    <a className={className} href={to} onClick={click}>
      {children}
    </a>
  );
}

/**
 * The Home screen for a visitor who has been here before: one hero row (the greeting and the two
 * ways in), the last auction as a lot record beside the earlier rooms from this browser's history,
 * and four tiles. Light Newsprint only.
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

  // "/?join=1" (the winner pop-up's "Enter a join code") opens the code field with focus.
  const [joinOpen, setJoinOpen] = useState(() => wantsJoin());
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
  const greeting = pickGreeting(last);
  const recent = rooms
    .filter((r) => r.code !== null && !expiredByTime(r, now))
    .slice(0, 3)
    .map((r) => r.code)
    .filter((c): c is string => c !== null);
  const reachable = check === 'live';

  const badge = shortResult(result);
  const shown = earlier.slice(0, EARLIER_SHOWN);

  return (
    <div className="gv-homepage">
      <header className="gv-homepage__bar">
        <a
          className="gv-homepage__brand"
          href="/"
          aria-label={t('home.logoLabel')}
          aria-current="page"
        >
          <Logo variant="wordmark" height={28} decorative />
        </a>
        <nav aria-label={t('home.nav')} className="gv-homepage__nav">
          <RouteLink
            to="/try"
            onNavigate={onNavigate}
            className="gv-homepage__link gv-homepage__link--judge"
          >
            {t('home.judge')}
          </RouteLink>
          <a className="gv-homepage__link" href="/about">
            {t('home.about')}
          </a>
        </nav>
      </header>

      <main className="gv-homepage__main">
        <section className="gv-homepage__hero" aria-labelledby="home-hello">
          <h1 id="home-hello" className="gv-homepage__hello">
            <span className="gv-homepage__mask">
              <span className="gv-homepage__strike">{greeting.hello}</span>
            </span>
          </h1>
          <div className="gv-homepage__pair" role="group" aria-label={t('home.actions.title')}>
            <button
              type="button"
              className="gv-homepage__act"
              aria-expanded={joinOpen}
              aria-controls="home-join"
              onClick={() => setJoinOpen((open) => !open)}
            >
              <span className="gv-homepage__act-title">{t('home.join.title')}</span>
              <span className="gv-homepage__act-hint">{t('home.join.hint')}</span>
            </button>
            <button
              type="button"
              className="gv-homepage__act gv-homepage__act--primary"
              onClick={onCreate}
            >
              <span className="gv-homepage__act-title">{t('home.create.title')}</span>
              <span className="gv-homepage__act-hint">{t('home.create.hint')}</span>
            </button>
          </div>
          <span className="gv-homepage__rule" aria-hidden="true" />
          <div id="home-join" className="gv-homepage__join" ref={joinRef} hidden={!joinOpen}>
            <form onSubmit={submit} onPasteCapture={paste} aria-label={t('home.join.codeLabel')}>
              <p className="ui-kicker">{t('home.join.codeLabel')}</p>
              <div className="gv-homepage__code">
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
                <button
                  type="submit"
                  className="gv-homepage__go"
                  aria-disabled={looking || undefined}
                >
                  {looking ? t('home.join.looking') : t('home.join.go')}
                </button>
              </div>
              <p className="gv-homepage__note">{t('home.join.paste')}</p>
              {recent.length > 0 && (
                <div className="gv-homepage__recent">
                  <p className="ui-kicker">{t('home.join.recent')}</p>
                  <ul>
                    {recent.map((c) => (
                      <li key={c}>
                        <button
                          type="button"
                          className="gv-homepage__recent-code"
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

        <div
          className={
            shown.length > 0 ? 'gv-homepage__deck' : 'gv-homepage__deck gv-homepage__deck--solo'
          }
        >
          <section className="gv-homepage__last" aria-labelledby="home-last">
            <div className="gv-homepage__lasthead">
              <h2 id="home-last" className="ui-kicker gv-homepage__label">
                {t('home.last.kicker')}
              </h2>
              <span className="gv-homepage__badge" data-result={result}>
                {badge}
              </span>
            </div>
            <div className="gv-homepage__record">
              <div className="gv-homepage__lot">
                <p className="ui-kicker">{t('home.last.lot')}</p>
                <p className="gv-homepage__lot-title">{last.lotTitle ?? t('home.last.untitled')}</p>
                <p className="gv-homepage__meta">
                  {roleLine(last)}
                  <span aria-hidden="true">{' / '}</span>
                  <span>{timeAgo(last.lastSeenAt, now)}</span>
                </p>
              </div>
              <div className="gv-homepage__fig">
                <p className="ui-kicker">
                  {result === 'open' ? t('home.last.priceOpen') : t('home.last.priceFinal')}
                </p>
                {last.lastPriceCents === null ? (
                  <p className="gv-homepage__nobids">{t('home.last.noBids')}</p>
                ) : (
                  <Price cents={last.lastPriceCents} />
                )}
              </div>
            </div>
            <div className="gv-homepage__foot-row">
              <p className="gv-homepage__result" data-result={result}>
                {resultLine(last, result)}
              </p>
              <div className="gv-homepage__room" aria-label={t('home.links.label')} role="group">
                {check === 'checking' && (
                  <p className="gv-homepage__note">{t('home.room.checking')}</p>
                )}
                {check === 'unknown' && (
                  <p className="gv-homepage__note">{t('home.room.unknown')}</p>
                )}
                {reachable && (
                  <ul className="gv-homepage__links">
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
            </div>
            <p className="gv-homepage__caption">
              {t('home.last.caption', { minutes: ROOM_MINUTES })}
            </p>
          </section>

          {shown.length > 0 && (
            <section className="gv-homepage__earlier" aria-labelledby="home-earlier">
              <h2 id="home-earlier" className="ui-kicker gv-homepage__label">
                {t('home.earlier.kicker')}
              </h2>
              <ol className="gv-homepage__rows">
                {shown.map((room) => {
                  const r = effectiveResult(room, now);
                  return (
                    <li key={room.roomId} className="gv-homepage__row">
                      <span className="gv-homepage__row-title">
                        {room.lotTitle ?? t('home.last.untitled')}
                      </span>
                      <span className="gv-homepage__row-result">{shortResult(r)}</span>
                      <span className="gv-homepage__row-ago">
                        {timeAgo(room.lastSeenAt, now)}
                        {expiredByTime(room, now) && (
                          <span className="gv-homepage__row-gone">
                            {' / '}
                            {t('home.earlier.deleted')}
                          </span>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </section>
          )}
        </div>

        <section className="gv-homepage__tiles" aria-labelledby="home-tiles">
          <h2 id="home-tiles" className="gv-homepage__sr">
            {t('home.tiles.title')}
          </h2>
          <ul className="gv-homepage__tilelist">
            {TILES.map((tile) => (
              <li key={tile.id}>
                <a
                  className="gv-homepage__tile"
                  href={tile.href}
                  onClick={(e) => {
                    if (!tile.internal || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) {
                      return;
                    }
                    e.preventDefault();
                    onNavigate(tile.href);
                  }}
                >
                  <h3 className="gv-homepage__tile-title">{t(`home.tile.${tile.id}.title`)}</h3>
                  <p className="gv-homepage__tile-hint">{t(`home.tile.${tile.id}.hint`)}</p>
                  <p className="gv-homepage__tile-tag">{t(`home.tile.${tile.id}.tag`)}</p>
                </a>
              </li>
            ))}
          </ul>
        </section>
      </main>

      <footer className="gv-homepage__foot">
        <p>{t('home.footer.sandbox')}</p>
        <p className="gv-homepage__foot-local">
          {t('home.footer.local')}{' '}
          <button type="button" className="gv-homepage__clear" onClick={onClear}>
            {t('home.footer.clear')}
          </button>
        </p>
      </footer>
    </div>
  );
}

export default HomeScreen;
