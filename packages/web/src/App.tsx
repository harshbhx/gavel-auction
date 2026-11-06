import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { Cents, type MsgId } from '@gavel/shared';
import { PROTOCOL_VERSION } from './wire';
import { t } from './copy/t';
import { socketUrl, startLiveRoom, type LiveRoom } from './net/liveRoom';
import { Announcer } from './a11y/Announcer';
import type { PaymentsMode } from './config';
import { receiptSource } from './ladder/fromWire';
import type { Transport } from './net/transport';
import { WebSocketTransport } from './net/wsTransport';
import { clearSession, loadSession, saveSession, type SessionRole } from './net/session';
import { createApprovalPort, createReturnAdapter, useApproval } from './payments/useApproval';
import { RouteScreen, matchRoute, type RouteMatch } from './routes';
import { AuditTable } from './screens/audit/AuditTable';
import { Export } from './screens/audit/Export';
import { Filters, useUrlFilters } from './screens/audit/Filters';
import { applyFilters } from './screens/audit/filters';
import { Empty, Loading, Offline } from './screens/states/States';
import { useOnline } from './screens/states/useOnline';
import { BidScreen } from './screens/bid/BidScreen';
import { LiveConsole } from './screens/console/LiveConsole';
import { GalleryScreen } from './screens/gallery/GalleryScreen';
import { JoinScreen, type JoinState } from './screens/join/JoinScreen';
import { LandingScreen } from './screens/landing/LandingScreen';
import { fetchOpsSummary, OpsView, type OpsSummaryView } from './ops/OpsView';
import { DemoLauncher, type DemoLinks } from './screens/demo/DemoLauncher';
import { Receipt } from './screens/receipt/Receipt';
import { Approve } from './screens/register/Approve';
import { Return } from './screens/register/Return';
import { RegisterScreen, type RegistrationDraft } from './screens/register/RegisterScreen';
import { ScreenView } from './screens/screen/ScreenView';
import { ErrorBoundary } from './screens/states/ErrorBoundary';
import { NotFound } from './screens/states/NotFound';
import { TokenGate } from './screens/states/TokenGate';
import { RoomError, isHaltingError, isTerminalError } from './screens/states/RoomError';
import { roomStore, useRoom } from './store/roomStore';
import { summarizePending, type PendingSummary } from './store/localEvents';
import { getStaffSession, hasAuctioneerAccess, readAuctioneerToken } from './store/session';

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

const ReplayScreen = lazy(() => import('./screens/replay/ReplayScreen'));

const NAVIGATE_EVENT = 'gavel:navigate';

/** Client-side navigation: updates the address bar and tells the app to re-match the route. */
export function navigate(to: string): void {
  window.history.pushState(null, '', to);
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
}

/** Which stored slot a route reads: the screen has its own, so it never touches a bidder token. */
function roleOf(routeId: string): SessionRole {
  return routeId === 'screen' ? 'screen' : 'bidder';
}

function tokenFor(routeId: string, roomId: string): { token: string; bidderId?: string } | null {
  if (routeId === 'screen') {
    const fromFragment = readAuctioneerToken(roomId);
    if (fromFragment !== null) {
      // The fragment is cleared once read, so a reload needs the token kept for a watcher.
      saveSession(roomId, { token: fromFragment }, undefined, 'screen');
      return { token: fromFragment };
    }
    const watcher = loadSession(roomId, undefined, 'screen');
    return watcher === null ? null : { token: watcher.token };
  }
  if (routeId === 'console' || routeId === 'audit') {
    const fromFragment = readAuctioneerToken(roomId);
    if (fromFragment !== null) return { token: fromFragment };
    // A bidder token is never presented on these routes.
    const staff = getStaffSession(roomId);
    return staff === null ? null : { token: staff.token };
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
  /** Bumped to open the connection again after a refusal that only needed a wait. */
  attempt = 0,
  /** False keeps the hook idle, for a route that has no live server to join. */
  enabled = true,
): Live {
  const [live, setLive] = useState<Live>({ room: null, transport: null });
  useEffect(() => {
    if (!enabled) return undefined;
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
  }, [liveBase, roomId, token, bidderId, attempt, enabled]);
  return live;
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
      s.unknownAmount ?? '',
    ].join('|');
  };
  const subscribe = (cb: () => void): (() => void) =>
    room === null ? () => undefined : room.pending.subscribe(cb);
  const key = useSyncExternalStore(subscribe, read);
  return useMemo(() => {
    const [waiting = '0', reason = '', mid = '', unknown = '', amount = ''] = key.split('|');
    return {
      waiting: waiting === '1',
      rejection: reason === '' ? null : { reason, mid },
      unknownMid: unknown === '' ? null : (unknown as MsgId),
      unknownAmount: amount === '' ? null : Cents(Number(amount)),
    };
  }, [key]);
}

interface LiveRouteProps {
  match: RouteMatch;
  liveBase: string;
  roomId: string;
  token: string;
  bidderId: string | undefined;
  api: Api | undefined;
}

function LiveRoute({ match, liveBase, roomId, token, bidderId, api }: LiveRouteProps): ReactNode {
  const [attempt, setAttempt] = useState(0);
  const { room, transport } = useLiveRoom(liveBase, roomId, token, bidderId, attempt);
  const view = usePendingView(room);
  const lastError = useRoom((s) => s.lastError);
  const refused = lastError !== null && isHaltingError(lastError.code) ? lastError : null;
  const dead = refused !== null && isTerminalError(refused.code);
  const role = roleOf(match.route.id);
  useEffect(() => {
    // A refused token is dead: forget it, so a reload does not reuse it.
    if (dead) clearSession(roomId, undefined, role);
  }, [dead, roomId, role]);
  const myPaddle = useRoom((s) =>
    bidderId === undefined
      ? undefined
      : s.snapshot?.roster.find((r) => r.bidderId === bidderId)?.paddle,
  );
  const respond = (confirmId: string, accept: boolean): void =>
    transport?.send({ v: PROTOCOL_VERSION, t: 'confirm_response', confirmId, accept });
  if (refused !== null) {
    // The connection is stopped; the bid screen would only say it is waiting for a lot.
    return (
      <main data-route={match.route.id}>
        <RoomError
          error={refused}
          rejoinHref={`/join/${encodeURIComponent(roomId)}`}
          onRetry={() => setAttempt((n) => n + 1)}
        />
      </main>
    );
  }
  const other = lastError !== null && !isHaltingError(lastError.code) ? lastError : null;
  const notice = (
    <RoomError
      error={other}
      rejoinHref={`/join/${encodeURIComponent(roomId)}`}
      onRetry={() => setAttempt((n) => n + 1)}
    />
  );
  switch (match.route.id) {
    case 'bid':
      return (
        <div data-route="bid">
          {notice}
          <BidScreen
            onBid={(amount) => room?.bid(Cents(amount), 'qr')}
            canSend={room !== null}
            pending={view.waiting}
            rejection={view.rejection}
            unsent={view.unknownMid !== null}
            unsentCents={view.unknownAmount}
            onResend={() => {
              if (view.unknownMid !== null) room?.pending.retry(view.unknownMid);
            }}
            {...(myPaddle === undefined ? {} : { myPaddle, onConfirm: respond })}
          />
        </div>
      );
    case 'receipt':
      return (
        <>
          {notice}
          <ReceiptRoute roomId={roomId} />
        </>
      );
    case 'audit':
      return <AuditRoute />;
    case 'screen':
      return (
        <div data-route="screen">
          {notice}
          <ScreenRoute roomId={roomId} api={api} />
        </div>
      );
    default:
      return (
        <div data-route="console">
          <LiveConsole
            room={room}
            roomId={roomId}
            token={token}
            apiBase={liveBase.replace(/^ws/, 'http').replace(/\/+$/, '')}
            rejection={view.rejection?.reason ?? ''}
            onConfirmAnswer={(confirmId, accept) => {
              respond(confirmId, accept);
              roomStore.dispatch({ kind: 'confirm_resolved', confirmId });
            }}
          />
        </div>
      );
  }
}

/** Lot title from the auction info; the server has no short join code, so none is shown. */
function ScreenRoute({ roomId, api }: { roomId: string; api: Api | undefined }) {
  const [title, setTitle] = useState<string | null>(null);
  useEffect(() => {
    if (api === undefined) return undefined;
    let live = true;
    fetchJson(`${api.apiBase}/api/auctions/${encodeURIComponent(roomId)}`)
      .then((body) => {
        const got = (body as { title?: unknown }).title;
        if (live && typeof got === 'string' && got !== '') setTitle(got);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [api, roomId]);
  return (
    <ScreenView
      lotTitle={title ?? t('screen.untitled')}
      code={null}
      joinUrl={`${window.location.origin}/join/${encodeURIComponent(roomId)}`}
    />
  );
}

/** Replay of a recording: the bundle is fetched from the recording folder. */
function ReplayRoute({ match }: { match: RouteMatch }) {
  const recordingId = match.params['recordingId'];
  return (
    <RouteScreen match={match}>
      {recordingId !== undefined && (
        <Suspense fallback={<p role="status">{t('net.resyncing')}</p>}>
          <ReplayScreen recordingId={recordingId} />
        </Suspense>
      )}
    </RouteScreen>
  );
}

export function ReceiptRoute({ roomId }: { roomId: string }) {
  const state = useRoom((s) => s);
  const online = useOnline();
  const { view, paddle } = useMemo(() => receiptSource(state), [state]);
  return (
    <main data-route="receipt">
      {!online && <Offline view="receipt" />}
      {state.snapshot === null ? (
        <Loading view="receipt" />
      ) : view === null ? (
        <Empty view="receipt" />
      ) : (
        <Receipt view={view} paddle={paddle} itemName={roomId} at={Date.now()} />
      )}
    </main>
  );
}

const NO_ROSTER: readonly { bidderId: string; paddle: number }[] = [];

export function AuditRoute() {
  const rows = useRoom((s) => s.audit);
  const loaded = useRoom((s) => s.snapshot !== null);
  const truncated = useRoom((s) => s.auditTruncated);
  const roomId = useRoom((s) => s.auctionId);
  const roster = useRoom((s) => s.snapshot?.roster ?? NO_ROSTER);
  const online = useOnline();
  const [filters, setFilters] = useUrlFilters();
  const paddleOf = (id: string): number | null =>
    roster.find((r) => r.bidderId === id)?.paddle ?? null;
  const filtered = applyFilters(rows, filters, paddleOf);
  return (
    <main data-route="audit">
      <h1 tabIndex={-1}>{t('audit.title')}</h1>
      {!online && <Offline view="audit" />}
      {!loaded ? (
        <Loading view="audit" />
      ) : rows.length === 0 ? (
        <Empty view="audit" />
      ) : (
        <>
          <Filters filters={filters} onChange={setFilters} />
          <Export
            roomId={roomId}
            lotId={roomId}
            filteredRows={filtered}
            allRows={rows}
            paddleOf={paddleOf}
            truncated={truncated}
          />
          <AuditTable rows={filtered} paddleOf={paddleOf} />
        </>
      )}
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

/** Room states in which the hammer has fallen, so the server no longer takes a registration. */
const REGISTRATION_CLOSED = ['CLOSING', 'SETTLING', 'DONE'];

function RegisterRoute({
  roomId,
  api,
  liveBase,
}: {
  roomId: string;
  api: Api;
  liveBase: string | undefined;
}) {
  const [who, setWho] = useState<{ token: string; bidderId: string } | null>(() => {
    const stored = loadSession(roomId);
    return stored?.bidderId === undefined
      ? null
      : { token: stored.token, bidderId: stored.bidderId };
  });
  const [draft, setDraft] = useState<RegistrationDraft | null>(null);
  // The draft is kept when the buyer goes back, so the name and paddle they typed are still there.
  const [approving, setApproving] = useState(false);
  const [failed, setFailed] = useState(false);
  // The room's own limits and roster come from its snapshot, over the same socket the bid screen uses.
  useLiveRoom(
    liveBase ?? '',
    roomId,
    who?.token ?? '',
    who?.bidderId,
    0,
    liveBase !== undefined && who !== null,
  );
  const snapshot = useRoom((s) => (s.snapshot?.auctionId === roomId ? s.snapshot : null));
  const roomError = useRoom((s) => s.lastError);

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
  const live = liveBase !== undefined;
  if (live && snapshot === null) {
    return (
      <main data-route="register">
        {roomError === null ? (
          <p role="status">{t('reg.confirming')}</p>
        ) : (
          <RoomError
            error={roomError}
            rejoinHref={`/join/${encodeURIComponent(roomId)}`}
            onRetry={() => window.location.reload()}
          />
        )}
      </main>
    );
  }
  if (snapshot !== null && REGISTRATION_CLOSED.includes(snapshot.status)) {
    return (
      <main data-route="register">
        <Approve
          state="idle"
          result={null}
          ceilingCents={0}
          closed
          watchHref={`/r/${encodeURIComponent(roomId)}/bid`}
          onBackToCeiling={() => undefined}
          onRetry={() => undefined}
          onContinue={() => undefined}
        />
      </main>
    );
  }
  if (draft === null || !approving) {
    const presets = snapshot?.config.ceilingPresets;
    const others = (snapshot?.roster ?? []).filter((r) => r.bidderId !== who.bidderId);
    const mine = snapshot?.roster.find((r) => r.bidderId === who.bidderId)?.paddle;
    const paddles = others.map((r) => r.paddle);
    return (
      // RegisterScreen renders the page's one main landmark.
      <div data-route="register">
        <RegisterScreen
          suggestedPaddle={mine ?? Math.max(0, ...paddles) + 1}
          takenPaddles={paddles}
          minCents={presets === undefined ? CEILING_MIN_CENTS : Math.min(...presets)}
          maxCents={presets === undefined ? CEILING_MAX_CENTS : Math.max(...presets)}
          {...(presets === undefined ? {} : { presetsCents: presets })}
          {...(draft === null ? {} : { initial: draft })}
          onApprove={(next) => {
            setDraft(next);
            setApproving(true);
          }}
        />
      </div>
    );
  }
  return (
    <ApproveRoute
      roomId={roomId}
      bidderId={who.bidderId}
      token={who.token}
      api={api}
      ceilingCents={draft.ceilingCents}
      onBack={() => setApproving(false)}
    />
  );
}

function ApproveRoute(props: {
  roomId: string;
  bidderId: string;
  token: string;
  api: Api;
  ceilingCents: number;
  onBack: () => void;
}) {
  const { roomId, bidderId, token, api, ceilingCents } = props;
  const port = useMemo(
    () =>
      createApprovalPort(
        api.payments,
        { apiBase: api.apiBase, token },
        { apiBase: api.apiBase, clientId: api.paypalClientId, token },
      ),
    [api, token],
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

/** Where a buyer lands after approving on PayPal's own page; finishes the hold once. */
function ReturnRoute({ roomId, api }: { roomId: string; api: Api }) {
  const stored = loadSession(roomId);
  const adapter = useMemo(
    () =>
      createReturnAdapter({
        apiBase: api.apiBase,
        clientId: api.paypalClientId,
        token: stored?.token ?? '',
      }),
    [api, stored?.token],
  );
  if (stored === null || stored.bidderId === undefined) {
    return (
      <main data-route="return">
        <p role="alert">{t('reg.expired')}</p>
      </main>
    );
  }
  const orderId = new URLSearchParams(window.location.search).get('token') ?? '';
  return (
    <Return
      adapter={adapter}
      roomId={roomId}
      bidderId={stored.bidderId}
      orderId={orderId}
      ceilingCents={CEILING_MIN_CENTS}
      onBackToCeiling={() => navigate(`/r/${encodeURIComponent(roomId)}/register`)}
      onContinue={() => navigate(`/r/${encodeURIComponent(roomId)}/bid`)}
    />
  );
}

function OpsRoute({ api }: { api: Api | undefined }) {
  const [key, setKey] = useState('');
  const [summary, setSummary] = useState<OpsSummaryView | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const labels = {
    title: t('ops.title'),
    loading: t('ops.loading'),
    sagas: t('ops.sagas'),
    noSagas: t('ops.noSagas'),
    paypal: t('ops.paypal'),
    logs: t('ops.logs'),
  };
  const load = (): void => {
    if (api === undefined) return;
    setError(undefined);
    fetchOpsSummary(api.apiBase, key)
      .then(setSummary)
      .catch(() => setError(t('ops.failed')));
  };
  return (
    <main data-route="ops">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          load();
        }}
      >
        <label>
          {t('ops.keyLabel')}
          <input
            type="password"
            autoComplete="off"
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
        </label>
        <button type="submit">{t('ops.load')}</button>
      </form>
      {(summary !== undefined || error !== undefined) && (
        <OpsView labels={labels} summary={summary} error={error} />
      )}
    </main>
  );
}

function roomLinks(roomId: string): DemoLinks {
  const base = `/r/${encodeURIComponent(roomId)}`;
  return {
    console: `${base}/console`,
    screen: `${base}/screen`,
    bidder: `/join/${encodeURIComponent(roomId)}`,
    audit: `${base}/audit`,
  };
}

/** The server has no demo room route yet, so live creation fails and offers the scripted demo. */
function DemoRoute({ api }: { api: Api | undefined }) {
  return (
    <DemoLauncher
      initialMode={api === undefined ? 'scripted' : 'live'}
      createRoom={() => Promise.reject(new Error('no demo room route'))}
      startScripted={() => roomLinks('demo')}
      openConsole={navigate}
    />
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
  if (id === 'gallery') {
    return (
      <RouteScreen match={match}>
        <GalleryScreen />
      </RouteScreen>
    );
  }
  const who = live && roomId !== undefined ? tokenFor(id, roomId) : null;
  if (id === 'ops') return <OpsRoute api={api} />;
  if (id === 'landing' && api !== undefined) return <LandingRoute api={api} />;
  if (id === 'demo') return <DemoRoute api={api} />;
  if (id === 'notFound') return <NotFound />;
  if (id === 'replay') return <ReplayRoute match={match} />;
  if (
    id === 'console' &&
    liveBase !== undefined &&
    roomId !== undefined &&
    roomId !== 'demo' &&
    who === null &&
    !hasAuctioneerAccess(roomId)
  ) {
    return (
      <TokenGate role="auctioneer" token={null}>
        {null}
      </TokenGate>
    );
  }
  if (id === 'join' && roomId !== undefined && api !== undefined) {
    return <JoinRoute roomId={roomId} api={api} />;
  }
  if (id === 'register' && roomId !== undefined && api !== undefined) {
    return <RegisterRoute roomId={roomId} api={api} liveBase={liveBase} />;
  }
  if (id === 'return' && roomId !== undefined && api !== undefined) {
    return <ReturnRoute roomId={roomId} api={api} />;
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
      api={api}
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
      {match.route.id !== 'gallery' && <Announcer />}
      <Routed match={match} liveBase={liveBase} api={api} />
    </ErrorBoundary>
  );
}
