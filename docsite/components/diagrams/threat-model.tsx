'use client';

import { useState, type ReactNode } from 'react';
import { Chip } from '@/components/holdline/chip';
import { DiagramFrame } from './frame';
import { DetailPanel, useHot } from './interactive';
import { Defs, T } from './kit';

// D16. Threat model: trust boundaries and what each secret does. Names only, never values.
// Read from:
//   packages/server/src/auth/token.ts       HMAC-SHA256 token, kinds and lifetimes, audience, revocation
//   packages/server/src/auth/rotation.ts    TOKEN_SECRET and TOKEN_SECRET_PREVIOUS
//   packages/server/src/http/ops.ts         x-admin-key, constant-time check, ops routes
//   packages/server/src/http/auctions.ts    POST /api/auctions needs the admin key
//   packages/server/src/http/auctioneer-token.ts  rotate and revoke need the admin key
//   packages/server/src/config.ts           secret length rules, sandbox-only and production rules
//   packages/server/src/http/security-headers.ts, http/webhook-guard.ts (256 KiB body cap)
//   packages/server/src/host/audio-ws.ts    token in the first audio message, within 5 s
//   packages/server/src/auth/authorize.ts   role table and per-viewer redaction
//   packages/payments/src/guard.ts          sandbox host only; webhooks/verify.ts certificate host
//   packages/voice/src/privacy.ts           audio notice; render.yaml (names and sync: false)

type Lens = 'all' | 'TOKEN_SECRET' | 'ADMIN_KEY' | 'PayPal keys' | 'Speech keys';
const LENSES: Lens[] = ['all', 'TOKEN_SECRET', 'ADMIN_KEY', 'PayPal keys', 'Speech keys'];

type Item = { id: string; title: string; lens: Lens[]; detail: ReactNode };

const items: Item[] = [
  {
    id: 'bidder',
    title: 'Bidder browser',
    lens: ['TOKEN_SECRET'],
    detail: (
      <>
        Joins with an invite token (24 h, single use) and then a session token (4 h). It sees its own ceiling and nobody else&apos;s: <code>redactForViewer</code> in{' '}
        <code>auth/authorize.ts</code> drops any ceiling that does not name the viewer.
      </>
    ),
  },
  {
    id: 'auctioneer',
    title: 'Auctioneer browser',
    lens: ['TOKEN_SECRET'],
    detail: (
      <>
        Holds an auctioneer token (12 h). It can control the auction and enter bids for bidders. It cannot create auctions or mint a successor link: both need the admin key
        (<code>http/auctions.ts</code>, <code>http/auctioneer-token.ts</code>).
      </>
    ),
  },
  {
    id: 'screen',
    title: 'Screen display',
    lens: ['TOKEN_SECRET'],
    detail: 'Holds a screen token (12 h). A screen never receives ceilings or per-bidder frames, and sees public audit rows only.',
  },
  {
    id: 'operator',
    title: 'Operator',
    lens: ['ADMIN_KEY'],
    detail: (
      <>
        Sends the key in the <code>x-admin-key</code> header. With it: create an auction, rotate or revoke auctioneer links, list rooms, void all holds or release a review
        (<code>/ops/...</code>), read metrics, export the ledger and replay bundle. This is the most powerful secret.
      </>
    ),
  },
  {
    id: 'stranger',
    title: 'Stranger with a link',
    lens: ['TOKEN_SECRET'],
    detail: (
      <>
        A token for another auction, an expired, revoked or edited one, or the wrong kind is refused (<code>verifyToken</code> returns unauthorized). An invite that was already used
        answers invite_used. A leaked auctioneer link is killed by the rotate endpoint, which raises a per-auction floor.
      </>
    ),
  },
  {
    id: 'gate',
    title: 'Edge checks',
    lens: ['TOKEN_SECRET', 'ADMIN_KEY'],
    detail: (
      <>
        Origin allowlist (<code>PUBLIC_URL</code> plus <code>CORS_ORIGINS</code>) on HTTP and both sockets, per-source rate limits (<code>RATE_*</code>, behind <code>TRUSTED_PROXY_HOPS</code>), body size caps and
        baseline headers: CSP <code>default-src &apos;none&apos;</code>, HSTS, nosniff, no referrer (<code>http/security-headers.ts</code>).
      </>
    ),
  },
  {
    id: 'tokenDoor',
    title: 'Token door',
    lens: ['TOKEN_SECRET'],
    detail: (
      <>
        A token is <code>payload.signature</code>, HMAC-SHA256 with <code>TOKEN_SECRET</code>. The server checks the signature in constant time, then audience, lifetime, kind, identity binding and the revocation list.
        During a rotation <code>TOKEN_SECRET_PREVIOUS</code> is accepted until <code>TOKEN_SECRET_PREVIOUS_UNTIL</code>. A secret under 32 bytes stops a production boot.
      </>
    ),
  },
  {
    id: 'audioDoor',
    title: 'Audio door',
    lens: ['TOKEN_SECRET', 'Speech keys'],
    detail: 'The /audio socket takes the auctioneer token as its first message within 5 seconds, never in the URL, then enforces rate, size and duration limits. Audio before auth closes the socket with 4401.',
  },
  {
    id: 'adminDoor',
    title: 'Admin door',
    lens: ['ADMIN_KEY'],
    detail: (
      <>
        The header value and <code>ADMIN_KEY</code> are hashed with SHA-256 and compared with <code>timingSafeEqual</code> (<code>http/ops.ts</code>). In production the key must be at least 24
        characters and must differ from <code>TOKEN_SECRET</code> (<code>config.ts</code>).
      </>
    ),
  },
  {
    id: 'webhookDoor',
    title: 'Webhook door',
    lens: ['PayPal keys'],
    detail: (
      <>
        The raw body is verified before anything is read from it, through PayPal&apos;s own verification endpoint with <code>PAYPAL_WEBHOOK_ID</code> (G4 PASS on real events; tampered-event rejection is covered against
        the fake only). The certificate URL host must be paypal.com or a subdomain. Bodies over 256 KiB are refused and only an event id and an outcome are logged.
      </>
    ),
  },
  {
    id: 'inside',
    title: 'Inside the host',
    lens: [],
    detail: 'One Node process. Nothing here runs before a door check has passed. The engine still validates every bid, whoever sent it.',
  },
  {
    id: 'room',
    title: 'Room, engine, ledger',
    lens: ['TOKEN_SECRET', 'ADMIN_KEY'],
    detail: 'The engine accepts or rejects every bid and appends it to the hash-chained ledger. A role table (auth/authorize.ts) lists which role may do which operation; anything not listed is denied.',
  },
  {
    id: 'payments',
    title: 'Payments',
    lens: ['PayPal keys', 'ADMIN_KEY'],
    detail: (
      <>
        Holds, settlement saga and journals. Only the sandbox API host over https is allowed (<code>payments/src/guard.ts</code>), <code>PAYPAL_ENV</code> must be sandbox, and fake payments are refused in a production-like
        setting. The admin key can void all holds or release a review through <code>/ops</code>; the audit row names the actor admin.
      </>
    ),
  },
  {
    id: 'bridge',
    title: 'Voice bridge',
    lens: ['Speech keys', 'TOKEN_SECRET'],
    detail: 'Turns speech into bids that still go through the room gate and the engine. The bidder comes from the paddle that was heard, never from the token. Drop records leave the transcript out.',
  },
  {
    id: 'storage',
    title: 'Storage',
    lens: [],
    detail: (
      <>
        Room log, ledger and settlement journals in files on a persistent disk (<code>/var/data</code> in <code>render.yaml</code>) or in Postgres through <code>DATABASE_URL</code>. The memory store is refused in production unless
        explicitly allowed.
      </>
    ),
  },
  {
    id: 'paypal',
    title: 'PayPal sandbox',
    lens: ['PayPal keys'],
    detail: (
      <>
        Reached with OAuth client credentials (<code>PAYPAL_CLIENT_ID</code>, <code>PAYPAL_CLIENT_SECRET</code>) and nothing else. It sends signed webhook events back. The host name is fixed to api-m.sandbox.paypal.com; a CI check fails the
        build if source names the live host.
      </>
    ),
  },
  {
    id: 'stt',
    title: 'Speech providers',
    lens: ['Speech keys'],
    detail: (
      <>
        Audio leaves the host only when <code>VOICE_STT</code> names Deepgram or Groq and its key (<code>DEEPGRAM_API_KEY</code>, <code>GROQ_API_KEY</code>) is set. The default build plays cached transcripts and sends nothing. The
        product tells people: &quot;Audio is sent to a speech service to read bids. Do not speak personal data.&quot;
      </>
    ),
  },
  {
    id: 'ci',
    title: 'GitHub Actions',
    lens: ['PayPal keys'],
    detail: (
      <>
        Gate and nightly workflows read the sandbox app and buyer secrets from repository secrets (names such as <code>PAYPAL_CLIENT_ID</code>, <code>SANDBOX_BUYER</code>); values are masked in logs and never recorded. The gate
        workflows run in the <code>sandbox-nightly</code> environment and only from main.
      </>
    ),
  },
];

const byId = Object.fromEntries(items.map((i) => [i.id, i]));
const details = Object.fromEntries(items.map((i) => [i.id, <span key={i.id}><strong>{i.title}.</strong> {i.detail}</span>]));

const lensText: Record<Lens, ReactNode> = {
  all: 'Everything on the map. Pick a secret to see only what it protects.',
  TOKEN_SECRET: 'TOKEN_SECRET signs every bidder, auctioneer and screen token. Whoever knows it can mint any token for any auction. It never leaves the host.',
  ADMIN_KEY: 'ADMIN_KEY is a password for the operator. It creates auctions, rotates links, voids holds and exports data. It is not a token and is checked on its own.',
  'PayPal keys': 'PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET let the host call the PayPal sandbox; PAYPAL_WEBHOOK_ID lets it check that a webhook really came from PayPal.',
  'Speech keys': 'DEEPGRAM_API_KEY and GROQ_API_KEY let the host send audio to a speech service. Without them the default build sends no audio anywhere.',
};

const BOX_H = 56;

function Box({
  id,
  x,
  y,
  w,
  h = BOX_H,
  sub,
  kind = 'node',
  lens,
  hot,
}: {
  id: string;
  x: number;
  y: number;
  w: number;
  h?: number;
  sub?: string;
  kind?: 'node' | 'stop' | 'term';
  lens: Lens;
  hot: ReturnType<typeof useHot>;
}) {
  const it = byId[id];
  if (!it) return null;
  const active = hot.active === id;
  const opacity = lens === 'all' || it.lens.includes(lens) ? 1 : 0.18;
  return (
    <g {...hot.props(id)} aria-label={it.title} style={{ opacity, cursor: 'pointer', outline: 'none' }}>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={2}
        className={kind === 'stop' ? 'node-stop' : kind === 'term' ? 'node-term' : 'node'}
        style={{ strokeWidth: active ? 3 : undefined }}
      />
      <text x={x + w / 2} y={y + (sub ? h / 2 - 2 : h / 2 + 4.5)} textAnchor="middle" className="t-big" style={{ fontSize: 12.5 }}>
        {it.title}
      </text>
      {sub && (
        <text x={x + w / 2} y={y + h / 2 + 13} textAnchor="middle" className="t-muted t-small">
          {sub}
        </text>
      )}
    </g>
  );
}

export function ThreatModelDiagram() {
  const hot = useHot();
  const [lens, setLens] = useState<Lens>('all');

  const lensOp = (...l: Lens[]) => (lens === 'all' || l.includes(lens) ? 1 : 0.18);

  const btn =
    'rounded-[2px] border px-2 py-1 font-mono text-[0.68rem] font-bold aria-pressed:bg-fd-accent aria-pressed:border-[var(--hl-fg)] hover:bg-fd-accent';

  return (
    <DiagramFrame
      title="Threat model: trust boundaries and secrets"
      desc="Three zones. Left: browsers and an operator, outside the host. Middle: the GAVEL host, a single process. Edge checks come first, then four doors: token, audio, admin and webhook. Behind the doors sit the room, engine and ledger, the payments saga and the voice bridge, then storage. Right: the PayPal sandbox, the speech providers and GitHub Actions. Each arrow that crosses a boundary names the credential it carries: a signed token, the admin key, PayPal OAuth keys, a signed webhook event or a speech API key. A stranger with a bad link is refused at the door."
      width={1200}
      height={560}
      badge={<Chip kind="sandbox">Sandbox only</Chip>}
      toolbar={
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Show one secret">
            <span className="font-mono text-[0.68rem] uppercase text-fd-muted-foreground">Show secret:</span>
            {LENSES.map((l) => (
              <button key={l} type="button" className={btn} aria-pressed={lens === l} onClick={() => setLens(l)}>
                {l}
              </button>
            ))}
          </div>
          <p aria-live="polite">{lensText[lens]}</p>
          <DetailPanel active={hot.active} details={details} hint="Hover, focus or tap a box for what it checks and which file does it. Only secret names appear here, never values." />
        </div>
      }
      caption={
        <>
          Read from <code>packages/server/src/auth</code> (token.ts, rotation.ts, authorize.ts), <code>packages/server/src/http/ops.ts</code>, <code>http/auctions.ts</code>, <code>http/security-headers.ts</code>,{' '}
          <code>packages/server/src/config.ts</code>, <code>host/audio-ws.ts</code>, <code>packages/payments/src/guard.ts</code>, <code>render.yaml</code> and <code>docs/SECURITY-REVIEW.md</code>. This is a design map, not an audit:
          13 of the 24 items of the security checklist are PASS, the others carry a named residual, and the owner has not signed any item off. Everything here targets the PayPal sandbox.
        </>
      }
      transcript={
        <>
          <ul>
            {items.map((i) => (
              <li key={i.id}>
                <strong>{i.title}.</strong> {i.detail}
              </li>
            ))}
          </ul>
          <p>
            Boundary crossings: browsers and the operator reach the host over HTTPS and WebSocket carrying a signed token or the admin key. The host reaches PayPal with OAuth client credentials. PayPal reaches the host with a signed webhook event. The host reaches
            a speech provider with an API key only when one is configured. GitHub Actions reaches PayPal with the sandbox secrets.
          </p>
        </>
      }
      render={(p) => (
        <>
          <Defs p={p} />
          <rect x={0} y={0} width={1200} height={560} style={{ fill: 'var(--hl-bg)' }} />

          {/* zones */}
          <rect x={10} y={40} width={220} height={500} className="guide-dash" fill="none" />
          <T x={20} y={60} cls="t-small t-ink">OUTSIDE: PEOPLE</T>
          <rect x={330} y={40} width={520} height={500} className="panel" />
          <T x={340} y={60} cls="t-small t-ink">GAVEL HOST: ONE NODE PROCESS</T>
          <rect x={950} y={40} width={240} height={500} className="guide-dash" fill="none" />
          <T x={960} y={60} cls="t-small t-ink">OUTSIDE: SERVICES</T>

          {/* people */}
          <Box id="bidder" x={30} y={80} w={180} lens={lens} hot={hot} />
          <Box id="auctioneer" x={30} y={150} w={180} lens={lens} hot={hot} />
          <Box id="screen" x={30} y={220} w={180} lens={lens} hot={hot} />
          <Box id="operator" x={30} y={290} w={180} sub="holds the admin key" lens={lens} hot={hot} />
          <Box id="stranger" x={30} y={400} w={180} kind="stop" sub="refused at the door" lens={lens} hot={hot} />
          <g style={{ opacity: lensOp('TOKEN_SECRET', 'ADMIN_KEY') }}>
            <path d="M210 108 H270 M210 178 H270 M210 248 H270 M210 318 H270 M270 102 V318" className="edge" />
            <path d="M270 102 H340" className="edge" markerEnd={`url(#${p}-arrow)`} />
            <T x={305} y={80} anchor="middle" cls="t-small t-muted">token or</T>
            <T x={305} y={92} anchor="middle" cls="t-small t-muted">admin key</T>
          </g>
          <g style={{ opacity: lensOp('TOKEN_SECRET') }}>
            <path d="M210 428 H325" className="edge-stop" markerEnd={`url(#${p}-arrow-stop)`} />
            <T x={268} y={420} anchor="middle" cls="t-small t-stop">bad link</T>
          </g>

          {/* host */}
          <Box id="gate" x={345} y={80} w={490} h={44} lens={lens} hot={hot} />
          <Box id="tokenDoor" x={345} y={150} w={115} sub="TOKEN_SECRET" lens={lens} hot={hot} />
          <Box id="audioDoor" x={470} y={150} w={115} sub="token in 5 s" lens={lens} hot={hot} />
          <Box id="adminDoor" x={595} y={150} w={115} sub="ADMIN_KEY" lens={lens} hot={hot} />
          <Box id="webhookDoor" x={720} y={150} w={115} sub="PayPal signature" lens={lens} hot={hot} />
          <g style={{ opacity: lens === 'all' ? 1 : 0.5 }}>
            <path d="M402 124 V150 M527 124 V150 M652 124 V150 M777 124 V150" className="edge" markerEnd={`url(#${p}-arrow)`} />
          </g>

          <g {...hot.props('inside')} aria-label="Inside the host" style={{ opacity: lens === 'all' ? 1 : 0.5, cursor: 'pointer', outline: 'none' }}>
            <rect x={345} y={236} width={490} height={104} rx={2} className="node-term" fill="none" style={{ strokeDasharray: '4 3' }} />
            <T x={355} y={254} cls="t-small t-muted">INSIDE: NOTHING RUNS BEFORE A DOOR PASSES</T>
          </g>
          <Box id="room" x={355} y={266} w={146} h={64} sub="engine, ledger" lens={lens} hot={hot} />
          <Box id="bridge" x={511} y={266} w={146} h={64} sub="speech to bids" lens={lens} hot={hot} />
          <Box id="payments" x={667} y={266} w={158} h={64} sub="holds, saga" lens={lens} hot={hot} />
          <path d="M590 212 V236" className="edge-thick" markerEnd={`url(#${p}-arrow-dark)`} />
          <Box id="storage" x={345} y={390} w={490} h={56} sub="files on a persistent disk or Postgres" lens={lens} hot={hot} />
          <path d="M428 330 V390 M746 330 V390" className="edge" markerEnd={`url(#${p}-arrow)`} />
          <T x={345} y={474} cls="t-small t-muted">Bidders see their own ceiling only. Audit rows for others carry no transcript.</T>
          <T x={345} y={490} cls="t-small t-muted">In production the host refuses weak secrets, fake payments and the demo routes.</T>

          {/* services */}
          <Box id="paypal" x={970} y={150} w={200} h={156} kind="term" sub="api-m.sandbox.paypal.com" lens={lens} hot={hot} />
          <Box id="stt" x={970} y={340} w={200} sub="Deepgram, Groq (if keyed)" lens={lens} hot={hot} />
          <Box id="ci" x={970} y={450} w={200} sub="sandbox secrets" lens={lens} hot={hot} />

          <g style={{ opacity: lensOp('PayPal keys') }}>
            <path d="M970 180 H835" className="edge" markerEnd={`url(#${p}-arrow)`} />
            <T x={902} y={172} anchor="middle" cls="t-small t-muted">signed event</T>
            <path d="M825 298 H970" className="edge-thick" markerEnd={`url(#${p}-arrow-dark)`} />
            <T x={897} y={290} anchor="middle" cls="t-small t-muted">OAuth keys</T>
            <path d="M1070 450 V306" className="edge-dash" markerEnd={`url(#${p}-arrow)`} />
          </g>
          <g style={{ opacity: lensOp('Speech keys') }}>
            <path d="M584 330 V368 H970" className="edge-thick" markerEnd={`url(#${p}-arrow-dark)`} />
            <T x={780} y={360} anchor="middle" cls="t-small t-muted">audio + API key</T>
          </g>
        </>
      )}
    />
  );
}
