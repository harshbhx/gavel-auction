import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Cents, type MsgId } from '@gavel/shared';
import { PROTOCOL_VERSION } from './wire';
import { t } from './copy/t';
import { createJudgeRoom, judgeRoomsAvailable, judgeRoomsStatus } from './net/judgeRooms';
import { checkJudgeKey, judgeKeyOffered } from './net/judgeKey';
import { socketUrl, startLiveRoom, type LiveRoom } from './net/liveRoom';
import { Announcer } from './a11y/Announcer';
import type { PaymentsMode } from './config';
import type { Transport } from './net/transport';
import { WebSocketTransport } from './net/wsTransport';
import { ScenarioTransport } from './net/scenarioTransport';
import {
  DEFAULT_SCENARIO,
  SCRIPTED_DEMO_PATH,
  SCRIPTED_JOIN_PATH,
  readScriptedRequest,
  type ScriptedRequest,
} from './net/scriptedMode';
import { Provenance } from './design/Provenance';
import { SCRIPTED_ROOM_ID, loadScriptedRoom, type ScriptedRoom } from './testing/scriptedRoom';
import { clearSession, type SessionRole } from './net/session';
import { loadHoldMode, loadRegistration, rememberHoldMode } from './payments/registrationStore';
import { SimApprovalAdapter } from './payments/simAdapter';
import { createApprovalPort, createReturnAdapter, useApproval } from './payments/useApproval';
import { HelpLayer } from './help';
import { RouteScreen, matchRoute, type RouteMatch } from './routes';
import { ChainCheck } from './chain/ChainCheck';
import { BidScreen } from './screens/bid/BidScreen';
import { LiveConsole } from './screens/console/LiveConsole';
import { GalleryScreen } from './screens/gallery/GalleryScreen';
import { AuditPage } from './screens/audit/AuditPage';
import { renderAuditLedger } from './screens/audit/AuditGridSlot';
import { JoinScreen, type JoinState } from './screens/join/JoinScreen';
import { OfflineBanner } from './a11y/OfflineBanner';
import { BusyBanner } from './a11y/BusyBanner';
import { Button } from './design/primitives/Button';
import { useConnection } from './net/connection';
import { SkipLink } from './a11y/SkipLink';
import { useRouteChrome } from './a11y/useRouteChrome';
import { RoomGate } from './screens/states/RoomGate';
import { ApiError, apiErrorFor, unreachable } from './net/apiError';
import { WatcherGate } from './screens/join/WatcherGate';
import { LandingScreen } from './screens/landing/LandingScreen';
import { HistoryRecorder } from './home/HistoryRecorder';
import type { RoomCheck } from './home/HomeScreen';
import { clearHistory, readHistory, type HistoryRoom } from './home/history';
import { JudgePanel, type RoomsState } from './screens/judge/JudgePanel';
import { VerifyScreen } from './screens/verify/VerifyScreen';
import { fetchOpsSummary, OpsView, type OpsSummaryView } from './ops/OpsView';
import { DemoLauncher, DemoRoomError, type DemoLinks } from './screens/demo/DemoLauncher';
import { ScriptedJoin } from './screens/demo/ScriptedJoin';
import { ScriptedPlayer, useScriptedPlayback } from './screens/demo/ScriptedPlayer';
import { openJoin, type OpenJoinFailure, type OpenJoinResult } from './net/openJoin';
import { JudgeHub } from './screens/hub/JudgeHub';
import { TokenHelp } from './screens/hub/TokenHelp';
import { hubHref, readHubKeys } from './screens/hub/hubKeys';
import './screens/hub/hub.css';
import { SandboxBanner } from './design/SandboxBanner';
import { ReceiptView } from './screens/receipt/ReceiptView';
import { SharedReceiptRoute, mintReceiptLink } from './screens/receipt/SharedReceipt';
import type { MintReceiptLink } from './screens/receipt/ShareControls';
import { Approve } from './screens/register/Approve';
import { Return } from './screens/register/Return';
import { RegisterScreen, type RegistrationDraft } from './screens/register/RegisterScreen';
import { ceilingRange } from './screens/register/validate';
import { ScreenView } from './screens/screen/ScreenView';
import { ErrorBoundary } from './screens/states/ErrorBoundary';
import { ChunkBoundary, lazyWithRetry } from './screens/states/ChunkBoundary';
import { NotFound } from './screens/states/NotFound';
import { TokenGate } from './screens/states/TokenGate';
import { RoomError, isHaltingError, isTerminalError } from './screens/states/RoomError';
import { roomStore, useRoom } from './store/roomStore';
import { selectors } from './store/selectors';
import { summarizePending, type PendingSummary } from './store/localEvents';
import {
  clearBidderSession,
  getBidderSession,
  hasAuctioneerAccess,
  hasReviewerAccess,
  readAuctioneerToken,
  readInviteToken,
  readReceiptToken,
  rememberBidderSession,
  clearAuctioneerToken,
} from './store/session';

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

// The Home screen loads as its own chunk: the first visit (landing) never pays for it.
const HomeScreen = lazyWithRetry(() => import('./home/HomeScreen'));
const ReplayScreen = lazyWithRetry(() => import('./screens/replay/ReplayScreen'));
const LedgerLab = lazyWithRetry(() => import('./screens/ledger/LedgerLab'));

const NAVIGATE_EVENT = 'gavel:navigate';

/** Client-side navigation: updates the address bar and tells the app to re-match the route. */
export function navigate(to: string): void {
  window.history.pushState(null, '', to);
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
}

/** Which slot a refused token came from: console and audit use the in-memory auctioneer token. */
function roleOf(routeId: string): SessionRole | 'auctioneer' {
  if (routeId === 'screen') return 'screen';
  return routeId === 'console' || routeId === 'audit' ? 'auctioneer' : 'bidder';
}

function tokenFor(routeId: string, roomId: string): { token: string; bidderId?: string } | null {
  if (routeId === 'console' || routeId === 'audit' || routeId === 'screen') {
    // These routes take a fragment or in-memory token only: a bidder session is never used here.
    const fromFragment = readAuctioneerToken(roomId);
    return fromFragment === null ? null : { token: fromFragment };
  }
  const stored = getBidderSession(roomId);
  if (stored === null) return null;
  return stored.bidderId === undefined
    ? { token: stored.token }
    : { token: stored.token, bidderId: stored.bidderId };
}

/** A loaded scenario and where to start it. */
interface ScriptedPlay {
  readonly room: ScriptedRoom;
  readonly at: number | null;
  /** Changes when the player rebuilds the room at the same time. */
  readonly runKey?: number;
  /**
   * Set by the scripted demo player: the scenario is not left on autoplay. The player gets the
   * transport and moves its clock one beat at a time.
   */
  readonly attach?: (transport: ScenarioTransport) => void;
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
  /** Set only in explicit scripted mode: the scenario plays instead of a socket. */
  scripted: ScriptedPlay | null = null,
): Live {
  const [live, setLive] = useState<Live>({ room: null, transport: null });
  useEffect(() => {
    if (!enabled) return undefined;
    // The transport is built here so the screens can send a confirm_response on it.
    const scriptedTransport =
      scripted === null ? null : new ScenarioTransport(scripted.room.scenario);
    const transport: Transport = scriptedTransport ?? new WebSocketTransport(socketUrl(liveBase));
    // A rebuilt scripted room (restart, step back) must not keep the frames of the last run.
    if (scripted?.attach !== undefined) roomStore.enter('scripted-reset');
    const started = startLiveRoom({
      wsBase: liveBase,
      roomId: scripted === null ? roomId : scripted.room.roomId,
      token,
      transport,
      ...(bidderId === undefined ? {} : { bidderId }),
    });
    if (scripted !== null && scriptedTransport !== null) {
      if (scripted.attach !== undefined) {
        scriptedTransport.advance(scripted.at ?? 0);
        scripted.attach(scriptedTransport);
      } else if (scripted.at === null) scriptedTransport.autoplay();
      else scriptedTransport.advance(scripted.at);
    }
    setLive({ room: started, transport });
    return () => {
      started?.stop();
      setLive({ room: null, transport: null });
    };
  }, [liveBase, roomId, token, bidderId, attempt, enabled, scripted]);
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
  /** Explicit scripted mode only. */
  scripted?: ScriptedPlay;
}

function LiveRoute({
  match,
  liveBase,
  roomId,
  token,
  bidderId,
  api,
  scripted,
}: LiveRouteProps): ReactNode {
  const [attempt, setAttempt] = useState(0);
  const { room, transport } = useLiveRoom(
    liveBase,
    roomId,
    token,
    bidderId,
    attempt,
    true,
    scripted ?? null,
  );
  const view = usePendingView(room);
  const connection = useConnection();
  const lastError = useRoom((s) => s.lastError);
  const refused = lastError !== null && isHaltingError(lastError.code) ? lastError : null;
  const dead = refused !== null && isTerminalError(refused.code);
  const role = roleOf(match.route.id);
  useEffect(() => {
    // A refused token is dead: forget it, so a reload does not reuse it.
    if (!dead) return;
    if (role === 'bidder') {
      clearSession(roomId, undefined, role);
      clearBidderSession(roomId);
    } else {
      // Console, screen and audit tokens live in memory and tab storage: drop the dead one, keep the bidder.
      if (role === 'screen') clearSession(roomId, undefined, role);
      clearAuctioneerToken(roomId);
    }
  }, [dead, roomId, role]);
  const myPaddle = useRoom((s) =>
    bidderId === undefined
      ? undefined
      : s.snapshot?.roster.find((r) => r.bidderId === bidderId)?.paddle,
  );
  const stopped = useRoom(selectors.stopped);
  const joinCode = useRoom((s) => s.snapshot?.joinCode ?? null);
  // The way this bidder holds funds (judge-room simulation or PayPal) also serves a limit raise.
  const raisePort = useMemo(() => {
    if (api === undefined || bidderId === undefined || scripted !== undefined) return null;
    return loadHoldMode(roomId) === 'demo'
      ? new SimApprovalAdapter({ apiBase: api.apiBase, token })
      : createApprovalPort(
          api.payments,
          { apiBase: api.apiBase, token },
          { apiBase: api.apiBase, clientId: api.paypalClientId, token },
        );
  }, [api, bidderId, scripted, roomId, token]);
  const respond = (confirmId: string, accept: boolean): void =>
    transport?.send({ v: PROTOCOL_VERSION, t: 'confirm_response', confirmId, accept });
  if (connection.superseded === true) {
    // The server closed this tab for a newer one on the same link. Reconnecting by itself would
    // only evict that tab in turn, so wait until the person asks to use this one.
    return (
      <main data-route={match.route.id} data-superseded="true">
        <h1 tabIndex={-1}>{t('err.superseded.title')}</h1>
        <p role="status">{t('err.superseded.help')}</p>
        <Button onClick={() => setAttempt((n) => n + 1)}>{t('err.superseded.use')}</Button>
      </main>
    );
  }
  if (refused !== null) {
    // The connection is stopped; the bid screen would only say it is waiting for a lot.
    return (
      <main data-route={match.route.id}>
        <h1 tabIndex={-1}>{t('err.refusedTitle')}</h1>
        <RoomError
          error={refused}
          rejoinHref={`/join/${encodeURIComponent(roomId)}`}
          onRetry={() => setAttempt((n) => n + 1)}
        />
        <a className="ui-link" href="/">
          {t('err.home')}
        </a>
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
            onReplace={(amount) => {
              // The price moved past the unanswered bid: drop it and bid the current minimum.
              if (view.unknownMid !== null) room?.pending.cancel(view.unknownMid);
              room?.bid(Cents(amount), 'qr');
            }}
            stopped={stopped}
            onJoin={() => navigate(`/r/${encodeURIComponent(roomId)}/register`)}
            {...(myPaddle === undefined ? {} : { myPaddle, onConfirm: respond })}
            {...(raisePort === null || bidderId === undefined
              ? {}
              : { raise: { port: raisePort, roomId, bidderId } })}
          />
        </div>
      );
    case 'receipt':
      return (
        <>
          {notice}
          <ReceiptRoute
            roomId={roomId}
            {...(api === undefined || bidderId === undefined || scripted !== undefined
              ? {}
              : { share: mintReceiptLink(api.apiBase, roomId, token) })}
          />
        </>
      );
    case 'audit':
      return <AuditRoute />;
    case 'screen':
      return (
        <div data-route="screen">
          {notice}
          <ScreenRoute roomId={roomId} api={api} scripted={scripted !== undefined} />
        </div>
      );
    default:
      return (
        <div data-route="console">
          {scripted === undefined && roomId !== 'demo' && (
            <a className="ui-link gv-hub-back" href={hubHref(roomId, token, joinCode)}>
              {t('hub.backToHub')}
            </a>
          )}
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

/** Lot title and short join code: from the snapshot when it has them, else the public summary. */
function ScreenRoute({
  roomId,
  api,
  scripted = false,
}: {
  roomId: string;
  api: Api | undefined;
  scripted?: boolean;
}) {
  const snapTitle = useRoom((s) => s.snapshot?.lotTitle ?? null);
  const snapCode = useRoom((s) => s.snapshot?.joinCode ?? null);
  const [fetched, setFetched] = useState<{ title: string | null; code: string | null }>({
    title: null,
    code: null,
  });
  useEffect(() => {
    if (api === undefined) return undefined;
    let live = true;
    fetchJson(`${api.apiBase}/api/auctions/${encodeURIComponent(roomId)}`)
      .then((body) => {
        const got = body as { title?: unknown; joinCode?: unknown };
        if (!live) return;
        setFetched({
          title: typeof got.title === 'string' && got.title !== '' ? got.title : null,
          code: typeof got.joinCode === 'string' && got.joinCode !== '' ? got.joinCode : null,
        });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [api, roomId]);
  return (
    <ScreenView
      lotTitle={snapTitle ?? fetched.title ?? t('screen.untitled')}
      code={snapCode ?? fetched.code}
      joinUrl={
        scripted
          ? `${window.location.origin}${SCRIPTED_JOIN_PATH}`
          : `${window.location.origin}/join/${encodeURIComponent(roomId)}`
      }
      theme={scripted ? 'newsprint' : 'projector'}
    />
  );
}

/** Replay of a recording: the bundle is fetched from the recording folder. */
function LedgerRoute({ match }: { match: RouteMatch }) {
  return (
    <RouteScreen match={match}>
      <ChunkBoundary fallback={<p role="status">{t('grid.loading')}</p>}>
        <LedgerLab />
      </ChunkBoundary>
    </RouteScreen>
  );
}

function ReplayRoute({ match }: { match: RouteMatch }) {
  const recordingId = match.params['recordingId'];
  return (
    <RouteScreen match={match}>
      <p>{t('replay.about')}</p>
      <a className="ui-link" href="/">
        {t('err.home')}
      </a>
      {recordingId !== undefined && (
        <ChunkBoundary fallback={<p role="status">{t('net.resyncing')}</p>}>
          <ReplayScreen recordingId={recordingId} />
        </ChunkBoundary>
      )}
    </RouteScreen>
  );
}

export function ReceiptRoute({ roomId, share }: { roomId: string; share?: MintReceiptLink }) {
  const state = useRoom((s) => s);
  return <ReceiptView state={state} roomId={roomId} {...(share === undefined ? {} : { share })} />;
}

export function AuditRoute() {
  const state = useRoom((s) => s);
  return (
    <AuditPage
      state={state}
      roomId={state.auctionId}
      chain={<ChainCheck allowFile />}
      ledger={renderAuditLedger}
    />
  );
}

type Api = NonNullable<AppProps['api']>;

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw unreachable();
  }
  if (!res.ok) throw apiErrorFor(res);
  return (await res.json()) as unknown;
}

function LandingRoute({ api }: { api: Api | undefined }) {
  return (
    <LandingScreen
      onStart={() => navigate('/demo')}
      onScripted={() => navigate(SCRIPTED_DEMO_PATH)}
      onJoin={(code) => joinByCode(api, code)}
    />
  );
}

/** Finds a room by its join code and opens the join page. Resolves false when there is none. */
async function joinByCode(api: Api | undefined, code: string): Promise<boolean> {
  if (api === undefined) return false;
  let id: string;
  try {
    const body = (await fetchJson(`${api.apiBase}/api/auctions/${encodeURIComponent(code)}`)) as {
      auctionId?: unknown;
    };
    id = typeof body.auctionId === 'string' && body.auctionId !== '' ? body.auctionId : code;
  } catch (error) {
    // Only "no such room" means the code is wrong; a limit or a lost network is told apart.
    if (error instanceof ApiError && (error.kind === 'rateLimited' || error.kind === 'unreachable'))
      throw error;
    return false;
  }
  navigate(`/join/${encodeURIComponent(id)}`);
  return true;
}

/** The judge panel: asks the host about live rooms and starts one without an operator key. */
/** Whether a remembered room still answers, by one cheap read-only request. Never throws. */
async function checkRoomOnHost(api: Api, roomId: string): Promise<RoomCheck> {
  try {
    const res = await fetch(`${api.apiBase}/api/auctions/${encodeURIComponent(roomId)}`, {
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) return 'live';
    return res.status === 404 ? 'gone' : 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * The start page. A visitor this browser remembers lands on the Home screen; a first-time visitor
 * (or one who cleared their history) gets the marketing landing page, which is always at /about.
 */
function HomeOrLanding({ api, match }: { api: Api | undefined; match: RouteMatch }) {
  const [rooms, setRooms] = useState<readonly HistoryRoom[]>(() => readHistory());
  const checkRoom = useMemo(
    () => (api === undefined ? undefined : (id: string) => checkRoomOnHost(api, id)),
    [api],
  );
  if (rooms.length === 0) {
    return api === undefined ? <RouteScreen match={match} /> : <LandingRoute api={api} />;
  }
  return (
    <ChunkBoundary fallback={null}>
      <HomeScreen
        rooms={rooms}
        {...(checkRoom === undefined ? {} : { checkRoom })}
        onJoin={(code) => joinByCode(api, code)}
        onCreate={() => navigate('/try')}
        onNavigate={navigate}
        onClear={() => {
          clearHistory();
          setRooms([]);
        }}
      />
    </ChunkBoundary>
  );
}

function TryRoute({ api }: { api: Api | undefined }) {
  const [rooms, setRooms] = useState<RoomsState>(api === undefined ? 'noServer' : 'checking');
  const [keyOffered, setKeyOffered] = useState(false);
  useEffect(() => {
    if (api === undefined) return undefined;
    let live = true;
    judgeRoomsStatus(api.apiBase).then((next) => {
      if (live) setRooms(next);
    });
    judgeKeyOffered(api.apiBase).then((next) => {
      if (live) setKeyOffered(next);
    });
    return () => {
      live = false;
    };
  }, [api]);
  return (
    <JudgePanel
      rooms={rooms}
      createRoom={async (goalCents, judgeKey) => {
        if (api === undefined) throw new Error('no api');
        return createJudgeRoom(api.apiBase, goalCents, judgeKey);
      }}
      openRoom={navigate}
      joinByCode={(code) => joinByCode(api, code)}
      keyOffered={keyOffered}
      checkKey={(key) =>
        api === undefined ? Promise.resolve('unreachable') : checkJudgeKey(api.apiBase, key)
      }
      apiBase={api?.apiBase}
    />
  );
}

/** Whether the host offers simulated holds in judge rooms. Never throws. */
async function judgeSimHolds(apiBase: string): Promise<boolean> {
  try {
    const body = (await fetchJson(`${apiBase}/api/judge/capabilities`)) as { simHolds?: unknown };
    return body.simHolds === true;
  } catch {
    return false;
  }
}

/** Room ids are ULIDs and join codes are short letters and digits, with an optional dash. */
const ROOM_KEY = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;

function JoinRoute({ roomId, api }: { roomId: string; api: Api | undefined }) {
  const malformedRoom = !ROOM_KEY.test(roomId);
  const [found, setFound] = useState<{
    state: JoinState;
    title: string | null;
    id: string;
    code: string | null;
    demoHold: boolean;
    retryAfterS?: number | null;
  }>({
    state: api === undefined ? 'open' : malformedRoom ? 'notFound' : 'loading',
    title: api === undefined ? roomId : null,
    id: roomId,
    code: null,
    demoHold: false,
  });
  useEffect(() => {
    // A code with slashes, dots or spaces cannot be a room: say so without asking the server.
    if (api === undefined || malformedRoom) return undefined;
    let live = true;
    const caps = judgeSimHolds(api.apiBase);
    fetchJson(`${api.apiBase}/api/auctions/${encodeURIComponent(roomId)}`)
      .then(async (body) => {
        const simOn = await caps;
        if (!live) return;
        const info = body as {
          judgeRoom?: unknown;
          title?: unknown;
          status?: unknown;
          auctionId?: unknown;
          joinCode?: unknown;
        };
        setFound({
          state: info.status === 'DONE' ? 'ended' : 'open',
          title: typeof info.title === 'string' ? info.title : roomId,
          id: typeof info.auctionId === 'string' && info.auctionId !== '' ? info.auctionId : roomId,
          code: typeof info.joinCode === 'string' && info.joinCode !== '' ? info.joinCode : null,
          demoHold: simOn && info.judgeRoom === true,
        });
      })
      .catch((error: unknown) => {
        if (!live) return;
        const kind = error instanceof ApiError ? error.kind : 'unreachable';
        const state: JoinState =
          kind === 'notFound' ? 'notFound' : kind === 'rateLimited' ? 'busy' : 'unreachable';
        setFound({
          state,
          title: null,
          id: roomId,
          code: null,
          demoHold: false,
          retryAfterS: error instanceof ApiError ? error.retryAfterS : null,
        });
      });
    return () => {
      live = false;
    };
  }, [api, roomId, malformedRoom]);
  return (
    <JoinScreen
      roomId={found.id}
      roomName={found.title}
      shortCode={found.code}
      demoHold={found.demoHold}
      state={found.state}
      retryAfterS={found.retryAfterS ?? null}
      origin={window.location.origin}
      onNavigate={navigate}
    />
  );
}

const openJoins = new Map<string, Promise<OpenJoinResult>>();

/** The room code to join with: the `c` query of the link, else the room's public summary. */
async function roomCodeFor(apiBase: string, roomId: string): Promise<string | null> {
  const fromLink = new URLSearchParams(window.location.search).get('c');
  if (fromLink !== null && fromLink !== '') return fromLink;
  try {
    const body = (await fetchJson(`${apiBase}/api/auctions/${encodeURIComponent(roomId)}`)) as {
      joinCode?: unknown;
    };
    return typeof body.joinCode === 'string' && body.joinCode !== '' ? body.joinCode : null;
  } catch {
    return null;
  }
}

/** One open join per room at a time, so a re-render or a double mount never takes two seats. */
function openJoinForRoom(apiBase: string, roomId: string): Promise<OpenJoinResult> {
  const running = openJoins.get(roomId);
  if (running !== undefined) return running;
  const started = roomCodeFor(apiBase, roomId)
    .then((code): Promise<OpenJoinResult> | OpenJoinResult =>
      code === null ? { ok: false, reason: 'notOpen' } : openJoin(apiBase, code),
    )
    .finally(() => {
      openJoins.delete(roomId);
    });
  openJoins.set(roomId, started);
  return started;
}

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
    // A fresh invite in the link wins over whatever session this tab still holds.
    if (readInviteToken(roomId) !== null) return null;
    const stored = getBidderSession(roomId);
    return stored?.bidderId === undefined
      ? null
      : { token: stored.token, bidderId: stored.bidderId };
  });
  // `?mode=demo` is the judge-room demo way: a simulated hold instead of a PayPal sandbox hold.
  const [demoHold] = useState(
    () => new URLSearchParams(window.location.search).get('mode') === 'demo',
  );
  useEffect(() => {
    // The raise screen holds the same way the bidder registered (judge-room simulation or PayPal).
    rememberHoldMode(roomId, demoHold ? 'demo' : 'paypal');
  }, [roomId, demoHold]);
  const [draft, setDraft] = useState<RegistrationDraft | null>(null);
  // The draft is kept when the buyer goes back, so the name and paddle they typed are still there.
  const [approving, setApproving] = useState(false);
  const [failed, setFailed] = useState(false);
  // True when the browser refused to store the session: the tab itself holds it until it closes.
  const [notSaved, setNotSaved] = useState(false);
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
  const registrationClosed = useRoom(selectors.registrationClosed);

  const deadSession = who !== null && roomError !== null && isTerminalError(roomError.code);
  useEffect(() => {
    // A refused session is dead: forget it and fall back to the invite or the open join, instead
    // of reconnecting with the same token on every reload.
    if (!deadSession) return;
    clearSession(roomId);
    clearBidderSession(roomId);
    roomStore.dispatch({ kind: 'identify', bidderId: null });
    setWho(null);
  }, [deadSession, roomId]);

  const invite = who === null ? readInviteToken(roomId) : null;
  // No invite: a judge room lets a bidder in with its room code, so a scanned QR or a typed code works.
  const [openState, setOpenState] = useState<OpenJoinFailure | null>(null);
  const noInvite = who === null && invite === null;
  useEffect(() => {
    if (!noInvite) return undefined;
    let live = true;
    openJoinForRoom(api.apiBase, roomId).then((got) => {
      if (!live) return;
      if (got.ok) {
        const kept = rememberBidderSession(roomId, { token: got.token, bidderId: got.bidderId });
        if (!kept) setNotSaved(true);
        setWho({ token: got.token, bidderId: got.bidderId });
      } else {
        setOpenState(got.reason);
      }
    });
    return () => {
      live = false;
    };
  }, [api, roomId, noInvite]);
  useEffect(() => {
    if (who !== null || invite === null) return;
    setFailed(false);
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
        const kept = rememberBidderSession(roomId, {
          token: got.sessionToken,
          bidderId: got.bidderId,
        });
        if (!kept) setNotSaved(true);
        setWho({ token: got.sessionToken, bidderId: got.bidderId });
      })
      .catch(() => setFailed(true));
  }, [api, roomId, who, invite]);

  if (who === null) {
    if (invite === null) {
      if (openState === null) {
        return (
          <main data-route="register" aria-busy="true">
            <h1 tabIndex={-1}>{t('reg.checkingTitle')}</h1>
            <p role="status">{t('reg.confirming')}</p>
          </main>
        );
      }
      if (openState === 'full' || openState === 'expired') {
        return (
          <main data-route="register">
            <h1 tabIndex={-1}>{t(openState === 'full' ? 'reg.fullTitle' : 'reg.closedTitle')}</h1>
            <p role="alert">{t(openState === 'full' ? 'join.full' : 'join.ended')}</p>
            <p>{t(openState === 'full' ? 'join.fullHelp' : 'join.endedHelp')}</p>
            <a className="ui-link" href={`/r/${encodeURIComponent(roomId)}/bid`}>
              {t('join.watch')}
            </a>
          </main>
        );
      }
      // No invite and the room does not let visitors in with its code: nothing was started, so
      // nothing expired.
      return (
        <main data-route="register">
          <h1 tabIndex={-1}>{t('reg.noInviteTitle')}</h1>
          <TokenHelp roomId={roomId} kind="register" />
        </main>
      );
    }
    return (
      <main data-route="register">
        <h1 tabIndex={-1}>{failed ? t('reg.inviteFailedTitle') : t('reg.step1')}</h1>
        {failed ? (
          <>
            <p role="alert">{t('reg.inviteFailed')}</p>
            <TokenHelp roomId={roomId} kind="register" />
          </>
        ) : (
          <p>{t('reg.confirming')}</p>
        )}
      </main>
    );
  }
  const sessionNotice = notSaved ? <p role="status">{t('reg.sessionNotSaved')}</p> : null;
  const live = liveBase !== undefined;
  if (live && snapshot === null) {
    return (
      <main data-route="register">
        <h1 tabIndex={-1}>{t('reg.step1')}</h1>
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
  if (snapshot !== null && registrationClosed) {
    return (
      <main data-route="register">
        <h1 tabIndex={-1}>{t('reg.closedTitle')}</h1>
        <Approve
          state="idle"
          result={null}
          ceilingCents={0}
          closed
          watchHref={`/r/${encodeURIComponent(roomId)}/screen`}
          onBackToCeiling={() => undefined}
          onRetry={() => undefined}
          onContinue={() => undefined}
        />
      </main>
    );
  }
  if (draft === null || !approving) {
    const presets = snapshot?.config.ceilingPresets;
    const range = ceilingRange(snapshot?.config.reserve, snapshot?.maxCeilingCents, presets);
    return (
      // RegisterScreen renders the page's one main landmark.
      <div data-route="register">
        {sessionNotice}
        <RegisterScreen
          minCents={range.minCents}
          maxCents={range.maxCents}
          {...(presets === undefined
            ? {}
            : {
                presetsCents: presets.filter((p) => p >= range.minCents && p <= range.maxCents),
              })}
          allowCustom
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
    <>
      {sessionNotice}
      <ApproveRoute
        roomId={roomId}
        bidderId={who.bidderId}
        token={who.token}
        api={api}
        ceilingCents={draft.ceilingCents}
        name={draft.name}
        paddle={snapshot?.roster.find((r) => r.bidderId === who.bidderId)?.paddle}
        demo={demoHold}
        onBack={() => setApproving(false)}
      />
    </>
  );
}

function ApproveRoute(props: {
  roomId: string;
  bidderId: string;
  token: string;
  api: Api;
  ceilingCents: number;
  name: string;
  /** The paddle the server assigned, read from the room roster. */
  paddle: number | undefined;
  /** The judge-room demo way: a simulated hold, no PayPal login. */
  demo: boolean;
  onBack: () => void;
}) {
  const { roomId, bidderId, token, api, ceilingCents, name, paddle, demo } = props;
  const port = useMemo(
    () =>
      demo
        ? new SimApprovalAdapter({ apiBase: api.apiBase, token })
        : createApprovalPort(
            api.payments,
            { apiBase: api.apiBase, token },
            { apiBase: api.apiBase, clientId: api.paypalClientId, token },
          ),
    [api, token, demo],
  );
  const approval = useApproval({ port, roomId, bidderId });
  const { start } = approval;
  useEffect(() => {
    // One attempt per mount; the hook de-duplicates a running one.
    void start(ceilingCents, name);
  }, [start, ceilingCents, name]);
  return (
    <main data-route="register">
      <h1 tabIndex={-1}>{t('reg.step1')}</h1>
      <Approve
        state={approval.state}
        result={approval.result}
        ceilingCents={ceilingCents}
        {...(paddle === undefined ? {} : { paddle })}
        onBackToCeiling={props.onBack}
        onRetry={() => void start(ceilingCents, name)}
        onContinue={() => navigate(`/r/${encodeURIComponent(roomId)}/bid`)}
      />
    </main>
  );
}

/** Where a buyer lands after approving on PayPal's own page; finishes the hold once. */
function ReturnRoute({ roomId, api }: { roomId: string; api: Api }) {
  const stored = getBidderSession(roomId);
  const adapter = useMemo(
    () =>
      createReturnAdapter({
        apiBase: api.apiBase,
        clientId: api.paypalClientId,
        token: stored?.token ?? '',
      }),
    [api, stored?.token],
  );
  const bidderOfSession = stored?.bidderId;
  const ceilingCents =
    bidderOfSession === undefined
      ? undefined
      : loadRegistration(roomId, bidderOfSession)?.ceilingCents;
  const missingCeiling = bidderOfSession !== undefined && ceilingCents === undefined;
  useEffect(() => {
    // No ceiling was stored with the registration: start again rather than guess one.
    if (missingCeiling) navigate(`/r/${encodeURIComponent(roomId)}/register`);
  }, [missingCeiling, roomId]);
  if (stored === null || stored.bidderId === undefined) {
    return (
      <main data-route="return">
        <p role="alert">{t('reg.returnLost')}</p>
      </main>
    );
  }
  if (ceilingCents === undefined) {
    return (
      <main data-route="return">
        <p role="status">{t('reg.confirming')}</p>
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
      ceilingCents={ceilingCents}
      onBackToCeiling={() => navigate(`/r/${encodeURIComponent(roomId)}/register`)}
      onContinue={() => navigate(`/r/${encodeURIComponent(roomId)}/bid`)}
    />
  );
}

/** The operator key input, shared by the ops page and the demo launcher. It is never stored. */
function OperatorKeyField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="gv-ops__key">
      {t('ops.keyLabel')}
      <input
        className="gv-ops__input"
        type="password"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
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
    <main data-route="ops" className="gv-ops-page">
      <h1>{t('ops.title')}</h1>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          load();
        }}
      >
        <OperatorKeyField value={key} onChange={setKey} />
        <button type="submit" className="gv-ops__load">
          {t('ops.load')}
        </button>
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

/** Makes a demo room on the server. A demo mode that is off (404) falls back to the scripted demo. */
async function createDemoRoom(apiBase: string, key: string): Promise<DemoLinks> {
  const res = await fetch(`${apiBase}/api/demo/rooms`, {
    method: 'POST',
    headers: { 'x-admin-key': key },
  });
  if (res.status === 404) throw new DemoRoomError('demoOff');
  if (res.status === 401) throw new DemoRoomError('unauthorized');
  if (res.status === 429) throw new DemoRoomError('roomCap');
  if (res.status !== 200) throw new Error('demo room failed');
  const body = (await res.json()) as unknown;
  const auctionId =
    typeof body === 'object' && body !== null ? (body as { auctionId?: unknown }).auctionId : null;
  if (typeof auctionId !== 'string' || auctionId === '') throw new Error('bad demo room');
  return roomLinks(auctionId);
}

function DemoRoute({ api }: { api: Api | undefined }) {
  const [key, setKey] = useState('');
  // Judge rooms need no operator key; the host says whether it offers them. Until it answers,
  // and when it does not, the operator-key demo route is used as before.
  const probe = useMemo(
    () => (api === undefined ? undefined : judgeRoomsAvailable(api.apiBase)),
    [api],
  );
  const [judge, setJudge] = useState(false);
  useEffect(() => {
    let live = true;
    probe?.then((ok) => {
      if (live) setJudge(ok);
    });
    return () => {
      live = false;
    };
  }, [probe]);
  return (
    <>
      {api !== undefined && !judge && <OperatorKeyField value={key} onChange={setKey} />}
      <DemoLauncher
        initialMode={api === undefined ? 'scripted' : 'live'}
        goalField={judge}
        createRoom={async (goalCents) => {
          if (api === undefined) throw new Error('no api');
          return (await probe) === true
            ? createJudgeRoom(api.apiBase, goalCents)
            : createDemoRoom(api.apiBase, key);
        }}
        startScripted={() => roomLinks('demo')}
        openConsole={navigate}
      />
    </>
  );
}

/** The bid, screen, console and receipt routes on a scripted scenario, marked as such. */
function ScriptedRoute({
  match,
  roomId,
  request,
  liveBase,
  attach,
  runKey = 0,
}: {
  match: RouteMatch;
  roomId: string;
  request: ScriptedRequest;
  liveBase: string | undefined;
  /** Scripted demo player: take over the clock of the scenario. */
  attach?: (transport: ScenarioTransport) => void;
  /** Changes to build the room again at `request.at`. */
  runKey?: number;
}) {
  const { name, at } = request;
  const asBidder = match.route.id === 'bid';
  const [loaded, setLoaded] = useState<ScriptedRoom | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    loadScriptedRoom(name, asBidder).then(
      (room) => {
        if (live) setLoaded(room);
      },
      () => {
        if (live) setLoaded(null);
      },
    );
    return () => {
      live = false;
    };
  }, [name, asBidder]);
  const scripted = useMemo(
    () =>
      loaded === undefined || loaded === null
        ? null
        : { room: loaded, at, ...(attach === undefined ? {} : { attach }), runKey },
    [loaded, at, attach, runKey],
  );
  if (loaded === null) return <NotFound />;
  if (scripted === null) return <p role="status">{t('net.resyncing')}</p>;
  return (
    <>
      <Provenance kind="scripted" />
      <LiveRoute
        match={match}
        liveBase={liveBase ?? window.location.origin}
        roomId={roomId}
        token="scripted"
        bidderId={match.route.id === 'bid' ? scripted.room.bidderId : undefined}
        api={undefined}
        scripted={scripted}
      />
    </>
  );
}

/** The big screen on the recorded scenario. The route itself is the in-memory switch: the query flag stays development only. */
const SCRIPTED_SCREEN_MATCH: RouteMatch = {
  route: { id: 'screen', path: '/r/:roomId/screen', titleKey: 'demo.roleScreen' },
  params: { roomId: SCRIPTED_ROOM_ID },
};
const SCRIPTED_BID_MATCH: RouteMatch = {
  route: { id: 'bid', path: '/r/:roomId/bid', titleKey: 'bid.price' },
  params: { roomId: SCRIPTED_ROOM_ID },
};

/**
 * /demo/scripted and /demo/scripted/bid: play the scripted demo in this tab, in every build, with
 * no server connection. A Newsprint strip says it is a recording and links to the live demo.
 */
function InMemoryScriptedDemo({
  liveBase,
  view,
}: {
  liveBase: string | undefined;
  view: 'screen' | 'bid';
}) {
  const playback = useScriptedPlayback();
  const request = useMemo<ScriptedRequest>(
    () => ({ name: DEFAULT_SCENARIO, at: playback.startAt }),
    [playback.startAt],
  );
  return (
    <div className="gv-scripted-frame">
      <div className="gv-scripted-bar" role="region" aria-label={t('scriptedDemo.barLabel')}>
        <p>{t('scriptedDemo.banner')}</p>
        <div className="gv-scripted-bar__links">
          <a className="ui-link" href="/demo">
            {t('scriptedDemo.live')}
          </a>
          <a className="ui-link" href="/try">
            {t('scriptedDemo.judge')}
          </a>
        </div>
      </div>
      <div className="gv-scripted-stage">
        <ScriptedRoute
          match={view === 'bid' ? SCRIPTED_BID_MATCH : SCRIPTED_SCREEN_MATCH}
          roomId={SCRIPTED_ROOM_ID}
          request={request}
          liveBase={liveBase}
          attach={playback.attach}
          runKey={playback.run}
        />
      </div>
      <ScriptedPlayer playback={playback} />
    </div>
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
  const scriptedRequest = readScriptedRequest(window.location.search);
  if (
    scriptedRequest !== null &&
    roomId !== undefined &&
    (id === 'bid' || id === 'screen' || id === 'console' || id === 'receipt')
  ) {
    return (
      <ScriptedRoute match={match} roomId={roomId} request={scriptedRequest} liveBase={liveBase} />
    );
  }
  const who = live && roomId !== undefined ? tokenFor(id, roomId) : null;
  if (id === 'receipt' && roomId !== undefined && api !== undefined) {
    // A share link carries a receipt token in the fragment: it opens one read-only receipt.
    const receiptToken = readReceiptToken(roomId);
    if (receiptToken !== null) {
      return <SharedReceiptRoute apiBase={api.apiBase} roomId={roomId} token={receiptToken} />;
    }
  }
  if (id === 'ops') return <OpsRoute api={api} />;
  if (id === 'landing') return <HomeOrLanding api={api} match={match} />;
  if (id === 'about' && api !== undefined) return <LandingRoute api={api} />;
  if (id === 'demo') return <DemoRoute api={api} />;
  if (id === 'scriptedDemo') return <InMemoryScriptedDemo liveBase={liveBase} view="screen" />;
  if (id === 'scriptedBid') return <InMemoryScriptedDemo liveBase={liveBase} view="bid" />;
  if (id === 'scriptedJoin') return <ScriptedJoin />;
  if (id === 'hub' && roomId !== undefined) {
    return (
      <RoomGate apiBase={api?.apiBase} roomId={roomId} onNavigate={navigate}>
        <JudgeHub
          roomId={roomId}
          keys={readHubKeys(roomId)}
          apiBase={api?.apiBase}
          origin={window.location.origin}
        />
      </RoomGate>
    );
  }
  if (id === 'try') return <TryRoute api={api} />;
  if (id === 'verify') return <VerifyScreen apiBase={api?.apiBase} />;
  if (id === 'notFound') return <NotFound />;
  if (id === 'replay') return <ReplayRoute match={match} />;
  if (id === 'ledger') return <LedgerRoute match={match} />;
  if (id === 'audit' && roomId !== undefined && who === null && !hasReviewerAccess(roomId)) {
    return (
      <RoomGate apiBase={api?.apiBase} roomId={roomId} onNavigate={navigate} onlyNotFound>
        <TokenGate role="reviewer" token={null} roomId={roomId}>
          {null}
        </TokenGate>
      </RoomGate>
    );
  }
  if (
    id === 'console' &&
    liveBase !== undefined &&
    roomId !== undefined &&
    roomId !== 'demo' &&
    who === null &&
    !hasAuctioneerAccess(roomId)
  ) {
    return (
      <RoomGate apiBase={api?.apiBase} roomId={roomId} onNavigate={navigate} onlyNotFound>
        <TokenGate role="auctioneer" token={null} roomId={roomId}>
          {null}
        </TokenGate>
      </RoomGate>
    );
  }
  if (id === 'screen' && liveBase !== undefined && roomId !== undefined && who === null) {
    return (
      <RoomGate apiBase={api?.apiBase} roomId={roomId} onNavigate={navigate} onlyNotFound>
        <TokenGate role="screen" token={null} roomId={roomId}>
          {null}
        </TokenGate>
      </RoomGate>
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
  if (
    (id === 'bid' || id === 'receipt') &&
    who === null &&
    roomId !== undefined &&
    api !== undefined &&
    roomId !== 'demo'
  ) {
    return (
      <RoomGate apiBase={api.apiBase} roomId={roomId} onNavigate={navigate}>
        <WatcherGate roomId={roomId} onNavigate={navigate} apiBase={api.apiBase} />
      </RoomGate>
    );
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

/** Routes that carry the help button: landing, join, registration, bidder room and receipt. */
const HELP_ROUTES: ReadonlySet<string> = new Set([
  'landing',
  'about',
  'join',
  'register',
  'return',
  'bid',
  'receipt',
]);

export function App({ initialPath, gallery = import.meta.env.DEV, liveBase, api }: AppProps) {
  const [path, setPath] = useState(initialPath ?? window.location.pathname);

  // A link pasted into the same tab changes only the fragment (an invite, a token): render again
  // so the page reads it, instead of keeping what the old fragment said.
  const [, setHashSeen] = useState(0);

  useEffect(() => {
    const sync = (): void => setPath(window.location.pathname);
    const fragment = (): void => setHashSeen((n) => n + 1);
    window.addEventListener('popstate', sync);
    window.addEventListener(NAVIGATE_EVENT, sync);
    window.addEventListener('hashchange', fragment);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener(NAVIGATE_EVENT, sync);
      window.removeEventListener('hashchange', fragment);
    };
  }, []);

  const match = matchRoute(path, { gallery });
  useRouteChrome(match);
  return (
    <ErrorBoundary>
      {match.route.id !== 'gallery' && <SkipLink />}
      {match.route.id !== 'gallery' && <SandboxBanner />}
      {match.route.id !== 'gallery' && match.route.id !== 'bid' && <OfflineBanner />}
      {match.route.id !== 'gallery' && <BusyBanner />}
      {match.route.id !== 'gallery' && <Announcer />}
      <HistoryRecorder match={match} />
      <Routed match={match} liveBase={liveBase} api={api} />
      {HELP_ROUTES.has(match.route.id) && <HelpLayer />}
    </ErrorBoundary>
  );
}
