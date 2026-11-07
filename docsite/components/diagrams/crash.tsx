'use client';

import { Chip } from '@/components/holdline/chip';
import { DiagramFrame } from './frame';
import { Badge, Defs, Legend, Node, T, hatch } from './kit';

// D5. Crash recovery. The sequence and the crash boundaries come from
// packages/payments/src/saga/capture.ts (truth read, write-ahead intent, before:capture,
// after:capture, journaled:capture_ok) and the restart rules from the header of that file and of
// saga/unknown.ts. The injected-crash tests (S6 in the simulation) use these same boundaries.
const panels = [
  {
    id: 'A',
    x: 30,
    title: 'Died after the intent was saved,',
    title2: 'before PayPal got the call',
    lines: [
      ['JOURNAL', 'intent saved: capture, $350, request id.'],
      ['', 'State is CAPTURING.'],
      ['RESTART', 'reads the truth of the hold first.'],
      ['', 'PayPal shows no capture.'],
      ['DOES', 'sends the saved intent again with the'],
      ['', 'same request id; PayPal answers once.'],
    ],
  },
  {
    id: 'B',
    x: 415,
    title: 'Died after PayPal took the capture,',
    title2: 'before the answer was saved',
    lines: [
      ['JOURNAL', 'the same intent, no outcome.'],
      ['RESTART', 'reads the truth first. It shows our'],
      ['', 'capture (invoice id and amount match).'],
      ['DOES', 'adopts it as capture_ok, no new call.'],
      ['IF UNKNOWN', 'truth unreadable, or hold not found:'],
      ['', 'wait with the same id for 10 minutes,'],
      ['', 'then FAILED_NEEDS_REVIEW. Never the'],
      ['', 'next bidder.'],
    ],
  },
  {
    id: 'C',
    x: 800,
    title: 'Died after capture_ok was saved',
    title2: '',
    lines: [
      ['JOURNAL', 'state CAPTURED, winner recorded,'],
      ['', 'intent cleared.'],
      ['RESTART', 'reads the state: already CAPTURED.'],
      ['DOES', 'goes on to void the other holds.'],
      ['', 'No capture call is made.'],
    ],
  },
] as const;

export function CrashDiagram() {
  return (
    <DiagramFrame
      title="Crash recovery: charged exactly once"
      desc="Two timelines. The process timeline runs hammer, truth read, intent saved, PayPal capture call, capture_ok saved, then voiding. Three crash points are marked: A after the intent is saved and before the call, B after PayPal took the capture and before the answer is saved, C after capture_ok is saved. The journal timeline shows the intent as a hatched entry and the outcome as a solid entry. Three panels say what the journal holds and what the restart does at each point. The result is one capture."
      width={1200}
      height={700}
      badge={<Chip kind="fake">Fake PayPal</Chip>}
      caption={
        <>
          Verified with injected crashes at these boundaries against the fake PayPal (the simulation
          scenario S6 runs 10 crash points, each with and without the idempotency table). One in-process
          crash at the same place is reported as passing in the nightly sandbox run of 6 Nov (run log only,
          not independently verifiable). No real server kill and restart has run on a hosted host.
        </>
      }
      transcript={
        <>
          <p>The capture sequence is: read the truth of the hold, save the intent (capture, amount, request id), call PayPal, save capture_ok.</p>
          <ul>
            <li>Crash A, after the intent is saved and before the call: on restart the truth shows no capture, and the saved intent is sent again with the same request id.</li>
            <li>Crash B, after PayPal took the capture and before the answer was saved: on restart the truth shows the capture, which is adopted. If the truth cannot be read, or PayPal does not know the hold, the settlement waits with the same request id for ten minutes and then goes to FAILED_NEEDS_REVIEW. It never tries the next bidder.</li>
            <li>Crash C, after capture_ok was saved: the state is already CAPTURED, so the restart goes on to void the other holds without a capture call.</li>
          </ul>
          <p>Result: the winner is charged once.</p>
        </>
      }
      render={(p) => (
        <>
          <Defs p={p} />
          <rect x={0} y={0} width={1200} height={700} style={{ fill: 'var(--hl-bg)' }} />
          <Legend p={p} x={30} y={24} />

          <T x={30} y={72} cls="t-small t-ink">PROCESS TIMELINE</T>
          <Node x={30} y={90} w={110} h={44} label="hammer" />
          <Node x={175} y={90} w={120} h={44} label="truth read" />
          <Node x={330} y={90} w={130} h={44} label="intent saved" />
          <Node x={495} y={90} w={150} h={44} label="PayPal capture" money />
          <Node x={680} y={90} w={170} h={44} label="capture_ok saved" money />
          <Node x={885} y={90} w={150} h={44} label="void, SETTLED" />
          {[
            [140, 175],
            [295, 330],
            [460, 495],
            [645, 680],
            [850, 885],
          ].map(([a, b]) => (
            <path key={a} d={`M${a} 112 H${b}`} className="edge" markerEnd={`url(#${p}-arrow)`} />
          ))}

          {/* crash points */}
          {[
            { x: 477, n: 'A' },
            { x: 662, n: 'B' },
            { x: 867, n: 'C' },
          ].map((c) => (
            <g key={c.n}>
              <path d={`M${c.x - 8} 142 l16 16 m0 -16 l-16 16`} style={{ stroke: 'var(--hl-stop)', strokeWidth: 3 }} />
              <T x={c.x} y={176} anchor="middle" cls="t-big t-stop">{c.n}</T>
            </g>
          ))}
          <T x={1060} y={116} cls="t-small t-muted">X: the process dies</T>

          {/* journal timeline */}
          <T x={30} y={218} cls="t-small t-ink">JOURNAL TIMELINE (what survives the crash)</T>
          <line x1={30} y1={252} x2={1170} y2={252} className="edge" />
          <rect x={330} y={236} width={130} height={32} fill={hatch(p)} className="fill-hatch-edge" />
          <T x={395} y={286} anchor="middle" cls="t-small">INTENT capture $350</T>
          <T x={395} y={300} anchor="middle" cls="t-small t-muted">request id gv1-...</T>
          <rect x={680} y={236} width={170} height={32} className="fill-solid" />
          <T x={765} y={286} anchor="middle" cls="t-small">capture_ok, winner</T>
          <T x={765} y={300} anchor="middle" cls="t-small t-muted">intent cleared</T>
          <rect x={175} y={236} width={120} height={32} className="fill-hollow" />
          <T x={235} y={286} anchor="middle" cls="t-small t-muted">truth read: no write</T>

          {/* three panels */}
          {panels.map((pn) => (
            <g key={pn.id}>
              <rect x={pn.x} y={326} width={370} height={236} className="panel" />
              <Badge x={pn.x + 10} y={336} n={pn.id === 'A' ? 1 : pn.id === 'B' ? 2 : 3} />
              <T x={pn.x + 40} y={352} cls="t-small t-stop">{`CRASH ${pn.id}`}</T>
              <T x={pn.x + 12} y={378} cls="t-small" >{pn.title}</T>
              {pn.title2 && <T x={pn.x + 12} y={393} cls="t-small">{pn.title2}</T>}
              {pn.lines.map((l, i) => (
                <g key={i}>
                  {l[0] && (
                    <T x={pn.x + 12} y={424 + i * 16} cls="t-small t-ink">{l[0]}</T>
                  )}
                  <T x={pn.x + 96} y={424 + i * 16} cls="t-small t-muted">{l[1]}</T>
                </g>
              ))}
            </g>
          ))}

          {/* result strip */}
          <rect x={30} y={590} width={1140} height={44} className="fill-solid" />
          <text x={600} y={618} textAnchor="middle" style={{ fill: 'var(--hl-bg)', fontWeight: 800, fontSize: 18 }}>
            Charged exactly once
          </text>
          <T x={30} y={664} cls="t-small t-muted">Where this lives: packages/payments/src/saga/capture.ts (truth first, write-ahead intent),</T>
          <T x={30} y={680} cls="t-small t-muted">saga/unknown.ts (the 10 minute deadline), saga/machine.ts, packages/payments/src/requestId.ts.</T>
        </>
      )}
    />
  );
}
