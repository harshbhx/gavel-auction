import {
  Component,
  useEffect,
  useMemo,
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
import { Announcer } from './a11y/Announcer';
import type { PaymentsMode } from './config';
import type { SettlementView } from './ladder/ladderModel';
import type { Transport } from './net/transport';
import { WebSocketTransport } from './net/wsTransport';
import { loadSession, saveSession } from './net/session';
import { createApprovalPort, useApproval } from './payments/useApproval';
import { RouteScreen, matchRoute, type RouteMatch } from './routes';
import { AuditTable } from './screens/audit/AuditTable';
import { BidScreen } from './screens/bid/BidScreen';
import { LiveConsole } from './screens/console/LiveConsole';
import { JoinScreen, type JoinState } from './screens/join/JoinScreen';
import { LandingScreen } from './screens/landing/LandingScreen';
import { Receipt } from './screens/receipt/Receipt';
import { Approve } from './screens/register/Approve';
import { RegisterScreen, type RegistrationDraft } from './screens/register/RegisterScreen';
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
  /** HTTP side of the server and the payment mode. When set, join, register and landing use it. */
  api?: { apiBase: string; payments: PaymentsMode; paypalClientId: string };
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
  if (routeId === 'console' || routeId === 'audit' || routeId === 'screen') {
    const fromFragment = readAuctioneerToken(roomId);
    if (fromFragment !== null) {
      // The fragment is cleared once read, so a reload needs the token kept for a watcher.
      if (routeId === 'screen') saveSession(roomId, { token: fromFragment });
      return { token: fromFragment };
    }
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
    case 'receipt':
      return <ReceiptRoute roomId={roomId} />;
    case 'audit':
      return <AuditRoute />;
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

/** The settlement as far as the wire tells it: phase, hammer and this bidder's own hold. */
function useSettlementView(): { view: SettlementView | null; paddle: number | null } {
  const snap = useRoom((s) => s.snapshot);
  const hammer = useRoom((s) => s.hammer);
  const me = useRoom((s) => s.snapshot?.you?.bidderId ?? s.me?.bidderId ?? null);
  const settled = snap?.settlement;
  if (snap === null || hammer === null || settled === undefined || me === null) {
    return { view: null, paddle: null };
  }
  const row = snap.roster.find((r) => r.bidderId === me);
  if (row === undefined) return { view: null, paddle: null };
  const state = settled.you ?? settled.auctionState;
  const captured = hammer.winnerId === me && state === 'CAPTURED';
  return {
    paddle: row.paddle,
    view: {
      lotId: snap.auctionId,
      phase: settled.auctionState,
      winnerPaddle: snap.roster.find((r) => r.bidderId === hammer.winnerId)?.paddle ?? null,
      hammerPriceCents: hammer.price,
      holds: [
        {
          paddle: row.paddle,
          name: row.name,
          ceilingCents: snap.you?.ceiling ?? 0,
          state,
          capturedCents: captured ? hammer.price : 0,
          releasedCents: 0,
          verifiedBy: [],
          idSuffix: '',
        },
      ],
      invariants: { ok: true, violations: [] },
    },
  };
}

function ReceiptRoute({ roomId }: { roomId: string }) {
  const { view, paddle } = useSettlementView();
  return (
    <main data-route="receipt">
      <Receipt view={view} paddle={paddle} itemName={roomId} at={Date.now()} />
    </main>
  );
}

function AuditRoute() {
  const rows = useRoom((s) => s.audit);
  const roster = useRoom((s) => s.snapshot?.roster ?? []);
  return (
    <main data-route="audit">
      <h1 tabIndex={-1}>{t('audit.title')}</h1>
      <AuditTable
        rows={rows}
        paddleOf={(id) => roster.find((r) => r.bidderId === id)?.paddle ?? null}
      />
    </main>
  );
}

type Api = NonNullable<AppProps['api']>;

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error('request failed');
  return (await res.json()) as unknown;
}

function LandingRoute({ api }: { api: Api | undefined }) {
  return (
    <LandingScreen
      onStart={() => navigate('/demo')}
      onScripted={() => navigate('/demo')}
      onJoin={async (code) => {
        if (api === undefined) return false;
        try {
          await fetchJson(`${api.apiBase}/api/auctions/${encodeURIComponent(code)}`);
        } catch {
          return false;
        }
        navigate(`/join/${encodeURIComponent(code)}`);
        return true;
      }}
    />
  );
}

function JoinRoute({ roomId, api }: { roomId: string; api: Api | undefined }) {
  const [found, setFound] = useState<{ state: JoinState; title: string | null }>({
    state: api === undefined ? 'open' : 'loading',
    title: api === undefined ? roomId : null,
  });
  useEffect(() => {
    if (api === undefined) return undefined;
    let live = true;
    fetchJson(`${api.apiBase}/api/auctions/${encodeURIComponent(roomId)}`)
      .then((body) => {
        if (!live) return;
        const info = body as { title?: unknown; status?: unknown };
        setFound({
          state: info.status === 'DONE' ? 'ended' : 'open',
          title: typeof info.title === 'string' ? info.title : roomId,
        });
      })
      .catch(() => {
        if (live) setFound({ state: 'notFound', title: null });
      });
    return () => {
      live = false;
    };
  }, [api, roomId]);
  return (
    <JoinScreen
      roomId={roomId}
      roomName={found.title}
      shortCode={null}
      state={found.state}
      origin={window.location.origin}
      onNavigate={navigate}
    />
  );
}

const CEILING_MIN_CENTS = 10000;
const CEILING_MAX_CENTS = 100000;

function RegisterRoute({ roomId, api }: { roomId: string; api: Api }) {
  const [who, setWho] = useState<{ token: string; bidderId: string } | null>(() => {
    const stored = loadSession(roomId);
    return stored?.bidderId === undefined
      ? null
      : { token: stored.token, bidderId: stored.bidderId };
  });
  const [draft, setDraft] = useState<RegistrationDraft | null>(null);
  const [failed, setFailed] = useState(false);

  const invite = who === null ? readAuctioneerToken(roomId) : null;
  useEffect(() => {
    if (who !== null || invite === null) return;
    fetchJson(`${api.apiBase}/api/auctions/${encodeURIComponent(roomId)}/join`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ invite }),
    })
      .then((body) => {
        const got = body as { sessionToken?: unknown; bidderId?: unknown };
        if (typeof got.sessionToken !== 'string' || typeof got.bidderId !== 'string') {
          throw new Error('bad join');
        }
        saveSession(roomId, { token: got.sessionToken, bidderId: got.bidderId });
        setWho({ token: got.sessionToken, bidderId: got.bidderId });
      })
      .catch(() => setFailed(true));
  }, [api, roomId, who, invite]);

  if (who === null) {
    return (
      <main data-route="register">
        {failed || invite === null ? (
          <p role="alert">{t('reg.expired')}</p>
        ) : (
          <p>{t('reg.confirming')}</p>
        )}
      </main>
    );
  }
  if (draft === null) {
    return (
      <main data-route="register">
        <RegisterScreen
          suggestedPaddle={1}
          minCents={CEILING_MIN_CENTS}
          maxCents={CEILING_MAX_CENTS}
          onApprove={setDraft}
        />
      </main>
    );
  }
  return (
    <ApproveRoute
      roomId={roomId}
      bidderId={who.bidderId}
      api={api}
      ceilingCents={draft.ceilingCents}
      onBack={() => setDraft(null)}
    />
  );
}

function ApproveRoute(props: {
  roomId: string;
  bidderId: string;
  api: Api;
  ceilingCents: number;
  onBack: () => void;
}) {
  const { roomId, bidderId, api, ceilingCents } = props;
  const port = useMemo(
    () =>
      createApprovalPort(
        api.payments,
        { apiBase: api.apiBase },
        { apiBase: api.apiBase, clientId: api.paypalClientId },
      ),
    [api],
  );
  const approval = useApproval({ port, roomId, bidderId });
  const { start } = approval;
  useEffect(() => {
    // One attempt per mount; the hook de-duplicates a running one.
    void start(ceilingCents);
  }, [start, ceilingCents]);
  return (
    <main data-route="register">
      <Approve
        state={approval.state}
        result={approval.result}
        ceilingCents={ceilingCents}
        onBackToCeiling={props.onBack}
        onRetry={() => void start(ceilingCents)}
        onContinue={() => navigate(`/r/${encodeURIComponent(roomId)}/bid`)}
      />
    </main>
  );
}

function Routed({
  match,
  liveBase,
  api,
}: {
  match: RouteMatch;
  liveBase: string | undefined;
  api: Api | undefined;
}) {
  const id = match.route.id;
  const roomId = match.params['roomId'];
  const live =
    id === 'bid' || id === 'screen' || id === 'console' || id === 'receipt' || id === 'audit';
  const who = live && roomId !== undefined ? tokenFor(id, roomId) : null;
  if (id === 'landing' && api !== undefined) return <LandingRoute api={api} />;
  if (id === 'join' && roomId !== undefined && api !== undefined) {
    return <JoinRoute roomId={roomId} api={api} />;
  }
  if (id === 'register' && roomId !== undefined && api !== undefined) {
    return <RegisterRoute roomId={roomId} api={api} />;
  }
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

export function App({ initialPath, gallery = import.meta.env.DEV, liveBase, api }: AppProps) {
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
      <Announcer />
      <Routed match={match} liveBase={liveBase} api={api} />
    </ErrorBoundary>
  );
}
