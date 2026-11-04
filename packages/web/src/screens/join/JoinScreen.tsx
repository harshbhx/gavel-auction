import { lazy, Suspense, useEffect } from 'react';

import { t } from '../../copy/t';
import { Button } from '../../design/primitives/Button';
import { getBidderSession } from '../../store/session';

const QrCode = lazy(() => import('./QrCode'));

export type JoinState = 'loading' | 'open' | 'ended' | 'notFound';

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
  /** Whether a valid session is stored for this room. Defaults to reading session storage. */
  hasSession?: boolean;
}

/** The URL a QR on the big screen encodes (R-WEB-050). */
export function joinUrl(origin: string, roomId: string, shortCode: string | null): string {
  const base = `${origin}/join/${encodeURIComponent(roomId)}`;
  return shortCode === null ? base : `${base}?c=${encodeURIComponent(shortCode)}`;
}

/** Resolves a room and routes to register or bid (R-WEB-050, R-WEB-052). */
export function JoinScreen({
  roomId,
  roomName,
  shortCode,
  state,
  origin,
  onNavigate,
  hasSession,
}: JoinScreenProps) {
  const returning = hasSession ?? getBidderSession(roomId) !== null;
  const bidPath = `/r/${encodeURIComponent(roomId)}/bid`;

  useEffect(() => {
    if (returning && state === 'open') onNavigate(bidPath);
  }, [returning, state, bidPath, onNavigate]);

  if (state === 'notFound') {
    return (
      <main>
        <h1 tabIndex={-1}>{t('join.notFound')}</h1>
      </main>
    );
  }
  if (state === 'loading' || roomName === null) {
    return (
      <main aria-busy="true">
        <h1 tabIndex={-1}>{t('app.name')}</h1>
      </main>
    );
  }
  if (state === 'ended') {
    return (
      <main>
        <h1 tabIndex={-1}>{t('join.title', { room: roomName })}</h1>
        <p>{t('join.ended')}</p>
        <Button onClick={() => onNavigate(bidPath)}>{t('join.watch')}</Button>
      </main>
    );
  }

  const url = joinUrl(origin, roomId, shortCode);
  return (
    <main>
      <h1 tabIndex={-1}>{t('join.title', { room: roomName })}</h1>
      <Suspense fallback={null}>
        <QrCode url={url} size={192} />
      </Suspense>
      {shortCode !== null && <p>{t('join.code', { code: shortCode })}</p>}
      <Button size="bid" onClick={() => onNavigate(`/r/${encodeURIComponent(roomId)}/register`)}>
        {t('join.asBidder')}
      </Button>
      <Button variant="outline" onClick={() => onNavigate(bidPath)}>
        {t('join.watch')}
      </Button>
    </main>
  );
}
