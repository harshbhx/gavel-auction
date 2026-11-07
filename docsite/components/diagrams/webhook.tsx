'use client';

import type { KeyboardEvent } from 'react';
import { Chip } from '@/components/holdline/chip';
import { DiagramFrame } from './frame';
import { StepControls, stepStyle, useSteps } from './interactive';
import { Badge, Defs, Node, T } from './kit';

// D6. Webhook handling, one delivery from the HTTP route to the hold record. Every stage and
// every answer is read from:
//   packages/server/src/http/webhook.ts and webhook-guard.ts   (route, 405, 413, status mapping)
//   packages/payments/src/webhooks/handler.ts                  (type filter, verify, 401 and 503)
//   packages/payments/src/webhooks/verify.ts                   (what verification checks)
// The server wires its own intake (runtime/webhook-intake.ts); the library helpers dedupe.ts, merge.ts and
// orphans.ts in the payments package are not on the server path and are not drawn.
//   packages/server/src/runtime/webhook-intake.ts              (store, find hold, park, truth, merge, sweep)
// The route sends bad signatures as 400 (statusFor); the payments handler answers 401 and the
// server maps it. Note: the server stores the event and applies it before it answers 200; an
// apply that fails is left for the sweep and the answer is still 200.

type Tone = 'go' | 'stop' | 'wait' | 'plain';
type Stage = {
  title: string;
  sub: string;
  money?: boolean;
  out: [Tone, string][];
};

const STAGES: Stage[] = [
  {
    title: 'Route',
    sub: 'POST /webhooks/paypal',
    out: [
      ['stop', 'not POST: 405'],
      ['stop', 'over 256 KB: 413'],
      ['plain', 'else: raw bytes go on,'],
      ['plain', 'never parsed first'],
    ],
  },
  {
    title: 'Type filter',
    sub: 'acceptsEventType',
    out: [
      ['go', 'VOIDED, DENIED, CAPTURE.*:'],
      ['go', 'go on'],
      ['plain', 'any other type: 200,'],
      ['plain', 'no verify call, not stored'],
    ],
  },
  {
    title: 'Verify',
    sub: "PayPal's endpoint",
    out: [
      ['go', 'SUCCESS: go on'],
      ['stop', 'forged or malformed: 400'],
      ['wait', 'PayPal unreachable: 503'],
      ['wait', 'over call budget: 503'],
    ],
  },
  {
    title: 'Store',
    sub: 'insert if absent, by id',
    out: [
      ['go', 'new id: saved, go on'],
      ['plain', 'seen id: stop, 200'],
      ['wait', 'cannot store: 503'],
    ],
  },
  {
    title: 'Find the hold',
    sub: 'by authorization id',
    out: [
      ['go', 'found: go on'],
      ['wait', 'unknown: parked 10 min'],
      ['plain', 'still unknown after 10:'],
      ['plain', 'dropped'],
    ],
  },
  {
    title: 'Truth, then merge',
    sub: 'only a HELD hold moves',
    money: true,
    out: [
      ['go', 'status comes from PayPal,'],
      ['go', 'never from the body'],
      ['wait', 'read fails: stays stored,'],
      ['wait', 'the sweep tries again'],
    ],
  },
];

const W = 190;
const GAP = 8;
const X0 = 14;
const sx = (i: number) => X0 + i * (W + GAP);

const toneClass: Record<Tone, string> = { go: 't-go', stop: 't-stop', wait: 't-ink', plain: 't-muted' };

const LABELS = [
  <>
    <b>1. Route.</b> The route accepts only POST and reads the body as bytes. A body above 256 KB is answered 413
    before anything else. Files: <code>packages/server/src/http/webhook.ts</code>,{' '}
    <code>webhook-guard.ts</code>.
  </>,
  <>
    <b>2. Type filter.</b> Only AUTHORIZATION.VOIDED, AUTHORIZATION.DENIED and the four CAPTURE events are acted on.
    Any other type is answered 200 without a verify call, so it costs nothing and is not stored. File:{' '}
    <code>packages/server/src/runtime/webhook-intake.ts</code> (<code>acceptsEventType</code>).
  </>,
  <>
    <b>3. Verify.</b> The five PayPal-* headers, the certificate host (https, paypal.com), the algorithm and the
    time are checked first; then the original bytes go to PayPal's verify call. Only SUCCESS passes. File:{' '}
    <code>packages/payments/src/webhooks/verify.ts</code>, answers in <code>handler.ts</code>.
  </>,
  <>
    <b>4. Store.</b> The event is saved under PayPal's event id with insert-if-absent, so a second delivery of
    the same id stops here and is still answered 200. File: <code>packages/server/src/runtime/webhook-intake.ts</code>.
  </>,
  <>
    <b>5. Find the hold.</b> The authorization id in the event is matched to a hold of any known auction. No match
    parks the event for 10 minutes; the sweep tries again and then drops it. File:{' '}
    <code>runtime/webhook-intake.ts</code>.
  </>,
  <>
    <b>6. Truth, then merge.</b> The hold is read at PayPal. Only a hold that is still HELD changes, and the new
    status is what PayPal says, so a late, early or repeated event cannot move money or state backwards. Capture
    events also make the settlement read the truth again.
  </>,
];

function jump(e: KeyboardEvent<SVGGElement>, fn: () => void) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fn();
  }
}

export function WebhookDiagram() {
  const steps = useSteps(STAGES.length, STAGES.length - 1);
  return (
    <DiagramFrame
      title="One webhook delivery, from the route to the hold"
      desc="Six stages. The route reads raw bytes and refuses non-POST and bodies over 256 kilobytes. The type filter answers 200 to event types the app does not act on. Verify asks PayPal to check the signature; failures answer 400, an unreachable PayPal or an exhausted call budget answers 503 so PayPal sends it again. Store keeps one row per event id and a repeat stops there. Find the hold matches the authorization id and parks unknown ones for ten minutes. Truth then merge reads the hold at PayPal and only a held hold changes. A sweep applies stored events that have no result."
      width={1200}
      height={520}
      badge={
        <>
          <Chip kind="sandbox">Sandbox: verify (G4)</Chip>
          <Chip kind="fake">Fake: tampered event</Chip>
        </>
      }
      toolbar={<StepControls steps={steps} labels={LABELS} title="Stage" />}
      caption={
        <>
          Read from <code>packages/server/src/http/webhook.ts</code>, <code>webhook-guard.ts</code>,{' '}
          <code>packages/payments/src/webhooks/handler.ts</code>, <code>verify.ts</code> and{' '}
          <code>packages/server/src/runtime/webhook-intake.ts</code>. Gate G4 verified six real deliveries through
          PayPal&apos;s endpoint; rejecting a tampered event is covered against the fake PayPal only, and whether a PayPal
          retry keeps its original transmission headers is UNVERIFIED. The late-event parking is shown by the simulated
          scenario S7.
        </>
      }
      transcript={
        <>
          <ol>
            <li>Route: POST /webhooks/paypal only (405 otherwise); a body over 256 KB is 413. The body stays raw bytes.</li>
            <li>Type filter: AUTHORIZATION.VOIDED, AUTHORIZATION.DENIED, CAPTURE.PENDING, CAPTURE.COMPLETED, CAPTURE.DENIED and CAPTURE.DECLINED are acted on. Any other type is answered 200 with no verify call.</li>
            <li>Verify: headers, certificate host, algorithm and time are checked, then PayPal verifies the original bytes. Success continues, a forged or malformed delivery is answered 400, PayPal being unreachable or the call budget being used up is 503 so PayPal sends it again.</li>
            <li>Store: insert-if-absent under the event id. A repeat id stops here, answered 200. A store failure is 503.</li>
            <li>Find the hold: by authorization id. Unknown is parked for 10 minutes and retried by the sweep, then dropped.</li>
            <li>Truth, then merge: read the hold at PayPal; only a HELD hold changes, to the status PayPal reports. A failed read leaves the event stored for the next sweep.</li>
          </ol>
          <p>An event for a hold this server does not know is stored, parked and answered 200 so PayPal stops sending it. The answer to PayPal never depends on how the apply step ended: 200 means the event is stored.</p>
        </>
      }
      render={(p) => (
        <>
          <Defs p={p} />
          <rect x={0} y={0} width={1200} height={520} style={{ fill: 'var(--hl-bg)' }} />
          <T x={14} y={26} cls="t-big">PayPal delivery</T>
          <T x={14} y={44} cls="t-small t-muted">click a stage, or use Next, to read what it does</T>

          {STAGES.map((s, i) => {
            const x = sx(i);
            const active = steps.index === i;
            return (
              <g
                key={s.title}
                style={{ ...stepStyle(steps, i), cursor: 'pointer', outline: 'none' }}
                tabIndex={0}
                role="button"
                aria-label={`Stage ${i + 1}: ${s.title}`}
                aria-pressed={active}
                onClick={() => steps.set(i)}
                onKeyDown={(e) => jump(e, () => steps.set(i))}
              >
                <Node x={x} y={78} w={W} h={66} label={s.title} sub={s.sub} money={s.money} />
                <Badge x={x + 6} y={58} n={i + 1} />
                {active && <rect x={x - 3} y={75} width={W + 6} height={72} fill="none" className="edge-thick" />}
                {s.out.map(([tone, text], j) => (
                  <T key={text} x={x + 4} y={176 + j * 17} cls={`t-small ${toneClass[tone]}`}>
                    {text}
                  </T>
                ))}
                {i < STAGES.length - 1 && (
                  <path d={`M${x + W} 111 H${x + W + GAP}`} className="edge-thick" markerEnd={`url(#${p}-arrow-dark)`} />
                )}
              </g>
            );
          })}

          {/* background sweep */}
          <g style={stepStyle(steps, 4)}>
            <path d={`M${sx(4) + 60} 252 V300 H${sx(5) + 60} V252`} className="edge-dash" markerEnd={`url(#${p}-arrow)`} />
            <T x={sx(4) + 14} y={320} cls="t-small t-muted">
              sweep(): every resume pass (default 60 s) applies
            </T>
            <T x={sx(4) + 14} y={335} cls="t-small t-muted">
              stored events that have no result yet
            </T>
          </g>

          {/* answer to PayPal */}
          <g>
            <line x1={14} y1={372} x2={1186} y2={372} className="guide" />
            <T x={14} y={396} cls="t-big">The answer PayPal gets</T>
            <rect x={14} y={410} width={372} height={92} className="panel" />
            <T x={26} y={432} cls="t-go">200</T>
            <T x={26} y={450} cls="t-small">stored (also: ignored type, repeat id,</T>
            <T x={26} y={466} cls="t-small">unknown hold, parked). PayPal stops.</T>
            <rect x={404} y={410} width={372} height={92} className="panel" />
            <T x={416} y={432} cls="t-stop">400</T>
            <T x={416} y={450} cls="t-small">signature failed or body malformed.</T>
            <T x={416} y={466} cls="t-small">Nothing stored, no state touched.</T>
            <rect x={794} y={410} width={392} height={92} className="panel" />
            <T x={806} y={432} cls="t-ink">503</T>
            <T x={806} y={450} cls="t-small">could not check or could not store:</T>
            <T x={806} y={466} cls="t-small">PayPal sends the event again.</T>
          </g>
        </>
      )}
    />
  );
}
