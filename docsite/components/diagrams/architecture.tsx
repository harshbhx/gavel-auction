'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';
import { Chip } from '@/components/holdline/chip';
import { DiagramFrame } from './frame';
import { DetailPanel, useHot } from './interactive';
import { Defs, T, hatch } from './kit';

// System architecture end to end. Every box is a thing that exists in the code on main:
//   packages/server/src/boot/compose.ts   what the host mounts (HTTP routes, /ws, /audio, stores)
//   packages/server/src/host/{node-ws,gateway,audio-ws}.ts   the two sockets (paths /ws and /audio)
//   packages/server/src/voice/stt.ts      chooseStt: Deepgram, then Groq, then cached replay
//   packages/server/src/store/*, packages/payments/src/stores/file.ts   the files on the disk
//   packages/payments/src/{orders,paymentsApi}.ts, webhooks/verify.ts   the PayPal endpoints used
//   render.yaml, docs/DEPLOY.md, .github/workflows/{deploy-staging,deploy-prod,uptime,docsite}.yml

type FlowId = 'all' | 'bid' | 'hold' | 'voice' | 'settle' | 'webhook' | 'deploy';

const FLOWS: Record<
  Exclude<FlowId, 'all'>,
  { label: string; nodes: string[]; edges: string[]; text: ReactNode }
> = {
  bid: {
    label: 'Tap or typed bid',
    nodes: ['web', 'ws', 'room', 'engine', 'disk'],
    edges: ['webws', 'wsroom', 'roomengine', 'disk_room', 'disk_engine'],
    text: (
      <>
        A bid is a bid message on the room socket (<code>packages/shared/src/wire/client.ts</code>). The room asks the engine to
        decide it. The room log holds the event first, and the engine ledger is written before the event is acknowledged
        (<code>packages/server/src/store/file-ledger-store.ts</code>, decisions D-0012 and D-0014).
      </>
    ),
  },
  hold: {
    label: 'Registration and hold',
    nodes: ['web', 'sdk', 'api', 'hold', 'pp', 'disk'],
    edges: ['webapi', 'apihold', 'sdkpp', 'calls', 'disk_hold'],
    text: (
      <>
        The hold routes (<code>/api/holds</code>) call the hold service, which creates an AUTHORIZE order on PayPal. The buyer
        approves in the PayPal popup, which talks to PayPal directly, then the host authorizes the order and stores the hold
        (<code>packages/server/src/http/holds.ts</code>). The gateway given to these routes can create and read orders, authorize and void,
        but not capture.
      </>
    ),
  },
  voice: {
    label: 'Voice bid',
    nodes: ['mic', 'audio', 'stt', 'dg', 'gq', 'room', 'engine'],
    edges: ['micaudio', 'audiostt', 'sttroom', 'dstt', 'roomengine'],
    text: (
      <>
        Audio frames go to the <code>/audio</code> socket. The speech chain turns them into text: Deepgram first, then Groq, then
        cached replay, and with no <code>VOICE_STT</code> set only the cached replay runs. A decision reaches the room through{' '}
        <code>Room.submitVoiceBid</code>, then follows the same engine path as a tap
        (<code>packages/server/src/voice/stt.ts</code>, <code>voice/bridge.ts</code>).
      </>
    ),
  },
  settle: {
    label: 'Settlement',
    nodes: ['room', 'engine', 'saga', 'pp', 'disk'],
    edges: ['roomsaga', 'roomengine', 'calls', 'disk_saga', 'disk_engine'],
    text: (
      <>
        After the hammer the room starts the settlement saga. The hammer is in the engine ledger first, then the saga journal is
        saved, then PayPal is called (capture the winner, void the rest). The saga is the only caller of capture and
        reauthorization (<code>holdRouteGateway</code> in <code>compose.ts</code> refuses both).
      </>
    ),
  },
  webhook: {
    label: 'Webhook',
    nodes: ['pp', 'webhook', 'saga', 'disk'],
    edges: ['ppwh', 'whsaga', 'disk_saga'],
    text: (
      <>
        PayPal posts an event to <code>/webhooks/paypal</code>. The host reads the raw body, asks PayPal to verify the signature,
        stores the event id once and passes the event to the settlement service
        (<code>packages/payments/src/webhooks/handler.ts</code>, <code>verify.ts</code>, <code>http/webhook-guard.ts</code>).
      </>
    ),
  },
  deploy: {
    label: 'Build and deploy',
    nodes: ['gha', 'hook', 'uptime', 'docs', 'cf'],
    edges: ['gha_hook', 'hook_host', 'up_host', 'gha_docs', 'cfweb'],
    text: (
      <>
        GitHub Actions run the checks. A deploy calls the Render deploy hook and then smoke tests the host
        (<code>deploy-staging.yml</code>, <code>deploy-prod.yml</code>); the docs site is built and published from{' '}
        <code>docsite.yml</code>. The uptime workflow probes the host every five minutes once it is switched on.
      </>
    ),
  },
};

const DETAILS: Record<string, ReactNode> = {
  cf: (
    <>
      <b>Static hosting.</b> The web app is built to static files and, per <code>docs/DEPLOY.md</code> step 7, hosted on a Cloudflare Pages project
      with <code>VITE_API_BASE</code> and <code>VITE_WS_BASE</code> pointing at the host. The repository has no workflow that deploys the web app; the
      docs site has one (<code>docsite.yml</code>).
    </>
  ),
  web: (
    <>
      <b>Web app</b> (<code>packages/web</code>, React and Vite). One build serves the bidder screen, the auctioneer console and the audit and replay
      screens. It reads its API and socket origins from <code>VITE_API_BASE</code> and <code>VITE_WS_BASE</code> (<code>src/config.ts</code>).
    </>
  ),
  mic: (
    <>
      <b>Mic capture</b> (<code>packages/web/src/audio</code>, <code>useMic</code>). The console sends audio frames to the host; speech to text happens on the host.
    </>
  ),
  sdk: (
    <>
      <b>PayPal SDK v6</b> (<code>packages/web/src/payments/paypalV6Adapter.ts</code>). The approval popup for an AUTHORIZE order. If the popup is blocked the
      redirect approval is used and the return route completes the hold.
    </>
  ),
  api: (
    <>
      <b>HTTP API.</b> Routes mounted in <code>compose.ts</code>: <code>/api/auctions</code>, invites and join, <code>/api/holds</code>, control and kill,
      snapshot and events, plus <code>/healthz</code>, <code>/readyz</code>, <code>/version</code>, <code>/warmup</code>, metrics and the admin export.
    </>
  ),
  ws: (
    <>
      <b>Room socket</b> at <code>/ws</code> (<code>host/node-ws.ts</code>, <code>host/gateway.ts</code>). It carries join, bid and confirm messages in and
      room events out. Origins must be in <code>CORS_ORIGINS</code> or the public origin; each address gets at most 20 open sockets.
    </>
  ),
  audio: (
    <>
      <b>Voice socket</b> at <code>/audio</code> (<code>host/audio-ws.ts</code>). It shares the same HTTP server and per-address admission as the room socket.
    </>
  ),
  room: (
    <>
      <b>Room runtime</b> (<code>packages/server/src/room</code>, <code>runtime/auction-service.ts</code>). One room per auction. It orders commands, runs the
      confirm gate for voice bids and appends every accepted event to the room log.
    </>
  ),
  stt: (
    <>
      <b>Speech chain</b> (<code>server/src/voice/stt.ts</code>). With <code>VOICE_STT=deepgram</code> and a Groq key the chain is Deepgram, Groq, cached
      replay. Without a live provider name only cached replay runs, so no key is needed to boot.
    </>
  ),
  engine: (
    <>
      <b>Engine</b> (<code>packages/engine</code>). Pure rules (ascending bids, ceilings, soft close) and a hash-chained ledger. The host stores it with{' '}
      <code>FileLedgerStore</code>, one file per auction.
    </>
  ),
  hold: (
    <>
      <b>Hold service</b> (<code>packages/payments/src/holds/service.ts</code>). Creates an AUTHORIZE order, authorizes it after approval and keeps the hold
      record. Behind the kill switch and the audit sink.
    </>
  ),
  saga: (
    <>
      <b>Settlement saga</b> (<code>packages/payments/src/saga</code>). A state machine driven by a runner that saves the journal before each PayPal effect.
      See <a href="/docs/how-it-works/settlement-saga">Settlement saga</a>.
    </>
  ),
  webhook: (
    <>
      <b>Webhook route</b> at <code>/webhooks/paypal</code>. Body size capped at 256 KiB, signature checked by PayPal, event ids stored once
      (<code>http/webhook-guard.ts</code>, <code>webhooks/dedupe.ts</code>). Exempt from the per-address HTTP limit.
    </>
  ),
  disk: (
    <>
      <b>Disk</b> <code>/var/data</code> (1 GB persistent disk in <code>render.yaml</code>). One process owns it, enforced by a data directory lock
      (<code>store/data-dir-lock.ts</code>). Without the disk a redeploy would wipe the room log, ledger, journals and holds.
    </>
  ),
  pp: (
    <>
      <b>PayPal sandbox.</b> Orders v2 (<code>/v2/checkout/orders</code>), Payments v2 (<code>/v2/payments/authorizations</code>) and the webhook verify call
      (<code>/v1/notifications/verify-webhook-signature</code>). Tests use a fake PayPal server instead; the sandbox gates are in <code>docs/GATES.md</code>.
    </>
  ),
  dg: (
    <>
      <b>Deepgram</b>, streaming speech to text over a WebSocket (<code>voice/deepgram-socket.ts</code>). First choice when <code>VOICE_STT=deepgram</code>.
    </>
  ),
  gq: (
    <>
      <b>Groq</b>, speech to text over HTTPS. Second in the chain, or first when it is the named provider.
    </>
  ),
  gha: (
    <>
      <b>GitHub Actions.</b> All builds, tests and gate runs. See <a href="/docs/run/ci-pipeline">CI pipeline</a>.
    </>
  ),
  hook: (
    <>
      <b>Render deploy hook.</b> <code>autoDeploy</code> is off in <code>render.yaml</code>; deploys come from <code>deploy-staging.yml</code> and{' '}
      <code>deploy-prod.yml</code>, which then run <code>scripts/smoke.sh</code>.
    </>
  ),
  uptime: (
    <>
      <b>Uptime probe</b> (<code>uptime.yml</code>). Every five minutes, only when <code>UPTIME_ENABLED</code> is true and <code>PRODUCTION_URL</code> is set.
    </>
  ),
  docs: (
    <>
      <b>Docs site</b> (<code>docsite.yml</code>). A static export published to a Cloudflare Pages project when the two Cloudflare secrets exist.
    </>
  ),
};

type BoxProps = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  sub?: string;
  money?: boolean;
  term?: boolean;
  held?: boolean;
  p: string;
};

type Ctx = { hot: ReturnType<typeof useHot>; sel: (typeof FLOWS)[Exclude<FlowId, 'all'>] | null };
const ViewCtx = createContext<Ctx | null>(null);
function useView(): Ctx {
  const v = useContext(ViewCtx);
  if (v === null) throw new Error('diagram context missing');
  return v;
}

function Box({ id, x, y, w, h, label, sub, money, term, held, p }: BoxProps) {
  const { hot, sel } = useView();
  const on = sel === null || sel.nodes.includes(id);
  return (
    <g {...hot.props(id)} aria-label={label} opacity={on ? 1 : 0.2}>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={2}
        className={term ? 'node-term' : 'node'}
        style={hot.active === id ? { strokeWidth: 3, stroke: 'var(--hl-signal-ink)' } : undefined}
      />
      {money && <rect x={x} y={y} width={w} height={5} className="rule-money" />}
      {held && <rect x={x} y={y} width={w} height={14} fill={hatch(p)} className="fill-hatch-edge" />}
      <text x={x + w / 2} y={y + (sub ? h / 2 + (held ? 4 : 0) : h / 2 + 4.5)} textAnchor="middle" className="t-big" style={{ fontSize: 12.5 }}>
        {label}
      </text>
      {sub && (
        <text x={x + w / 2} y={y + h / 2 + (held ? 18 : 14)} textAnchor="middle" className="t-muted t-small">
          {sub}
        </text>
      )}
    </g>
  );
}

function Edge({ id, d, p, dash, both, noArrow }: { id: string; d: string; p: string; dash?: boolean; both?: boolean; noArrow?: boolean }) {
  const { sel } = useView();
  const on = sel === null || sel.edges.includes(id);
  return (
    <path
      d={d}
      className={dash ? 'edge-dash' : 'edge'}
      markerEnd={noArrow ? undefined : `url(#${p}-arrow)`}
      markerStart={both ? `url(#${p}-arrow)` : undefined}
      opacity={on ? 1 : 0.15}
      style={sel !== null && sel.edges.includes(id) ? { strokeWidth: 2.5 } : undefined}
    />
  );
}

function Chip2({ x, y, w, label, sub, p }: { x: number; y: number; w: number; label: string; sub?: string; p: string }) {
  const { sel } = useView();
  const on = sel === null || sel.nodes.includes('disk');
  return (
    <g opacity={on ? 1 : 0.2}>
      <rect x={x} y={y} width={w} height={sub ? 40 : 34} rx={2} className="node" />
      <rect x={x} y={y} width={5} height={sub ? 40 : 34} fill={hatch(p)} />
      <text x={x + 12} y={y + 16} className="t-small" style={{ fontWeight: 700 }}>
        {label}
      </text>
      {sub && (
        <text x={x + 12} y={y + 31} className="t-small t-muted">
          {sub}
        </text>
      )}
    </g>
  );
}

export function ArchitectureDiagram() {
  const hot = useHot();
  const [flow, setFlow] = useState<FlowId>('all');
  const sel = flow === 'all' ? null : FLOWS[flow];
  const nodeOn = (id: string) => sel === null || sel.nodes.includes(id);

  const toolbar = (
    <div>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Highlight one path through the system">
        {(['all', ...Object.keys(FLOWS)] as FlowId[]).map((id) => (
          <button
            key={id}
            type="button"
            aria-pressed={flow === id}
            onClick={() => setFlow(id)}
            className={`rounded-[2px] border px-2 py-1 font-mono text-[0.68rem] font-bold uppercase hover:bg-fd-accent ${
              flow === id ? 'bg-[var(--hl-signal)] text-[var(--hl-on-signal)]' : ''
            }`}
          >
            {id === 'all' ? 'Everything' : FLOWS[id].label}
          </button>
        ))}
      </div>
      <p className="mt-2 min-h-[3.5rem]" aria-live="polite">
        {sel !== null ? sel.text : <span className="text-fd-muted-foreground">Pick a path to light up the boxes and arrows it uses.</span>}
      </p>
      <DetailPanel active={hot.active} details={DETAILS} hint="Hover, focus or tap a box for what it does and which file implements it." />
    </div>
  );

  return (
    <DiagramFrame
      title="System architecture, end to end"
      desc="Three bands. At the top, the browser: a static web app, microphone capture and the PayPal approval popup. In the middle, the Render host, one Node process with an HTTP API, a room socket, a voice socket, the room runtime, the engine, the hold service, the settlement saga, the webhook route and a disk with the room log, engine ledgers, payment journals, holds, webhook ids, audit log and kill switch. On the right, outside services: Deepgram and Groq for speech and the PayPal sandbox. At the bottom, GitHub Actions, the Render deploy hook, the uptime probe and the docs site build."
      width={1200}
      height={870}
      badge={<Chip kind="sandbox">Sandbox PayPal only</Chip>}
      toolbar={toolbar}
      caption={
        <>
          Verified against <code>packages/server/src/boot/compose.ts</code>, <code>host/node-ws.ts</code>, <code>host/audio-ws.ts</code>,{' '}
          <code>voice/stt.ts</code>, <code>render.yaml</code>, <code>docs/DEPLOY.md</code> and the workflows named in the boxes. The whole chain has been run
          against the fake PayPal; the PayPal sandbox gates in <code>docs/GATES.md</code> cover single calls, not a complete auction. The web
          hosting box follows <code>docs/DEPLOY.md</code>; the repository has no workflow that deploys the web app.
        </>
      }
      transcript={
        <>
          <p>Reading order, top to bottom.</p>
          <ol>
            <li>Browser: the web app talks to the host over HTTPS and the room socket, the microphone sends frames to the voice socket, and the PayPal popup talks to PayPal directly.</li>
            <li>Host: the HTTP API and the room socket both feed the room runtime. The voice socket feeds the speech chain, which hands a decision to the room. The room asks the engine to decide each bid and starts the settlement saga after the hammer.</li>
            <li>The hold service (called by the HTTP API) and the settlement saga make the money calls. The webhook route also asks PayPal to check each signature, and PayPal sends events back to it, which feed the saga.</li>
            <li>Disk: room log, engine ledgers, saga journals, hold records, webhook ids, the payment audit log and the kill switch file. With STORE=postgres the room log and journals move to Postgres.</li>
            <li>Outside: Deepgram, Groq and the PayPal sandbox.</li>
            <li>Build and operate: GitHub Actions, the Render deploy hook, the uptime probe and the docs site build.</li>
          </ol>
        </>
      }
      render={(p) => (
        <ViewCtx.Provider value={{ hot, sel }}>
          <Defs p={p} />
          <rect x={0} y={0} width={1200} height={870} style={{ fill: 'var(--hl-bg)' }} />

          {/* zones */}
          <rect x={16} y={48} width={1168} height={104} className="panel" />
          <T x={28} y={66} cls="t-small t-ink">BROWSER</T>
          <rect x={16} y={200} width={930} height={500} className="panel" />
          <T x={28} y={218} cls="t-small t-ink">RENDER WEB SERVICE gavel-host: ONE NODE PROCESS, ONE INSTANCE</T>
          <rect x={966} y={200} width={218} height={500} className="panel" />
          <T x={978} y={218} cls="t-small t-ink">OUTSIDE SERVICES</T>
          <rect x={16} y={716} width={1168} height={134} className="panel" />
          <T x={28} y={734} cls="t-small t-ink">BUILD AND OPERATE</T>

          {/* edges first, boxes on top */}
          <Edge id="cfweb" p={p} d="M210 112 H250" />
          <Edge id="webapi" p={p} d="M300 140 V244" />
          <T x={306} y={198} cls="t-small t-muted">HTTPS</T>
          <Edge id="webws" p={p} d="M520 140 V244" both />
          <T x={526} y={198} cls="t-small t-muted">wss /ws</T>
          <Edge id="micaudio" p={p} d="M700 140 V244" />
          <T x={706} y={198} cls="t-small t-muted">wss /audio, audio frames</T>
          <Edge id="sdkpp" p={p} d="M1000 140 V450" />
          <T x={1008} y={176} cls="t-small t-muted">approval popup,</T>
          <T x={1008} y={190} cls="t-small t-muted">direct to PayPal</T>

          <Edge id="apiroom" p={p} d="M300 300 V344" />
          <Edge id="wsroom" p={p} d="M520 300 V344" both />
          <Edge id="audiostt" p={p} d="M715 300 V344" />
          <Edge id="sttroom" p={p} d="M630 376 H590" />
          <T x={610} y={368} anchor="middle" cls="t-small t-muted">bid</T>
          <Edge id="roomengine" p={p} d="M480 408 V452" />
          <T x={486} y={436} cls="t-small t-muted">decide</T>
          <Edge id="roomsaga" p={p} d="M580 408 V452" />
          <T x={586} y={424} cls="t-small t-muted">settle</T>
          <Edge id="apihold" p={p} d="M250 272 H232 V484 H250" />
          <Edge id="whsaga" p={p} d="M800 484 H770" />
          <Edge id="ppwh" p={p} d="M986 484 H930" />
          <T x={958} y={476} anchor="middle" cls="t-small t-muted">event</T>
          <Edge id="calls" p={p} d="M325 516 V530 H986" />
          <Edge id="calls" p={p} d="M670 516 V530" noArrow />
          <T x={800} y={525} cls="t-small t-muted">calls to PayPal</T>
          <Edge id="dstt" p={p} d="M800 355 H1050" />
          <Edge id="dstt" p={p} d="M800 407 H1050" />

          <Edge id="disk_hold" p={p} d="M270 516 V570" dash />
          <Edge id="disk_engine" p={p} d="M500 516 V570" dash />
          <Edge id="disk_saga" p={p} d="M740 516 V570" dash />
          <Edge id="disk_room" p={p} d="M410 408 V570" dash />
          <T x={414} y={446} cls="t-small t-muted">room log</T>

          <Edge id="gha_hook" p={p} d="M240 784 H300" />
          <Edge id="hook_host" p={p} d="M410 756 V702" />
          <Edge id="up_host" p={p} d="M690 756 V702" />
          <Edge id="gha_docs" p={p} d="M140 812 V836 H1000 V812" />
          <T x={520} y={832} cls="t-small t-muted">build and publish the docs site</T>

          {/* browser */}
          <Box p={p} id="cf" x={40} y={84} w={170} h={56} label="Static hosting" sub="Cloudflare Pages" term />
          <Box p={p} id="web" x={250} y={84} w={330} h={56} label="Web app" sub="bidder, auctioneer console, audit" />
          <Box p={p} id="mic" x={620} y={84} w={170} h={56} label="Mic capture" sub="audio frames" />
          <Box p={p} id="sdk" x={830} y={84} w={200} h={56} label="PayPal SDK v6" sub="approval popup" money />

          {/* host */}
          <Box p={p} id="api" x={250} y={244} w={170} h={56} label="HTTP API" sub="/api/*, /healthz" />
          <Box p={p} id="ws" x={450} y={244} w={140} h={56} label="Room socket" sub="/ws" />
          <Box p={p} id="audio" x={630} y={244} w={170} h={56} label="Voice socket" sub="/audio" />
          <Box p={p} id="room" x={250} y={344} w={340} h={64} label="Room runtime" sub="rooms, confirm gate, mailbox" />
          <Box p={p} id="stt" x={630} y={344} w={170} h={80} label="Speech chain" sub="Deepgram, Groq, cached" />
          <Box p={p} id="hold" x={250} y={452} w={150} h={64} label="Hold service" sub="orders, authorize" money />
          <Box p={p} id="engine" x={420} y={452} w={130} h={64} label="Engine" sub="rules, ledger" />
          <Box p={p} id="saga" x={570} y={452} w={200} h={64} label="Settlement saga" sub="journal, capture, void" money />
          <Box p={p} id="webhook" x={800} y={452} w={130} h={64} label="Webhook route" sub="/webhooks/paypal" money />

          {/* disk */}
          <g opacity={nodeOn('disk') ? 1 : 0.2} {...hot.props('disk')} aria-label="Disk">
            <rect
              x={250}
              y={570}
              width={680}
              height={116}
              rx={2}
              className="node"
              style={hot.active === 'disk' ? { strokeWidth: 3, stroke: 'var(--hl-signal-ink)' } : undefined}
            />
            <T x={262} y={588} cls="t-small t-ink">DISK /var/data, STORE=file (1 GB, one owner)</T>
          </g>
          <Chip2 p={p} x={262} y={600} w={124} label="rooms.jsonl" sub="room log" />
          <Chip2 p={p} x={396} y={600} w={124} label="ledgers/" sub="engine ledger" />
          <Chip2 p={p} x={530} y={600} w={124} label="journals.json" sub="saga journals" />
          <Chip2 p={p} x={664} y={600} w={124} label="holds.json" sub="hold records" />
          <Chip2 p={p} x={798} y={600} w={124} label="webhooks.json" sub="seen event ids" />
          <Chip2 p={p} x={262} y={648} w={166} label="payment-audit.jsonl" />
          <Chip2 p={p} x={438} y={648} w={146} label="kill-switch.json" />
          <T x={598} y={669} cls="t-small t-muted">STORE=postgres: room log and journals in Postgres</T>

          {/* outside */}
          <Box p={p} id="dg" x={1050} y={336} w={118} h={38} label="Deepgram" />
          <Box p={p} id="gq" x={1050} y={388} w={118} h={38} label="Groq" />
          <Box p={p} id="pp" x={986} y={450} w={178} h={130} label="PayPal sandbox" sub="orders, payments, webhooks" held />

          {/* build and operate */}
          <Box p={p} id="gha" x={40} y={756} w={200} h={56} label="GitHub Actions" sub="ci, nightly, gates" />
          <Box p={p} id="hook" x={300} y={756} w={220} h={56} label="Render deploy hook" sub="staging, production" />
          <Box p={p} id="uptime" x={580} y={756} w={220} h={56} label="Uptime probe" sub="/healthz /readyz /warmup" />
          <Box p={p} id="docs" x={860} y={756} w={280} h={56} label="Docs site" sub="docsite.yml, Cloudflare Pages" />

          <T x={16} y={32} cls="t-small t-muted">Brass rule on top: a part that calls PayPal. Hatched: held, sandbox only. Dashed line: written to disk.</T>
        </ViewCtx.Provider>
      )}
    />
  );
}
