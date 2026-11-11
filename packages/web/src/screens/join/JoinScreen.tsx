import { useEffect } from 'react';

import { WideAside } from '../WideAside';
import { t } from '../../copy/t';
import { ActionGroup } from '../../design/primitives/ActionGroup';
import { Button } from '../../design/primitives/Button';
import '../flows.css';
import { loadRegistration } from '../../payments/registrationStore';
import { getBidderSession } from '../../store/session';
import { NotFound } from '../states/NotFound';
import { ApiProblem } from '../states/ApiProblem';
import { ChunkBoundary, lazyWithRetry } from '../states/ChunkBoundary';

const QrCode = lazyWithRetry(() => import('./QrCode'));

export type JoinState = 'loading' | 'open' | 'ended' | 'notFound' | 'full' | 'busy' | 'unreachable';

export interface JoinScreenProps {
  roomId: string;
  /** Resolved room name; null until the room is known. */
  roomName: string | null;
  /** The six character short code, shown as a fallback to the QR. */
  shortCode: string | null;
  state: JoinState;
  /** Site origin used to build the join URL, for example the page origin. */
  origin: string;
  /** Moves the app to another path. */
  onNavigate: (path: string) => void;
  /** A judge room with simulated holds: offer the PayPal sandbox and the demo side by side. */
  demoHold?: boolean;
  /** Seconds the server asked the client to wait, for the `busy` state. */
  retryAfterS?: number | null;
  /**
   * Whether this device already registered a hold for the room. Defaults to reading session
   * storage: a session alone (the register form was only opened) is not a registered bidder.
   */
  hasSession?: boolean;
}

/** The URL a QR on the big screen encodes (R-WEB-050). */
export function joinUrl(origin: string, roomId: string, shortCode: string | null): string {
  const base = `${origin}/join/${encodeURIComponent(roomId)}`;
  return shortCode === null ? base : `${base}?c=${encodeURIComponent(shortCode)}`;
}

/**
 * The steps still ahead of a bidder who arrived on this page. Finding the room is already done, so
 * the list starts at the register step, numbered 2 and 3, with the current one marked.
 */
function Steps({ current }: { current: 2 | 3 }) {
  const keys = ['join.step2', 'join.step3'] as const;
  return (
    <ol className="gv-join__steps" aria-label={t('join.steps')}>
      {keys.map((key, i) => (
        <li
          key={key}
          className="gv-join__step"
          {...(i + 2 === current ? { 'aria-current': 'step' as const } : {})}
        >
          <span>{t(key)}</span>
        </li>
      ))}
    </ol>
  );
}

/** Phones scanned the QR to get here, so it starts folded there; wide screens show it open. */
function qrStartsOpen(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return window.matchMedia('(min-width: 840px)').matches;
}

function hasRegisteredHold(roomId: string): boolean {
  const stored = getBidderSession(roomId);
  return (
    stored?.bidderId !== undefined &&
    loadRegistration(roomId, stored.bidderId)?.ceilingCents !== undefined
  );
}

/** Resolves a room and routes to register or bid (R-WEB-050, R-WEB-052). */
export function JoinScreen({
  roomId,
  roomName,
  shortCode,
  state,
  origin,
  onNavigate,
  demoHold = false,
  hasSession,
  retryAfterS = null,
}: JoinScreenProps) {
  const returning = hasSession ?? hasRegisteredHold(roomId);
  const bidPath = `/r/${encodeURIComponent(roomId)}/bid`;
  const registerPath = `/r/${encodeURIComponent(roomId)}/register`;

  useEffect(() => {
    if (returning && state === 'open') onNavigate(bidPath);
  }, [returning, state, bidPath, onNavigate]);

  if (state === 'busy' || state === 'unreachable') {
    return (
      <ApiProblem
        kind={state === 'busy' ? 'rateLimited' : 'unreachable'}
        retryAfterS={retryAfterS}
        onNavigate={onNavigate}
      />
    );
  }
  if (state === 'notFound') return <NotFound kind="code" />;
  if (state === 'loading' || roomName === null) {
    return (
      <main className="gv-flow" aria-busy="true">
        <h1 tabIndex={-1}>{t('app.name')}</h1>
        <p role="status" className="gv-join__help">
          {t('join.loading')}
        </p>
      </main>
    );
  }
  if (state === 'ended') {
    return (
      <main className="gv-flow" data-state="ended">
        <p className="ui-kicker">{t('app.name')}</p>
        <h1 tabIndex={-1}>{t('join.title', { room: roomName })}</h1>
        <p role="alert">{t('join.ended')}</p>
        <p className="gv-join__help">{t('join.endedHelp')}</p>
        <ActionGroup>
          <Button onClick={() => onNavigate(bidPath)}>{t('join.watch')}</Button>
          <Button variant="outline" onClick={() => onNavigate('/demo')}>
            {t('join.startDemo')}
          </Button>
        </ActionGroup>
      </main>
    );
  }
  if (state === 'full') {
    return (
      <main className="gv-flow" data-state="full">
        <p className="ui-kicker">{t('app.name')}</p>
        <h1 tabIndex={-1}>{t('join.title', { room: roomName })}</h1>
        <p role="alert">{t('join.full')}</p>
        <p className="gv-join__help">{t('join.fullHelp')}</p>
        <ActionGroup>
          <Button onClick={() => onNavigate(bidPath)}>{t('join.watch')}</Button>
          <Button variant="outline" onClick={() => onNavigate('/')}>
            {t('join.tryAgain')}
          </Button>
        </ActionGroup>
      </main>
    );
  }

  const url = joinUrl(origin, roomId, shortCode);
  return (
    <main className="gv-flow" data-state="open">
      <p className="ui-kicker">{t('app.name')}</p>
      <h1 tabIndex={-1}>{t('join.title', { room: roomName })}</h1>
      {demoHold ? (
        <section className="gv-join__ways" aria-labelledby="gv-join-ways">
          <h2 id="gv-join-ways">{t('join.waysTitle')}</h2>
          <p className="gv-join__help">{t('join.waysWhy')}</p>
          <ActionGroup>
            <Button
              size="bid"
              className="gv-btn--main"
              onClick={() => onNavigate(`${registerPath}?mode=demo`)}
            >
              {t('join.wayDemo')}
            </Button>
            <Button size="bid" variant="outline" onClick={() => onNavigate(registerPath)}>
              {t('join.wayPaypal')}
            </Button>
            <Button size="bid" variant="text" onClick={() => onNavigate(bidPath)}>
              {t('join.watch')}
            </Button>
          </ActionGroup>
        </section>
      ) : (
        <>
          <p className="gv-join__note">{t('join.sandboxNote')}</p>
          <ActionGroup>
            <Button size="bid" className="gv-btn--main" onClick={() => onNavigate(registerPath)}>
              {t('join.asBidder')}
            </Button>
            <Button size="bid" variant="text" onClick={() => onNavigate(bidPath)}>
              {t('join.watch')}
            </Button>
          </ActionGroup>
        </>
      )}
      <Steps current={2} />
      <details className="gv-join__qr" open={qrStartsOpen()}>
        <summary>{t('join.showQr')}</summary>
        <div className="gv-flow__qr">
          <ChunkBoundary>
            <QrCode url={url} size={192} />
          </ChunkBoundary>
        </div>
        {shortCode !== null && (
          <p className="gv-flow__code">{t('join.code', { code: shortCode })}</p>
        )}
      </details>
      <WideAside />
    </main>
  );
}
