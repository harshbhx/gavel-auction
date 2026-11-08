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
import { createJudgeRoom, judgeRoomsAvailable, judgeRoomsStatus } from './net/judgeRooms';
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
import { loadRegistration } from './payments/registrationStore';
import { createApprovalPort, createReturnAdapter, useApproval } from './payments/useApproval';
import { HelpLayer } from './help';
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
import { JudgePanel, type RoomsState } from './screens/try/JudgePanel';
import { fetchOpsSummary, OpsView, type OpsSummaryView } from './ops/OpsView';
import { DemoLauncher, DemoRoomError, type DemoLinks } from './screens/demo/DemoLauncher';
import { ScriptedJoin } from './screens/demo/ScriptedJoin';
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
import { ScreenView } from './screens/screen/ScreenView';
import { ErrorBoundary } from './screens/states/ErrorBoundary';
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

const ReplayScreen = lazy(() => import('./screens/replay/ReplayScreen'));

const NAVIGATE_EVENT = 'gavel:navigate';

/** Client-side navigation: updates the address bar and tells the app to re-match the route. */
export function navigate(to: string): void {
  window.history.pushState(null, '', to);
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
}

/** Which stored slot a refused token is cleared from; the screen token is never stored. */
function roleOf(routeId: string): SessionRole {
  return routeId === 'screen' ? 'screen' : 'bidder';
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
    const started = startLiveRoom({
      wsBase: liveBase,
      roomId: scripted === null ? roomId : scripted.room.roomId,
      token,
      transport,
      ...(bidderId === undefined ? {} : { bidderId }),
    });
    if (scripted !== null && scriptedTransport !== null) {
      if (scripted.at === null) scriptedTransport.autoplay();
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
  const lastError = useRoom((s) => s.lastError);
  const refused = lastError !== null && isHaltingError(lastError.code) ? lastError : null;
  const dead = refused !== null && isTerminalError(refused.code);
  const role = roleOf(match.route.id);
  useEffect(() => {
    // A refused token is dead: forget it, so a reload does not reuse it.
    if (!dead) return;
    clearSession(roomId, undefined, role);
    if (role === 'bidder') clearBidderSession(roomId);
  }, [dead, roomId, role]);
  const myPaddle = useRoom((s) =>
    bidderId === undefined
      ? undefined
      : s.snapshot?.roster.find((r) => r.bidderId === bidderId)?.paddle,
  );
  const stopped = useRoom((s) => s.snapshot?.stopped ?? false);
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
            onReplace={(amount) => {
              // The price moved past the unanswered bid: drop it and bid the current minimum.
              if (view.unknownMid !== null) room?.pending.cancel(view.unknownMid);
              room?.bid(Cents(amount), 'qr');
            }}
            stopped={stopped}
            {...(myPaddle === undefined ? {} : { myPaddle, onConfirm: respond })}
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
            <a className="ui-link gv-hub-back" href={hubHref(roomId, token)}>
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

export function ReceiptRoute({ roomId, share }: { roomId: string; share?: MintReceiptLink }) {
  const state = useRoom((s) => s);
  return <ReceiptView state={state} roomId={roomId} {...(share === undefined ? {} : { share })} />;
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
      onScripted={() => navigate(SCRIPTED_DEMO_PATH)}
      onJudges={() => navigate('/try')}
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
  } catch {
    return false;
  }
  navigate(`/join/${encodeURIComponent(id)}`);
  return true;
}

/** The judge panel: asks the host about live rooms and starts one without an operator key. */
function TryRoute({ api }: { api: Api | undefined }) {
  const [rooms, setRooms] = useState<RoomsState>(api === undefined ? 'noServer' : 'checking');
  useEffect(() => {
    if (api === undefined) return undefined;
    let live = true;
    judgeRoomsStatus(api.apiBase).then((next) => {
      if (live) setRooms(next);
    });
    return () => {
      live = false;
    };
  }, [api]);
  return (
    <JudgePanel
      rooms={rooms}
      createRoom={async () => {
        if (api === undefined) throw new Error('no api');
        return createJudgeRoom(api.apiBase);
      }}
      openRoom={navigate}
      joinByCode={(code) => joinByCode(api, code)}
    />
  );
}

function JoinRoute({ roomId, api }: { roomId: string; api: Api | undefined }) {
  const [found, setFound] = useState<{
    state: JoinState;
    title: string | null;
    id: string;
    code: string | null;
  }>({
    state: api === undefined ? 'open' : 'loading',
    title: api === undefined ? roomId : null,
    id: roomId,
    code: null,
  });
  useEffect(() => {
    if (api === undefined) return undefined;
    let live = true;
    fetchJson(`${api.apiBase}/api/auctions/${encodeURIComponent(roomId)}`)
      .then((body) => {
        if (!live) return;
        const info = body as {
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
        });
      })
      .catch(() => {
        if (live) setFound({ state: 'notFound', title: null, id: roomId, code: null });
      });
    return () => {
      live = false;
    };
  }, [api, roomId]);
  return (
    <JoinScreen
      roomId={found.id}
      roomName={found.title}
      shortCode={found.code}
      state={found.state}
      origin={window.location.origin}
      onNavigate={navigate}
    />
  );
}

const CEILING_MIN_CENTS = 10000;
const CEILING_MAX_CENTS = 100000;

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
    const stored = getBidderSession(roomId);
    return stored?.bidderId === undefined
      ? null
      : { token: stored.token, bidderId: stored.bidderId };
  });
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

  const invite = who === null ? readInviteToken(roomId) : null;
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
    return (
      <main data-route="register">
        {failed || invite === null ? (
          <>
            <p role="alert">{t('reg.expired')}</p>
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
    return (
      // RegisterScreen renders the page's one main landmark.
      <div data-route="register">
        {sessionNotice}
        <RegisterScreen
          minCents={presets === undefined ? CEILING_MIN_CENTS : Math.min(...presets)}
          maxCents={presets === undefined ? CEILING_MAX_CENTS : Math.max(...presets)}
          {...(presets === undefined ? {} : { presetsCents: presets })}
          allowCustom={presets === undefined}
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
  onBack: () => void;
}) {
  const { roomId, bidderId, token, api, ceilingCents, name, paddle } = props;
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
    void start(ceilingCents, name);
  }, [start, ceilingCents, name]);
  return (
    <main data-route="register">
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
        <p role="alert">{t('reg.expired')}</p>
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
    <label>
      {t('ops.keyLabel')}
      <input
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
    <main data-route="ops">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          load();
        }}
      >
        <OperatorKeyField value={key} onChange={setKey} />
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
        createRoom={async () => {
          if (api === undefined) throw new Error('no api');
          return (await probe) === true
            ? createJudgeRoom(api.apiBase)
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
}: {
  match: RouteMatch;
  roomId: string;
  request: ScriptedRequest;
  liveBase: string | undefined;
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
    () => (loaded === undefined || loaded === null ? null : { room: loaded, at }),
    [loaded, at],
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
const SCRIPTED_REQUEST: ScriptedRequest = { name: DEFAULT_SCENARIO, at: null };

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
  return (
    <div className="gv-scripted-frame">
      <div className="gv-scripted-bar">
        <p>{t('scriptedDemo.banner')}</p>
        <a className="ui-link" href="/demo">
          {t('scriptedDemo.live')}
        </a>
      </div>
      <ScriptedRoute
        match={view === 'bid' ? SCRIPTED_BID_MATCH : SCRIPTED_SCREEN_MATCH}
        roomId={SCRIPTED_ROOM_ID}
        request={SCRIPTED_REQUEST}
        liveBase={liveBase}
      />
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
  if (id === 'landing' && api !== undefined) return <LandingRoute api={api} />;
  if (id === 'demo') return <DemoRoute api={api} />;
  if (id === 'scriptedDemo') return <InMemoryScriptedDemo liveBase={liveBase} view="screen" />;
  if (id === 'scriptedBid') return <InMemoryScriptedDemo liveBase={liveBase} view="bid" />;
  if (id === 'scriptedJoin') return <ScriptedJoin />;
  if (id === 'hub' && roomId !== undefined) {
    return (
      <JudgeHub
        roomId={roomId}
        keys={readHubKeys(roomId)}
        apiBase={api?.apiBase}
        origin={window.location.origin}
      />
    );
  }
  if (id === 'try') return <TryRoute api={api} />;
  if (id === 'notFound') return <NotFound />;
  if (id === 'replay') return <ReplayRoute match={match} />;
  if (id === 'audit' && roomId !== undefined && who === null && !hasReviewerAccess(roomId)) {
    return (
      <TokenGate role="reviewer" token={null} roomId={roomId}>
        {null}
      </TokenGate>
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
      <TokenGate role="auctioneer" token={null} roomId={roomId}>
        {null}
      </TokenGate>
    );
  }
  if (id === 'screen' && liveBase !== undefined && roomId !== undefined && who === null) {
    return (
      <TokenGate role="screen" token={null} roomId={roomId}>
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

/** Routes that carry the help button: landing, join, registration, bidder room and receipt. */
const HELP_ROUTES: ReadonlySet<string> = new Set([
  'landing',
  'join',
  'register',
  'return',
  'bid',
  'receipt',
]);

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
      {match.route.id !== 'gallery' && <SandboxBanner />}
      {match.route.id !== 'gallery' && <Announcer />}
      <Routed match={match} liveBase={liveBase} api={api} />
      {HELP_ROUTES.has(match.route.id) && <HelpLayer />}
    </ErrorBoundary>
  );
}
