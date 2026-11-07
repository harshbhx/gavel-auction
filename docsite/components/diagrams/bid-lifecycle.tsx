'use client';

import { Chip } from '@/components/holdline/chip';
import { DiagramFrame } from './frame';
import { StepControls, stepStyle, useSteps } from './interactive';
import { Badge, Defs, T, hatch } from './kit';

// B1. Bid lifecycle, from a tap or a spoken bid to an accepted or rejected bid.
// Verified against: packages/server/src/room/room.ts (submitBid, handleBid, holdForConfirm,
// respondConfirm, resolveConfirm), packages/server/src/room/confirm.ts (needsConfirm,
// CONFIRM_TTL_MS), packages/server/src/voice/bridge.ts (toBid, dropOf),
// packages/voice/src/decide/policy.ts (classify), packages/engine/src/rules/validate-bid.ts
// (check order), packages/engine/src/decide/place-bid.ts, packages/shared/src/wire/*.
const W = 1000;
const H = 660;
const X = { B: 110, V: 300, R: 500, E: 700, L: 890 } as const;
type Lane = keyof typeof X;

const lanes: { id: Lane; label: string; sub: string }[] = [
  { id: 'B', label: 'Bidder', sub: 'phone or console' },
  { id: 'V', label: 'Voice bridge', sub: 'room mic, /audio' },
  { id: 'R', label: 'Room', sub: 'WebSocket host' },
  { id: 'E', label: 'Engine', sub: 'pure rules' },
  { id: 'L', label: 'Event log', sub: 'room store' },
];

type Msg = {
  step: number;
  from: Lane;
  to: Lane;
  y: number;
  label: string;
  dashed?: boolean;
  stop?: boolean;
};

const msgs: Msg[] = [
  { step: 0, from: 'B', to: 'R', y: 124, label: "bid { mid, amount, source: 'qr' }  (a tap)" },
  { step: 0, from: 'V', to: 'R', y: 156, label: 'bid: voice + confidence' },
  { step: 0, from: 'V', to: 'R', y: 186, label: 'drop: voice_dropped, no bid', dashed: true },
  { step: 3, from: 'R', to: 'L', y: 322, label: 'append confirm_requested' },
  { step: 3, from: 'R', to: 'B', y: 350, label: 'confirm_request (this bidder only, 15 s)', dashed: true },
  { step: 4, from: 'B', to: 'R', y: 380, label: 'confirm_response { accept }' },
  { step: 5, from: 'R', to: 'E', y: 430, label: 'PlaceBid  confirmed: true' },
  { step: 6, from: 'E', to: 'R', y: 500, label: 'accepted | rejected(reason)', dashed: true },
  { step: 7, from: 'R', to: 'L', y: 540, label: 'append, fenced by the expected seq' },
  { step: 7, from: 'R', to: 'B', y: 574, label: 'bid_accepted | bid_rejected (sender only)' },
  { step: 7, from: 'R', to: 'B', y: 604, label: 'price + audit_event to everyone (redacted)', dashed: true },
];

type Note = { step: number; lane: Lane; y: number; w: number; text: string };
const notes: Note[] = [
  { step: 1, lane: 'R', y: 222, w: 250, text: 'rate limit, role, identity from the token' },
  { step: 2, lane: 'R', y: 264, w: 250, text: 'same mid? send the old reply again' },
  { step: 6, lane: 'E', y: 462, w: 270, text: 'validateBid: first failing check wins' },
];

const labels = [
  <>
    <strong>1. Two ways in.</strong> A tap sends a <code>bid</code> frame with source <code>qr</code>. Speech goes
    through the voice bridge: the pipeline classifies each utterance as accept, confirm or drop. Accept and confirm
    become a <code>bid</code> frame with source <code>voice</code> (a confirm sets <code>ambiguous</code>); a drop is
    recorded as <code>voice_dropped</code> and never becomes a bid. As the bridge is wired today no second parser is
    attached, so a clean reading scores at most 0.82, below the 0.85 auto line: every spoken bid arrives as a confirm.
  </>,
  <>
    <strong>2. The room checks who and how often.</strong> The bidder identity comes from the token, never from the frame
    (only the auctioneer may name a bidder). A per-bidder rate limit applies to taps and spoken bids alike.
  </>,
  <>
    <strong>3. Same message id, same answer.</strong> The key is the bidder plus the <code>mid</code>. A repeat with the
    same amount and source gets the original reply and appends nothing. The same <code>mid</code> with another amount is
    a <code>conflict</code>.
  </>,
  <>
    <strong>4. The confirm gate.</strong> A voice frame with <code>ambiguous</code> set, or with a confidence under
    the room threshold (0.85 in the demo config; a missing one counts as zero), is held: <code>confirm_requested</code> is logged and only that bidder is
    asked. The hold lasts 15 seconds and the engine has not seen the bid. A bidder has one hold at a time.
  </>,
  <>
    <strong>5. The bidder answers.</strong> Accept goes on. Reject, a late answer or the timer ends the hold as
    rejected or expired, writes an audit row and places no bid.
  </>,
  <>
    <strong>6. Accepted holds reach the engine.</strong> The room sends <code>PlaceBid</code> with{' '}
    <code>audit.confirmed</code> set. The resolution and the bid are written in one append, so a hold is never consumed
    without its bid.
  </>,
  <>
    <strong>7. The engine decides.</strong> Checks run in a fixed order: lot open, registered, ceiling not revoked,
    amount valid, voice confirmed, under ceiling, reserve, increment, already leading, limits. The first failure is the
    reason. The engine also fails closed on an unconfirmed low-confidence voice bid, whatever the room did.
  </>,
  <>
    <strong>8. Durable, then told.</strong> The result is appended with the expected seq (a stale host is fenced), and
    the sender hears <code>bid_accepted</code> or <code>bid_rejected</code> only once the log holds it. An accepted bid
    also broadcasts <code>price</code> and a redacted <code>audit_event</code>. Refusals that cost nothing to decide
    (unregistered, bad amount, paused) are answered but not logged.
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
      {current && first && <Badge x={x1 < x2 ? x1 - 30 : x1 + 10} y={m.y - 10} n={m.step + 1} />}
    </g>
  );
}

export function BidLifecycleDiagram() {
  const steps = useSteps(labels.length);
  return (
    <DiagramFrame
      title="Bid lifecycle: from a tap or a spoken bid to an accepted or rejected bid"
      desc="Sequence diagram with five lanes: bidder, voice bridge, room, engine and event log. A tap or a voice bid arrives at the room. The room rate-limits it, checks the message id, and holds a low-confidence or ambiguous voice bid for a 15 second confirm. An accepted confirm, or a confident bid, reaches the engine, which applies its checks in a fixed order. The result is appended to the event log before the sender is told, and an accepted bid is broadcast as a price and an audit event."
      width={W}
      height={H}
      minWidth={900}
      badge={<Chip kind="hollow">Read from code</Chip>}
      toolbar={<StepControls steps={steps} labels={labels} />}
      caption={
        <>
          Source: <code>packages/server/src/room/room.ts</code> (<code>submitBid</code>, <code>handleBid</code>,{' '}
          <code>holdForConfirm</code>, <code>respondConfirm</code>), <code>room/confirm.ts</code>,{' '}
          <code>packages/server/src/voice/bridge.ts</code>, <code>packages/voice/src/decide/policy.ts</code> and{' '}
          <code>packages/engine/src/rules/validate-bid.ts</code>. This is a map of code paths, not a measurement. Tap
          bids and confident voice bids skip steps 4 and 5. Hatched band: held, the engine has not seen the bid.
        </>
      }
      transcript={
        <>
          <p>Actors, left to right: bidder, voice bridge, room, engine, event log.</p>
          <ol>
            <li>A tap sends a bid frame with source qr. A spoken bid is classified by the voice pipeline as accept, confirm or drop; accept and confirm become a bid frame with source voice, a drop becomes a voice_dropped record.</li>
            <li>The room rate-limits the sender and takes the bidder identity from the token.</li>
            <li>A repeat of the same message id gets the original reply; the same id with another amount is a conflict.</li>
            <li>A voice bid that is ambiguous or under the room threshold (0.85 in the demo config) is held. confirm_requested is logged and only that bidder is asked, for 15 seconds. The engine is not touched.</li>
            <li>The bidder accepts, rejects, or the hold expires.</li>
            <li>On accept the room sends PlaceBid with confirmed set; the resolution and the bid are one append.</li>
            <li>The engine checks in order: lot open, registered, ceiling, amount, voice confirmed, over ceiling, reserve, increment, already leading, limits.</li>
            <li>The result is appended with the expected seq, then the sender is told. Accepted bids broadcast price and a redacted audit event.</li>
          </ol>
        </>
      }
      render={(p) => (
        <>
          <Defs p={p} />
          <rect x={0} y={0} width={W} height={H} style={{ fill: 'var(--hl-bg)' }} />

          {/* held band: confirm gate, steps 4 and 5 */}
          <g style={stepStyle(steps, 3)}>
            <rect x={X.B - 50} y={296} width={X.R - X.B + 100} height={104} fill={hatch(p)} className="fill-hatch-edge" />
            <rect x={X.B - 50} y={274} width={190} height={20} className="panel" />
            <T x={X.B - 43} y={288} cls="t-small t-ink">held: engine has not seen it</T>
          </g>

          {lanes.map((l) => (
            <g key={l.id}>
              <rect x={X[l.id] - 70} y={16} width={140} height={46} rx={2} className="node" />
              <T x={X[l.id]} y={36} anchor="middle" cls="t-big">{l.label}</T>
              <T x={X[l.id]} y={53} anchor="middle" cls="t-small t-muted">{l.sub}</T>
              <path d={`M${X[l.id]} 62 V${H - 20}`} className="guide-dash" fill="none" />
            </g>
          ))}

          {notes.map((n) => (
            <g key={n.text} style={stepStyle(steps, n.step)}>
              <rect x={X[n.lane] + 6} y={n.y} width={Math.max(n.w, n.text.length * 6.6 + 24)} height={24} rx={2} className="node" />
              <T x={X[n.lane] + 14} y={n.y + 16} cls="t-small">{n.text}</T>
              {steps.index === n.step && <Badge x={X[n.lane] - 26} y={n.y + 2} n={n.step + 1} />}
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
