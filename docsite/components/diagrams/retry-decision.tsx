'use client';

import { useState, type KeyboardEvent } from 'react';
import { Chip } from '@/components/holdline/chip';
import { DiagramFrame } from './frame';
import { Defs, T, hatch } from './kit';

// D9. What the capture phase does with each kind of answer to the capture call. Every row is
// read from:
//   packages/payments/src/transport.ts       retries: 429, 500, 502, 503, 504, network; 4 attempts; 10 s; Retry-After
//   packages/payments/src/errorMap.ts        status to kind and outcome (definite or unknown)
//   packages/payments/src/saga/capture.ts    afterFailure(): the order of the checks below, and the
//                                            sets AUTH_KINDS, INVARIANT_KINDS, PER_HOLD_KINDS
//   packages/payments/src/saga/unknown.ts    10 minute and 3 day deadlines
// PR #1938 (429 starts no unknown clock) and PR #1947 (a refusal that names the hold, including a
// capture past the honor period, is definite also after a 429 stall) are on main.
type Tone = 'done' | 'wait' | 'review' | 'fallback';
type Row = {
  key: string;
  button: string;
  cls: string[];
  tone: Tone;
  word: string;
  out: string[];
  explain: string;
};

const ROWS: Row[] = [
  {
    key: 'ok',
    button: '2xx COMPLETED',
    cls: ['2xx, status COMPLETED,', 'amount as asked'],
    tone: 'done',
    word: 'CAPTURED',
    out: ['capture_ok is saved, then the void phase releases the others.'],
    explain: 'The capture is taken. The saga saves capture_ok and moves on to voiding the other holds.',
  },
  {
    key: 'kill',
    button: 'Kill switch',
    cls: ['kill switch engaged', 'nothing is sent'],
    tone: 'wait',
    word: 'PAUSED',
    out: ['The unknown clock stands still while the switch is on.', 'A capture already at PayPal is still adopted.'],
    explain: 'No new capture is sent while the switch is engaged. The time it held the clock is not counted afterwards.',
  },
  {
    key: 'auth',
    button: 'No token',
    cls: ['no OAuth token (401 after refresh,', 'auth unavailable): nothing sent'],
    tone: 'wait',
    word: 'STALLED: auth_unavailable',
    out: ['No clock starts; the intent stays, nothing was sent.', 'One operator alert after 10 minutes of stall.'],
    explain: 'Nothing reached PayPal, so nothing is in doubt and no hold is released for it.',
  },
  {
    key: '429',
    button: '429',
    cls: ['HTTP 429, after the transport', "tried 4 times: PayPal refused it"],
    tone: 'wait',
    word: 'STALLED: rate_limited (PR #1938)',
    out: ['No unknown clock starts, so a restart cannot age it into review.', 'Next pass reads the truth first, then repeats the same request id.'],
    explain:
      'A 429 means PayPal refused to run the request. It is not an unknown outcome. Before PR #1938 a long outage after a 429 could push a settlement into review; the simulated storm lots now settle.',
  },
  {
    key: 'unknown',
    button: 'Timeout or 5xx',
    cls: ['timeout, network error, 5xx,', '408, 409, 425: outcome unknown'],
    tone: 'wait',
    word: 'UNKNOWN CLOCK: 10 minutes',
    out: ['Next pass: truth first, then the same request id again.', 'After 10 minutes: FAILED_NEEDS_REVIEW. Never the next bidder.'],
    explain: 'The capture may have happened. The saga never charges the runner-up on a maybe. A person decides after ten minutes.',
  },
  {
    key: 'pending',
    button: 'Pending at PayPal',
    cls: ['PayPal took the capture but', 'lists it PENDING'],
    tone: 'wait',
    word: 'WAITS FOR PAYPAL: up to 3 days',
    out: ['COMPLETED: adopted. Declined: the runner-up.', 'Alert after 10 minutes; review only after 3 days.'],
    explain: 'PayPal is deciding, which can take hours. The capture is never sent again under a new id.',
  },
  {
    key: 'invariant',
    button: '400 or id conflict',
    cls: ['400, request id reused with other', 'parameters, ceiling out of range'],
    tone: 'review',
    word: 'FAILED_NEEDS_REVIEW (invariant)',
    out: ['A bug or a configuration fault: the next bidder would hit it too.'],
    explain: 'Trying another candidate would repeat the fault for every bidder, so a person looks at it.',
  },
  {
    key: 'definite',
    button: 'Declined or honor period',
    cls: ['refusal that names this hold: declined,', 'expired, voided, already captured, 404,', 'or 422 past the honor period (PR #1947)'],
    tone: 'fallback',
    word: 'TRUTH FIRST, THEN THE RUNNER-UP',
    out: ['A capture already there is adopted; hold gone or still open:', 'definite fail, then the runner-up at its own price.', 'Truth unreadable: waits. A different capture: review.'],
    explain:
      'Only a refusal that names this hold may move to the next bidder, and only after the truth says nothing was captured. PR #1947 makes this hold also after a 429 stall. The honor-period issue name is UNVERIFIED (G3).',
  },
  {
    key: 'other',
    button: '403 or unknown refusal',
    cls: ['any other refusal: 403, other 4xx,', 'a 422 issue the code does not know'],
    tone: 'wait',
    word: 'UNKNOWN CLOCK: 10 minutes',
    out: ['May repeat for every bidder, so never the next bidder:', 'unknown clock starts, review after 10 minutes.'],
    explain: 'An unclassified refusal could be merchant-wide, so it stops the settlement instead of releasing winning bids.',
  },
];

const ROW_H = 66;
const PITCH = 74;
const Y0 = 70;
const ry = (i: number) => Y0 + i * PITCH;
const HEIGHT = Y0 + ROWS.length * PITCH + 40;

function onKey(e: KeyboardEvent<SVGGElement>, fn: () => void) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fn();
  }
}

export function RetryDecisionDiagram() {
  const [sel, setSel] = useState<number | null>(null);
  const toggle = (i: number) => setSel((cur) => (cur === i ? null : i));
  const btn =
    'rounded-[2px] border px-2 py-1 font-mono text-[0.68rem] font-bold uppercase hover:bg-fd-accent aria-pressed:bg-fd-accent aria-pressed:border-[var(--hl-fg)]';
  const chosen = sel === null ? null : ROWS[sel];
  return (
    <DiagramFrame
      title="A capture call fails: what the saga does next"
      desc="A decision tree for the answer to the capture call. The transport first retries network errors, 429 and 500 to 504 up to four times with the same request id. Then the capture phase sorts the failure. A kill switch pauses. A missing token stalls with no clock. A 429 stalls with no unknown clock and retries with the same id after reading the truth. A timeout or 5xx starts a ten minute unknown clock and goes to review after it, never to the next bidder. A pending capture waits up to three days. A 400 or an id conflict goes to review as an invariant. A refusal that names the hold, including a capture past the honor period, reads the truth and then falls back to the runner-up. Any other refusal starts the unknown clock."
      width={1200}
      height={HEIGHT}
      badge={
        <>
          <Chip kind="fake">Fake PayPal</Chip>
          <Chip kind="hatched">Real limits UNVERIFIED</Chip>
        </>
      }
      toolbar={
        <div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Pick an answer to follow">
            {ROWS.map((r, i) => (
              <button key={r.key} type="button" className={btn} aria-pressed={sel === i} onClick={() => toggle(i)}>
                {r.button}
              </button>
            ))}
          </div>
          <p className="mt-2 min-h-[3rem]" aria-live="polite">
            {chosen ? (
              <>
                <b>{chosen.button}.</b> {chosen.explain}
              </>
            ) : (
              <span className="text-fd-muted-foreground">Pick an answer, or click a row, to follow its path. Pick it again to show all rows.</span>
            )}
          </p>
        </div>
      }
      caption={
        <>
          Read from <code>packages/payments/src/saga/capture.ts</code> (<code>afterFailure</code>),{' '}
          <code>errorMap.ts</code>, <code>transport.ts</code> and <code>saga/unknown.ts</code>; PR #1938 and PR #1947 are
          on main. The behaviour is tested against the fake PayPal (<code>test/saga/rateLimited.test.ts</code>) and in the
          simulated storm lots of S8. PayPal&apos;s real rate limits are UNVERIFIED (G1 measurement), and so is the exact
          honor-period issue name (G3).
        </>
      }
      transcript={
        <>
          <p>The transport retries network errors and the statuses 429, 500, 502, 503 and 504, up to 4 attempts of 10 seconds each, with the same request id; a Retry-After wait is honored up to 30 seconds. What it returns or throws is sorted by the capture phase:</p>
          <ul>
            {ROWS.map((r) => (
              <li key={r.key}>
                <b>{r.button}:</b> {r.cls.join(' ')} leads to {r.word}. {r.out.join(' ')}
              </li>
            ))}
          </ul>
        </>
      }
      render={(p) => (
        <>
          <Defs p={p} />
          <rect x={0} y={0} width={1200} height={HEIGHT} style={{ fill: 'var(--hl-bg)' }} />
          <T x={14} y={30} cls="t-big">The call</T>
          <T x={440} y={30} cls="t-big">What the answer is</T>
          <T x={774} y={30} cls="t-big">What the saga does</T>

          {/* the call and the transport */}
          <rect x={14} y={Y0} width={150} height={92} rx={2} className="node" />
          <T x={89} y={Y0 + 28} anchor="middle" cls="t-big">capture</T>
          <T x={89} y={Y0 + 48} anchor="middle" cls="t-small t-muted">request id gv1-...</T>
          <T x={89} y={Y0 + 64} anchor="middle" cls="t-small t-muted">intent saved first</T>
          <path d={`M164 ${Y0 + 46} H190`} className="edge-thick" markerEnd={`url(#${p}-arrow-dark)`} />
          <rect x={190} y={Y0} width={222} height={230} rx={2} className="node" />
          <rect x={190} y={Y0} width={222} height={5} className="rule-money" />
          <T x={301} y={Y0 + 28} anchor="middle" cls="t-big">Transport</T>
          {['retries on network error,', '429, 500, 502, 503, 504', 'up to 4 attempts, 10 s each', 'full-jitter backoff 250 ms to 4 s', 'Retry-After honored up to 30 s', 'same request id every attempt', 'then returns or throws the', 'last answer'].map((l, i) => (
            <T key={l} x={202} y={Y0 + 52 + i * 18} cls="t-small t-muted">{l}</T>
          ))}

          {/* fan-out bracket */}
          <path d={`M412 ${Y0 + 46} H428`} className="edge-thick" />
          <path d={`M428 ${ry(0) + ROW_H / 2} V${ry(ROWS.length - 1) + ROW_H / 2}`} className="edge" />

          {ROWS.map((r, i) => {
            const y = ry(i);
            const on = sel === null || sel === i;
            const mid = y + ROW_H / 2;
            const strip =
              r.tone === 'done' ? 'fill-solid' : r.tone === 'review' ? 'fill-stop' : r.tone === 'fallback' ? 'fill-hollow' : 'fill-hatch-edge';
            return (
              <g
                key={r.key}
                style={{ opacity: on ? 1 : 0.2, cursor: 'pointer', outline: 'none' }}
                tabIndex={0}
                role="button"
                aria-pressed={sel === i}
                aria-label={r.button}
                onClick={() => toggle(i)}
                onKeyDown={(e) => onKey(e, () => toggle(i))}
              >
                <path d={`M428 ${mid} H440`} className="edge" markerEnd={`url(#${p}-arrow)`} />
                <rect x={440} y={y} width={300} height={ROW_H} rx={2} className={r.tone === 'review' ? 'node-stop' : 'node'} />
                {r.cls.map((l, j) => (
                  <T key={l} x={452} y={y + 22 + j * 16} cls="t-small">{l}</T>
                ))}
                <path d={`M740 ${mid} H770`} className="edge-thick" markerEnd={`url(#${p}-arrow-dark)`} />
                <rect x={770} y={y} width={416} height={ROW_H} rx={2} className="panel" />
                <rect
                  x={770}
                  y={y}
                  width={12}
                  height={ROW_H}
                  fill={r.tone === 'wait' ? hatch(p) : undefined}
                  className={strip}
                />
                <T x={792} y={y + 18} cls={r.tone === 'review' ? 't-stop' : r.tone === 'done' ? 't-go' : 't-ink'}>{r.word}</T>
                {r.out.map((l, j) => (
                  <T key={l} x={792} y={y + 34 + j * 14} cls="t-small t-muted">{l}</T>
                ))}
              </g>
            );
          })}

          <g>
            <rect x={14} y={HEIGHT - 28} width={22} height={14} fill={hatch(p)} className="fill-hatch-edge" />
            <T x={42} y={HEIGHT - 17} cls="t-small">waits, nothing is lost</T>
            <rect x={210} y={HEIGHT - 28} width={22} height={14} className="fill-solid" />
            <T x={238} y={HEIGHT - 17} cls="t-small">money taken</T>
            <rect x={350} y={HEIGHT - 28} width={22} height={14} className="fill-hollow" />
            <T x={378} y={HEIGHT - 17} cls="t-small">falls back to the runner-up</T>
            <rect x={600} y={HEIGHT - 28} width={22} height={14} className="fill-stop" />
            <T x={628} y={HEIGHT - 17} cls="t-small">a person is needed</T>
          </g>
        </>
      )}
    />
  );
}
