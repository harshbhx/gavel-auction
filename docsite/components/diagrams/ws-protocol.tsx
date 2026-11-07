'use client';

import { Chip } from '@/components/holdline/chip';
import { DiagramFrame } from './frame';
import { StepControls, stepStyle, useSteps } from './interactive';
import { Badge, Defs, T } from './kit';

// B3. WebSocket protocol: join, resume, live frames, bids, keep-alive, reconnect.
// Verified against: packages/shared/src/wire/{envelope,client,server,codec}.ts (frames, caps),
// packages/server/src/host/{gateway,node-ws}.ts (path, Origin, join verification),
// packages/server/src/transport/{handshake,connections}.ts (5 s join deadline, ping, slow consumer),
// packages/server/src/room/{room,resync,confirm}.ts (attach, replay, confirm_request),
// packages/shared/src/errors.ts (close codes) and packages/web/src/net/connection.ts (reconnect).
const W = 900;
const H = 680;
const X = { C: 120, G: 430, R: 740 } as const;
type Lane = keyof typeof X;

const lanes: { id: Lane; label: string; sub: string }[] = [
  { id: 'C', label: 'Client', sub: 'bidder, screen, console' },
  { id: 'G', label: 'Gateway', sub: 'host/gateway.ts' },
  { id: 'R', label: 'Room', sub: 'room/room.ts' },
];

type Msg = { step: number; from: Lane; to: Lane; y: number; label: string; dashed?: boolean };
const msgs: Msg[] = [
  { step: 0, from: 'C', to: 'G', y: 112, label: 'GET /ws  (upgrade, Origin checked)' },
  { step: 1, from: 'C', to: 'G', y: 196, label: 'join { token, auctionId, lastSeq? }' },
  { step: 1, from: 'G', to: 'R', y: 262, label: 'attach(connection, lastSeq)' },
  { step: 2, from: 'R', to: 'C', y: 312, label: 'replay, if 200 events or fewer were missed', dashed: true },
  { step: 2, from: 'R', to: 'C', y: 344, label: 'state { snapshot }' },
  { step: 3, from: 'R', to: 'C', y: 394, label: 'price, audit_event, hammer, settlement_update' },
  { step: 3, from: 'R', to: 'C', y: 426, label: 'confirm_request (that bidder only)', dashed: true },
  { step: 4, from: 'C', to: 'R', y: 476, label: 'bid { mid, amount, source }' },
  { step: 4, from: 'C', to: 'R', y: 508, label: 'confirm_response { confirmId, accept }' },
  { step: 4, from: 'R', to: 'C', y: 540, label: 'bid_accepted | bid_rejected', dashed: true },
];

type Note = { step: number; x: number; y: number; w: number; text: string };
const notes: Note[] = [
  { step: 0, x: X.G + 8, y: 124, w: 280, text: 'no join within 5 s: close 4001' },
  { step: 1, x: X.G + 8, y: 210, w: 330, text: 'token verified for this auction, auction must exist' },
  { step: 5, x: X.G + 8, y: 566, w: 340, text: 'ping every 20 s, two missed pongs: close 1001' },
  { step: 5, x: X.R - 330, y: 596, w: 380, text: '256 queued frames or 5 s undrained: close 4008' },
  { step: 6, x: 24, y: 636, w: 560, text: 'reconnect after 0.5, 1, 2, 4, 8 s (+/- 20%), join again with lastSeq' },
];

const labels = [
  <>
    <strong>1. Upgrade.</strong> The socket lives at <code>/ws</code>. A request with no <code>Origin</code>, or one that
    is not on the allowed list, is refused before any frame. After the upgrade the client has 5 seconds to send a join, or
    the host closes with 4001. A frame sent before the join gets <code>not_joined</code>.
  </>,
  <>
    <strong>2. Join.</strong> The first frame must be <code>join</code> with <code>v: 1</code>, a token, the auction id and,
    when resuming, the highest <code>seq</code> the client has applied. The gateway verifies the token for that auction
    (kind session, auctioneer or screen, not revoked) and checks the auction exists. A bad token closes with 4401. A malformed join, a wrong
    protocol version included, closes with 1008 (<code>bad_message</code>).
  </>,
  <>
    <strong>3. Resume or snapshot.</strong> If the client is behind by 200 events or fewer, the room replays the audit
    frames it missed, then always sends a <code>state</code> snapshot. A client that is current, ahead, or too far behind
    gets the snapshot only. The snapshot is redacted for the viewer: a bidder sees only their own ceiling and hold.
  </>,
  <>
    <strong>4. Live frames.</strong> Every frame after the join carries <code>seq</code> and <code>ts</code>. One accepted
    bid is one seq, sent as <code>price</code> plus <code>audit_event</code>; events a viewer may not see still send a
    filler so the numbers stay gapless. A held bid sends <code>confirm_request</code> to its bidder only.
  </>,
  <>
    <strong>5. Client frames.</strong> After the join a client may send only <code>bid</code> and{' '}
    <code>confirm_response</code>; anything else, a second join or an extra field is refused with 1008 (<code>bad_message</code>), and the socket itself is capped at 16 KiB per frame. The answer to a bid carries the same <code>mid</code>, so a retry is matched to the first send.
  </>,
  <>
    <strong>6. Keep-alive and slow readers.</strong> The host pings every 20 seconds and closes after two missed pongs. Each
    connection has a bounded queue; one that falls 256 frames behind, or does not drain a write in 5 seconds, is closed
    with 4008 and resyncs on reconnect without holding the room up.
  </>,
  <>
    <strong>7. Reconnect.</strong> The client reconnects forever with a jittered back-off (500 ms up to 8 s) and joins again
    with its last applied <code>seq</code>. A gap in the numbers makes it ask for a fresh snapshot. A dead token
    (<code>unauthorized</code>, <code>forbidden</code>, <code>invite_used</code>) ends the session; a full room or a rate
    limit waits for the bidder to retry.
  </>,
];

function Arrow({ m, p, steps, first }: { m: Msg; p: string; steps: ReturnType<typeof useSteps>; first: boolean }) {
  const x1 = X[m.from];
  const x2 = X[m.to];
  const dir = x2 > x1 ? 1 : -1;
  const mid = (x1 + x2) / 2;
  const current = steps.index === m.step;
  return (
    <g style={stepStyle(steps, m.step)}>
      <path
        d={`M${x1} ${m.y} H${x2 - dir * 2}`}
        className={m.dashed ? 'edge-dash' : current ? 'edge-thick' : 'edge'}
        markerEnd={`url(#${p}-${current && !m.dashed ? 'arrow-dark' : 'arrow'})`}
      />
      <rect x={mid - m.label.length * 2.95 - 4} y={m.y - 19} width={m.label.length * 5.9 + 8} height={14} style={{ fill: 'var(--hl-bg)' }} />
      <T x={mid} y={m.y - 8} anchor="middle" cls="t-small">
        {m.label}
      </T>
      {current && first && <Badge x={Math.min(x1, x2) - 30 < 4 ? Math.max(x1, x2) + 10 : Math.min(x1, x2) - 30} y={m.y - 10} n={m.step + 1} />}
    </g>
  );
}

export function WsProtocolDiagram() {
  const steps = useSteps(labels.length);
  return (
    <DiagramFrame
      title="WebSocket protocol: join, resume, live frames, bids and reconnect"
      desc="Sequence diagram with three lanes: client, gateway and room. The client upgrades at /ws and must send a join within 5 seconds. The gateway verifies the token for the auction and attaches the connection to the room. The room replays missed frames if the gap is 200 events or fewer, then sends a state snapshot. Live frames carry a sequence number. The client may send only bid and confirm_response. Pings run every 20 seconds, a slow reader is closed with 4008, and the client reconnects with back-off and its last sequence number."
      width={W}
      height={H}
      minWidth={760}
      badge={<Chip kind="hollow">Read from code</Chip>}
      toolbar={<StepControls steps={steps} labels={labels} />}
      caption={
        <>
          Source: <code>packages/shared/src/wire/</code> (frames and size caps), <code>packages/server/src/host/gateway.ts</code>,{' '}
          <code>transport/handshake.ts</code>, <code>transport/connections.ts</code>, <code>room/resync.ts</code>,{' '}
          <code>room/room.ts</code> and the client side in <code>packages/web/src/net/connection.ts</code>. Auctioneer
          controls (hammer, pause, extend) are not WebSocket frames; they use the HTTP control route. This is a map of code
          paths, not a measurement.
        </>
      }
      transcript={
        <>
          <p>Lanes: client, gateway, room.</p>
          <ol>
            <li>The client upgrades at /ws. No join within 5 seconds closes with 4001.</li>
            <li>The client sends join with a token, the auction id and optionally lastSeq. The gateway verifies the token for that auction and attaches the connection to the room.</li>
            <li>The room replays missed audit frames if 200 events or fewer were missed, then sends a state snapshot.</li>
            <li>Live frames carry seq and ts: price, audit_event, hammer, settlement_update. confirm_request goes to the held bid's owner only.</li>
            <li>The client may send bid and confirm_response. The room answers with bid_accepted or bid_rejected carrying the same mid.</li>
            <li>The host pings every 20 seconds and closes after two missed pongs. A connection 256 frames behind, or undrained for 5 seconds, closes with 4008.</li>
            <li>The client reconnects with a back-off of 0.5, 1, 2, 4, then 8 seconds, plus or minus 20 percent, and joins with its last seq.</li>
          </ol>
        </>
      }
      render={(p) => (
        <>
          <Defs p={p} />
          <rect x={0} y={0} width={W} height={H} style={{ fill: 'var(--hl-bg)' }} />
          {lanes.map((l) => (
            <g key={l.id}>
              <rect x={X[l.id] - 80} y={16} width={160} height={46} rx={2} className="node" />
              <T x={X[l.id]} y={36} anchor="middle" cls="t-big">{l.label}</T>
              <T x={X[l.id]} y={53} anchor="middle" cls="t-small t-muted">{l.sub}</T>
              <path d={`M${X[l.id]} 62 V${H - 14}`} className="guide-dash" fill="none" />
            </g>
          ))}
          {notes.map((n) => (
            <g key={n.text} style={stepStyle(steps, n.step)}>
              <rect x={n.x} y={n.y} width={n.w} height={24} rx={2} className="node" />
              <T x={n.x + 8} y={n.y + 16} cls="t-small">{n.text}</T>
              {steps.index === n.step && <Badge x={n.x - 26} y={n.y + 2} n={n.step + 1} />}
            </g>
          ))}
          {msgs.map((m, i) => (
            <Arrow key={`${m.step}-${m.y}`} m={m} p={p} steps={steps} first={msgs.findIndex((x) => x.step === m.step) === i} />
          ))}
        </>
      )}
    />
  );
}
