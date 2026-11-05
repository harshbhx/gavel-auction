import {
  Component,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ErrorInfo,
  type ReactNode,
} from 'react';
import { Cents, type MsgId } from '@gavel/shared';
import { t } from './copy/t';
import { Icon } from './design/icons';
import { Banner } from './design/primitives/Banner';
import { startLiveRoom, type LiveRoom } from './net/liveRoom';
import { loadSession } from './net/session';
import { RouteScreen, matchRoute, type RouteMatch } from './routes';
import { BidScreen } from './screens/bid/BidScreen';
import { ConsoleScreen } from './screens/console/ConsoleScreen';
import { ScreenView } from './screens/screen/ScreenView';
import { summarizePending, type PendingSummary } from './store/localEvents';
import { readAuctioneerToken } from './store/session';

export interface AppProps {
  /** Starting path. Defaults to the browser location; tests pass their own. */
  initialPath?: string;
  /** Whether /gallery exists (dev and preview builds only). */
  gallery?: boolean;
  /** Socket endpoint base. When set, the bid, screen and console routes join the real server. */
  liveBase?: string;
}

const NAVIGATE_EVENT = 'gavel:navigate';

/** Client-side navigation: updates the address bar and tells the app to re-match the route. */
export function navigate(to: string): void {
  window.history.pushState(null, '', to);
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
}

interface BoundaryState {
  failed: boolean;
}

class ErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  override state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  override componentDidCatch(_error: Error, _info: ErrorInfo): void {
    // The fallback below is the whole response; details go to the audit trail, not the console.
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <main>
        <Banner tone="info" icon={<Icon name="lock" />}>
          {t('banner.sandbox')}
        </Banner>
        <h1 tabIndex={-1}>{t('err.boundary')}</h1>
        <button type="button" onClick={() => window.location.reload()}>
          {t('err.reload')}
        </button>
      </main>
    );
  }
}

function tokenFor(routeId: string, roomId: string): { token: string; bidderId?: string } | null {
  if (routeId === 'console') {
    const fromFragment = readAuctioneerToken();
    if (fromFragment !== null) return { token: fromFragment };
  }
  const stored = loadSession(roomId);
  if (stored === null) return null;
  return stored.bidderId === undefined
    ? { token: stored.token }
    : { token: stored.token, bidderId: stored.bidderId };
}

function useLiveRoom(
  liveBase: string,
  roomId: string,
  token: string,
  bidderId: string | undefined,
): LiveRoom | null {
  const [room, setRoom] = useState<LiveRoom | null>(null);
  useEffect(() => {
    const started = startLiveRoom({
      wsBase: liveBase,
      roomId,
      token,
      ...(bidderId === undefined ? {} : { bidderId }),
    });
    setRoom(started);
    return () => {
      started?.stop();
      setRoom(null);
    };
  }, [liveBase, roomId, token, bidderId]);
  return room;
}

/** Outcome of the latest bid this device sent: waiting, rejected, or unanswered. */
function usePendingView(room: LiveRoom | null): PendingSummary {
  const read = (): string => {
    if (room === null) return '';
    const s = summarizePending(room.pending.list());
    return [
      s.waiting ? '1' : '0',
      s.rejection?.reason ?? '',
      s.rejection?.mid ?? '',
      s.unknownMid ?? '',
    ].join('|');
  };
  const subscribe = (cb: () => void): (() => void) =>
    room === null ? () => undefined : room.pending.subscribe(cb);
  const key = useSyncExternalStore(subscribe, read);
  return useMemo(() => {
    const [waiting = '0', reason = '', mid = '', unknown = ''] = key.split('|');
    return {
      waiting: waiting === '1',
      rejection: reason === '' ? null : { reason, mid },
      unknownMid: unknown === '' ? null : (unknown as MsgId),
    };
  }, [key]);
}

interface LiveRouteProps {
  match: RouteMatch;
  liveBase: string;
  roomId: string;
  token: string;
  bidderId: string | undefined;
}

function LiveRoute({ match, liveBase, roomId, token, bidderId }: LiveRouteProps): ReactNode {
  const room = useLiveRoom(liveBase, roomId, token, bidderId);
  const view = usePendingView(room);
  switch (match.route.id) {
    case 'bid':
      return (
        <main data-route="bid">
          <BidScreen
            onBid={(amount) => room?.bid(Cents(amount), 'qr')}
            canSend={room !== null}
            pending={view.waiting}
            rejection={view.rejection}
            unsent={view.unknownMid !== null}
            onResend={() => {
              if (view.unknownMid !== null) room?.pending.retry(view.unknownMid);
            }}
          />
        </main>
      );
    case 'screen':
      return (
        <main data-route="screen">
          <ScreenView
            lotTitle={roomId}
            code={roomId}
            joinUrl={`${window.location.origin}/join/${encodeURIComponent(roomId)}`}
          />
        </main>
      );
    default:
      return (
        <main data-route="console">
          <ConsoleScreen settlementView={null} />
        </main>
      );
  }
}

function Routed({ match, liveBase }: { match: RouteMatch; liveBase: string | undefined }) {
  const id = match.route.id;
  const roomId = match.params['roomId'];
  const live = id === 'bid' || id === 'screen' || id === 'console';
  const who = live && roomId !== undefined ? tokenFor(id, roomId) : null;
  if (liveBase === undefined || roomId === undefined || who === null) {
    return <RouteScreen match={match} />;
  }
  return (
    <LiveRoute
      match={match}
      liveBase={liveBase}
      roomId={roomId}
      token={who.token}
      bidderId={who.bidderId}
    />
  );
}

export function App({ initialPath, gallery = import.meta.env.DEV, liveBase }: AppProps) {
  const [path, setPath] = useState(initialPath ?? window.location.pathname);

  useEffect(() => {
    const sync = (): void => setPath(window.location.pathname);
    window.addEventListener('popstate', sync);
    window.addEventListener(NAVIGATE_EVENT, sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener(NAVIGATE_EVENT, sync);
    };
  }, []);

  const match = matchRoute(path, { gallery });
  return (
    <ErrorBoundary>
      <Routed match={match} liveBase={liveBase} />
    </ErrorBoundary>
  );
}
