'use client';

import { useState } from 'react';
import { Chip } from '@/components/holdline/chip';
import { DiagramFrame } from './frame';
import { StepControls, stepStyle, useSteps } from './interactive';
import { Badge, Defs, Node, T, hatch } from './kit';

// D8. The restart timeline for one crash point of the capture. The five crash points are the
// boundaries the simulation S6 injects (docs/evidence/SIM/SIM-MULTIDAY.md): journaled:begin,
// journaled:intent, before:capture, after:capture, journaled:capture_ok. The restart steps come from:
//   packages/server/src/boot/compose.ts            service.resume() once at boot
//   packages/server/src/runtime/auction-service.ts resume() on a 60 s timer; loads rooms, schedules the
//                                                  settlement, then intake.sweep() and sweepHolds()
//   packages/payments/src/saga/create.ts           withLease, DEFAULT_LEASE_TTL_MS = 320 s
//   packages/payments/src/stores/memory.ts         acquireLease refuses while another owner's lease is live
//   packages/payments/src/saga/trail.ts            recoverTrail appends the audit rows a crash lost
//   packages/payments/src/saga/capture.ts          truth first, reuse of the saved intent, adopt
const CRASHES = [
  {
    key: 'journaled:begin',
    state: 'state CAPTURING, no intent',
    paypal: 'no capture',
    decide: ['truth: hold open, no capture.', 'Build the intent, save it,', 'then send the capture.'],
    why: 'The journal only says the capture phase began. The restart does the whole phase, intent first.',
  },
  {
    key: 'journaled:intent',
    state: 'intent saved: capture, amount, request id',
    paypal: 'no capture (call not sent)',
    decide: ['truth: no capture.', 'The saved intent is sent', 'again with the same request id.'],
    why: 'The intent was saved before the call, so the restart sends exactly that call. Nothing is rebuilt.',
  },
  {
    key: 'before:capture',
    state: 'intent saved: capture, amount, request id',
    paypal: 'no capture (died just before the call)',
    decide: ['truth: no capture.', 'The saved intent is sent', 'again with the same request id.'],
    why: 'From the journal this looks the same as the previous point. The truth read tells them apart from point 4.',
  },
  {
    key: 'after:capture',
    state: 'intent saved, no outcome',
    paypal: 'capture taken, the answer was lost',
    decide: ['truth: the capture is there,', 'amount and invoice match.', 'Adopted. No second call.'],
    why: 'The worst moment. The truth read finds the capture, so the winner is charged once. This holds even if PayPal forgot the request id (simulated S6 variants).',
  },
  {
    key: 'journaled:capture_ok',
    state: 'state CAPTURED, winner set, intent cleared',
    paypal: 'capture taken',
    decide: ['The journal already says', 'CAPTURED. No capture call', 'is made at all.'],
    why: 'The capture is finished and saved. The restart goes straight on to releasing the other holds.',
  },
] as const;

const RESTART = [
  { title: 'Process starts', sub: 'resume() at boot' },
  { title: 'Lease', sub: 'one runner at a time' },
  { title: 'Journal and trail', sub: 'read, then catch up' },
  { title: 'Truth read', sub: 'ask PayPal first' },
  { title: 'Decide', sub: 'depends on the crash' },
  { title: 'Finish', sub: 'void, settle, sweep' },
];

const X = (i: number) => 14 + i * 196;

export function RecoveryTimelineDiagram() {
  const [crash, setCrash] = useState(3);
  const steps = useSteps(RESTART.length, RESTART.length - 1);
  const c = CRASHES[crash] ?? CRASHES[3];
  const labels = [
    <>
      <b>Start.</b> <code>compose.ts</code> calls <code>service.resume()</code> once when the server boots, and the
      service calls it again every 60 seconds. It loads every known auction and schedules each unfinished settlement.
    </>,
    <>
      <b>Lease.</b> A runner holds a lease on the settlement. A process that was killed cannot release it, so the new
      process is told &quot;busy&quot; until the lease expires (320 seconds by default); the next 60 second pass tries again.
    </>,
    <>
      <b>Journal and trail.</b> The journal is read from disk. The audit rows of transitions that were saved but whose
      row was not written yet are appended first (<code>recoverTrail</code>).
    </>,
    <>
      <b>Truth read.</b> Before any capture the saga asks PayPal what the hold looks like. A capture that is already
      there decides everything that follows.
    </>,
    <>
      <b>Decide.</b> {c.why}
    </>,
    <>
      <b>Finish.</b> The other holds are voided, three at a time, and the settlement ends SETTLED. Each resume pass also
      applies stored webhook events that have no result and sweeps abandoned holds.
    </>,
  ];
  const btn =
    'rounded-[2px] border px-2 py-1 font-mono text-[0.68rem] font-bold uppercase hover:bg-fd-accent aria-pressed:bg-fd-accent aria-pressed:border-[var(--hl-fg)]';
  return (
    <DiagramFrame
      title="Restart timeline: from a crash back to one charge"
      desc="Top: the five points of the capture where a crash is injected in the simulation, with the selected one marked, and what the journal and PayPal hold at that moment. Bottom: six restart stages. The process starts and calls resume. A lease from a killed process must expire, up to 320 seconds. The journal is read and missing audit rows are appended. The truth of the hold is read at PayPal. The decision depends on the crash point: resend the saved intent with the same request id, adopt a capture that is already there, or go straight to voiding. Finally the other holds are voided and the settlement is settled."
      width={1200}
      height={560}
      badge={
        <>
          <Chip kind="fake">Fake PayPal</Chip>
          <Chip kind="hatched">Simulated S6</Chip>
        </>
      }
      toolbar={
        <div>
          <div className="mb-2 flex flex-wrap gap-2" role="group" aria-label="Pick the crash point">
            {CRASHES.map((k, i) => (
              <button key={k.key} type="button" className={btn} aria-pressed={crash === i} onClick={() => setCrash(i)}>
                {i + 1}. {k.key}
              </button>
            ))}
          </div>
          <StepControls steps={steps} labels={labels} title="Restart stage" />
        </div>
      }
      caption={
        <>
          Crash points and results are the simulated scenario S6 (<code>docs/evidence/SIM/SIM-MULTIDAY.md</code>): 10
          variants, every restart ends with one charge. The restart stages are read from{' '}
          <code>packages/server/src/runtime/auction-service.ts</code>, <code>boot/compose.ts</code>,{' '}
          <code>packages/payments/src/saga/create.ts</code>, <code>saga/trail.ts</code> and <code>saga/capture.ts</code>.
          One in-process crash at the same place (R10) passed on the real sandbox; killing a real server process on a
          deployed host has not been run.
        </>
      }
      transcript={
        <>
          <p>Crash points injected by the simulation, in order: journaled:begin, journaled:intent, before:capture, after:capture, journaled:capture_ok.</p>
          <ul>
            {CRASHES.map((k) => (
              <li key={k.key}>
                <b>{k.key}:</b> journal holds {k.state}; PayPal holds {k.paypal}. {k.why}
              </li>
            ))}
          </ul>
          <p>Restart stages: resume() runs at boot and every 60 seconds; a lease of a killed process holds until it expires (320 seconds by default); the journal is read and missing audit rows are appended; the truth of the hold is read at PayPal; the decision follows from the crash point; the other holds are voided and the settlement is settled, and stored webhook events and abandoned holds are swept.</p>
        </>
      }
      render={(p) => (
        <>
          <Defs p={p} />
          <rect x={0} y={0} width={1200} height={560} style={{ fill: 'var(--hl-bg)' }} />
          <T x={14} y={26} cls="t-big">The capture, with the crash point you picked</T>
          <line x1={90} y1={74} x2={1110} y2={74} className="edge" />
          {CRASHES.map((k, i) => {
            const x = 110 + i * 240;
            const here = i === crash;
            const before = i < crash;
            return (
              <g key={k.key}>
                {here ? (
                  <g>
                    <polygon points={`${x - 16},${74 + 16} ${x + 16},${74 + 16} ${x},${74 - 18}`} className="fill-stop" />
                    <T x={x} y={80} anchor="middle" cls="t-big">!</T>
                  </g>
                ) : (
                  <rect x={x - 8} y={66} width={16} height={16} rx={2} fill={before ? undefined : 'none'} className={before ? 'fill-solid' : 'fill-hollow'} />
                )}
                <T x={x} y={110} anchor="middle" cls={`t-small ${here ? 't-stop' : ''}`}>{k.key}</T>
                <T x={x} y={50} anchor="middle" cls="t-small t-muted">{`point ${i + 1}`}</T>
              </g>
            );
          })}
          <rect x={14} y={128} width={1172} height={62} rx={2} className="panel" />
          <T x={26} y={150} cls="t-ink">Left behind</T>
          <T x={140} y={150} cls="t-small">journal on disk: {c.state}</T>
          <T x={140} y={172} cls="t-small">PayPal: {c.paypal}</T>
          <T x={1170} y={150} anchor="end" cls="t-small t-stop">process killed here</T>

          <line x1={14} y1={216} x2={1186} y2={216} className="guide" />
          <T x={14} y={240} cls="t-big">After the restart</T>

          {RESTART.map((r, i) => (
            <g key={r.title} style={stepStyle(steps, i)}>
              <Badge x={X(i)} y={252} n={i + 1} />
              <Node x={X(i)} y={278} w={186} h={58} label={r.title} sub={r.sub} money={i === 3} />
              {i < RESTART.length - 1 && (
                <path d={`M${X(i) + 186} 307 H${X(i + 1)}`} className="edge-thick" markerEnd={`url(#${p}-arrow-dark)`} />
              )}
            </g>
          ))}

          {/* lease detail */}
          <g style={stepStyle(steps, 1)}>
            <T x={X(1)} y={364} cls="t-small t-muted">killed process: lease stays</T>
            <T x={X(1)} y={380} cls="t-small t-muted">until it expires (320 s);</T>
            <T x={X(1)} y={396} cls="t-small t-muted">busy until then, try again</T>
            <T x={X(1)} y={412} cls="t-small t-muted">on the next 60 s pass</T>
          </g>
          <g style={stepStyle(steps, 2)}>
            <T x={X(2)} y={364} cls="t-small t-muted">journal read from disk</T>
            <T x={X(2)} y={380} cls="t-small t-muted">audit rows above auditedSeq</T>
            <T x={X(2)} y={396} cls="t-small t-muted">are appended first</T>
          </g>
          <g style={stepStyle(steps, 3)}>
            <T x={X(3)} y={364} cls="t-small t-muted">GET the hold at PayPal:</T>
            <T x={X(3)} y={380} cls="t-small t-muted">is there a capture, is the</T>
            <T x={X(3)} y={396} cls="t-small t-muted">hold still open?</T>
          </g>
          <g style={stepStyle(steps, 4)}>
            <rect x={X(4)} y={352} width={186} height={94} rx={2} fill={hatch(p)} className="fill-hatch-edge" />
            <rect x={X(4) + 6} y={358} width={174} height={82} style={{ fill: 'var(--hl-panel)' }} />
            {c.decide.map((l, j) => (
              <T key={l} x={X(4) + 12} y={378 + j * 18} cls="t-small">{l}</T>
            ))}
          </g>
          <g style={stepStyle(steps, 5)}>
            <T x={X(5)} y={364} cls="t-small t-muted">void the other holds,</T>
            <T x={X(5)} y={380} cls="t-small t-muted">3 at a time: SETTLED</T>
            <T x={X(5)} y={396} cls="t-small t-muted">then sweep stored events</T>
            <T x={X(5)} y={412} cls="t-small t-muted">and abandoned holds</T>
          </g>

          <g style={stepStyle(steps, 5)}>
            <rect x={14} y={470} width={1172} height={50} rx={2} className="panel" />
            <rect x={14} y={470} width={12} height={50} className="fill-solid" />
            <T x={42} y={492} cls="t-go">Result in every simulated variant: one charge on the winner</T>
            <T x={42} y={510} cls="t-small t-muted">If the truth cannot be read, or the hold is not found: nothing is guessed. The intent stays, no other bidder is tried, the 10 minute clock runs.</T>
          </g>
        </>
      )}
    />
  );
}
