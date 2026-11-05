import {
  Component,
  useEffect,
  useState,
  useSyncExternalStore,
  type ErrorInfo,
  type ReactNode,
} from 'react';
import { Cents } from '@gavel/shared';
import { PROTOCOL_VERSION } from './wire';
import { t } from './copy/t';
import { Icon } from './design/icons';
import { Banner } from './design/primitives/Banner';
import { socketUrl, startLiveRoom, type LiveRoom } from './net/liveRoom';
import type { Transport } from './net/transport';
import { WebSocketTransport } from './net/wsTransport';
import { loadSession } from './net/session';
import { RouteScreen, matchRoute, type RouteMatch } from './routes';
import { BidScreen } from './screens/bid/BidScreen';
import { LiveConsole } from './screens/console/LiveConsole';
import { ScreenView } from './screens/screen/ScreenView';
import { roomStore, useRoom } from './store/roomStore';
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
    const fromFragment = readAuctioneerToken(roomId);
    if (fromFragment !== null) return { token: fromFragment };
  }
  const stored = loadSession(roomId);
  if (stored === null) return null;
  return stored.bidderId === undefined
    ? { token: stored.token }
    : { token: stored.token, bidderId: stored.bidderId };
}

interface Live {
  room: LiveRoom | null;
  transport: Transport | null;
}

function useLiveRoom(
  liveBase: string,
  roomId: string,
  token: string,
  bidderId: string | undefined,
): Live {
  const [live, setLive] = useState<Live>({ room: null, transport: null });
  useEffect(() => {
    // The transport is built here so the screens can send a confirm_response on it.
    const transport = new WebSocketTransport(socketUrl(liveBase));
    const started = startLiveRoom({
      wsBase: liveBase,
      roomId,
      token,
      transport,
      ...(bidderId === undefined ? {} : { bidderId }),
    });
    setLive({ room: started, transport });
    return () => {
      started?.stop();
      setLive({ room: null, transport: null });
    };
  }, [liveBase, roomId, token, bidderId]);
  return live;
}

/** Latest outcome of the bids this device sent: whether one is waiting, and the last rejection. */
function usePendingView(room: LiveRoom | null): { waiting: boolean; rejected: string } {
  const read = (): string => {
    if (room === null) return '';
    const list = room.pending.list();
    const waiting = list.some((b) => b.status === 'pending');
    const last = [...list].reverse().find((b) => b.status === 'rejected');
    return `${waiting ? '1' : '0'}${last?.code ?? ''}`;
  };
  const subscribe = (cb: () => void): (() => void) =>
    room === null ? () => undefined : room.pending.subscribe(cb);
  const key = useSyncExternalStore(subscribe, read);
  return { waiting: key.startsWith('1'), rejected: key.slice(1) };
}

interface LiveRouteProps {
  match: RouteMatch;
  liveBase: string;
  roomId: string;
  token: string;
  bidderId: string | undefined;
}

function LiveRoute({ match, liveBase, roomId, token, bidderId }: LiveRouteProps): ReactNode {
  const { room, transport } = useLiveRoom(liveBase, roomId, token, bidderId);
  const view = usePendingView(room);
  const myPaddle = useRoom((s) =>
    bidderId === undefined
      ? undefined
      : s.snapshot?.roster.find((r) => r.bidderId === bidderId)?.paddle,
  );
  const respond = (confirmId: string, accept: boolean): void =>
    transport?.send({ v: PROTOCOL_VERSION, t: 'confirm_response', confirmId, accept });
  switch (match.route.id) {
    case 'bid':
      return (
        <main data-route="bid">
          <BidScreen
            onBid={(amount) => room?.bid(Cents(amount), 'qr')}
            pending={view.waiting}
            rejection={view.rejected === '' ? null : { reason: view.rejected }}
            {...(myPaddle === undefined ? {} : { myPaddle, onConfirm: respond })}
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
          <LiveConsole
            room={room}
            roomId={roomId}
            token={token}
            apiBase={liveBase.replace(/^ws/, 'http').replace(/\/+$/, '')}
            rejection={view.rejected}
            onConfirmAnswer={(confirmId, accept) => {
              respond(confirmId, accept);
              roomStore.dispatch({ kind: 'confirm_resolved', confirmId });
            }}
          />
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
