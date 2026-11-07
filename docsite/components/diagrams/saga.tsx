'use client';

import { Chip } from '@/components/holdline/chip';
import { DiagramFrame } from './frame';
import { Badge, Defs, Legend, Node, T, hatch } from './kit';

// D1. Settlement saga. Every state and every legal move is the TRANSITIONS table in
// packages/payments/src/saga/machine.ts (SPEC 6.1); the review reasons are the events
// invariant, unknown_deadline, mismatch and void_budget_exhausted of that table.
export function SagaDiagram() {
  return (
    <DiagramFrame
      title="Settlement saga: every state and legal move"
      desc="State machine of a settlement. The main path is HELD, BIDDING, WINNER_SELECTED, CAPTURING, CAPTURED, VOIDING, SETTLED. A definite capture failure moves CAPTURING to FALLBACK_RUNNER_UP, which returns to CAPTURING for the next bidder or goes to VOIDING when none is left. Unknown answers, invariant breaks, mismatches and exhausted void retries end in FAILED_NEEDS_REVIEW, which needs a person. Below the states, a journal lane shows that intent is saved before each PayPal call and the outcome after it."
      width={1200}
      height={760}
      badge={<Chip kind="fake">Fake PayPal</Chip>}
      caption={
        <>
          Verified against the fake PayPal. Not run end to end on the PayPal sandbox as a whole auction;
          the sandbox runs recorded in <code>docs/GATES.md</code> cover single calls and the nightly specs.
          States and moves are copied from the transition table in{' '}
          <code>packages/payments/src/saga/machine.ts</code>.
        </>
      }
      transcript={
        <>
          <p>The main path is HELD, BIDDING (start_auction), WINNER_SELECTED (hammer), CAPTURING (begin), CAPTURED (capture_ok or adopted), VOIDING (begin_void), SETTLED (all_released).</p>
          <ul>
            <li>cancel moves HELD or BIDDING to VOIDING. no_candidate moves WINNER_SELECTED to VOIDING.</li>
            <li>definite_fail moves CAPTURING to FALLBACK_RUNNER_UP. next_candidate returns to CAPTURING. no_candidates_left moves it to VOIDING.</li>
            <li>FAILED_NEEDS_REVIEW is terminal. It is reached by invariant (from WINNER_SELECTED, CAPTURING, FALLBACK_RUNNER_UP), unknown_deadline (from CAPTURING, after ten minutes), mismatch (from CAPTURING or CAPTURED) and void_budget_exhausted (from VOIDING).</li>
            <li>Each transition is one compare-and-set save of the journal. The capture intent is saved before the PayPal call and cleared when the outcome is saved.</li>
          </ul>
        </>
      }
      render={(p) => (
        <>
          <Defs p={p} />
          <rect x={0} y={0} width={1200} height={760} style={{ fill: 'var(--hl-bg)' }} />

          {/* main path, row A */}
          <Node x={30} y={100} w={90} label="HELD" />
          <Node x={242} y={100} w={100} label="BIDDING" />
          <Node x={464} y={100} w={170} label="WINNER_SELECTED" review />
          <Node x={756} y={100} w={120} label="CAPTURING" money review />
          <Node x={998} y={100} w={170} label="FALLBACK_RUNNER_UP" review />
          {/* row B */}
          <Node x={756} y={290} w={120} label="CAPTURED" money review />
          <Node x={464} y={290} w={120} label="VOIDING" review />
          <Node x={242} y={290} w={100} label="SETTLED" kind="term" />

          <path d="M120 126 H242" className="edge" markerEnd={`url(#${p}-arrow)`} />
          <T x={181} y={118} anchor="middle" cls="t-small t-muted">start_auction</T>
          <path d="M342 126 H464" className="edge" markerEnd={`url(#${p}-arrow)`} />
          <T x={403} y={118} anchor="middle" cls="t-small t-muted">hammer</T>
          <path d="M634 126 H756" className="edge" markerEnd={`url(#${p}-arrow)`} />
          <T x={695} y={118} anchor="middle" cls="t-small t-muted">begin</T>

          <path d="M876 114 H998" className="edge" markerEnd={`url(#${p}-arrow)`} />
          <T x={937} y={106} anchor="middle" cls="t-small t-muted">definite_fail</T>
          <path d="M998 138 H876" className="edge" markerEnd={`url(#${p}-arrow)`} />
          <T x={937} y={166} anchor="middle" cls="t-small t-muted">next_candidate</T>

          <path d="M816 152 V290" className="edge-thick" markerEnd={`url(#${p}-arrow-dark)`} />
          <T x={808} y={225} anchor="end" cls="t-small t-muted">capture_ok / adopted</T>

          <path d="M756 316 H584" className="edge" markerEnd={`url(#${p}-arrow)`} />
          <T x={670} y={308} anchor="middle" cls="t-small t-muted">begin_void</T>
          <path d="M464 316 H342" className="edge" markerEnd={`url(#${p}-arrow)`} />
          <T x={403} y={308} anchor="middle" cls="t-small t-muted">all_released</T>

          <path d="M330 152 V240 H500 V290" className="edge" markerEnd={`url(#${p}-arrow)`} />
          <T x={340} y={232} cls="t-small t-muted">cancel (from HELD or BIDDING)</T>
          <path d="M560 152 V290" className="edge" markerEnd={`url(#${p}-arrow)`} />
          <T x={568} y={225} cls="t-small t-muted">no_candidate</T>

          <path d="M1083 152 V400 H524 V342" className="edge" markerEnd={`url(#${p}-arrow)`} />
          <T x={800} y={392} anchor="middle" cls="t-small t-muted">no_candidates_left</T>

          {/* review node with the needs-review notch */}
          <path d="M320 430 H1156 L1170 444 V590 H320 Z" className="node-stop" />
          <T x={340} y={458} cls="t-big t-stop">FAILED_NEEDS_REVIEW</T>
          <T x={560} y={458} cls="t-small t-muted">terminal: a person must look, nothing is retried blindly</T>
          <T x={340} y={488} cls="t-small">invariant</T>
          <T x={560} y={488} cls="t-small t-muted">from WINNER_SELECTED, CAPTURING, FALLBACK_RUNNER_UP</T>
          <T x={340} y={512} cls="t-small">unknown_deadline</T>
          <T x={560} y={512} cls="t-small t-muted">from CAPTURING: the capture answer stayed unknown for 10 minutes</T>
          <T x={340} y={536} cls="t-small">mismatch</T>
          <T x={560} y={536} cls="t-small t-muted">from CAPTURING or CAPTURED: capture amount or identity differs from the plan</T>
          <T x={340} y={560} cls="t-small">void_budget_exhausted</T>
          <T x={560} y={560} cls="t-small t-muted">from VOIDING: a void still failed after 5 resumes</T>
          <T x={340} y={582} cls="t-small t-stop">A red corner on a state means it can move here.</T>

          {/* numbered callouts */}
          <Badge x={30} y={430} n={1} />
          <T x={58} y={444} cls="t-small">One request id per capture, a hash</T>
          <T x={58} y={459} cls="t-small">of auction, op, hold, amount and</T>
          <T x={58} y={474} cls="t-small">generation. Same on every resume.</T>
          <Badge x={30} y={494} n={2} />
          <T x={58} y={508} cls="t-small">An unknown answer is not a failure:</T>
          <T x={58} y={523} cls="t-small">it waits. Never the next bidder,</T>
          <T x={58} y={538} cls="t-small">never a new request id.</T>
          <Badge x={30} y={558} n={3} />
          <T x={58} y={572} cls="t-small">Only a definite refusal falls back,</T>
          <T x={58} y={587} cls="t-small">after a truth read shows no capture.</T>

          {/* journal lane */}
          <rect x={30} y={618} width={1140} height={108} className="panel" />
          <T x={44} y={640} cls="t-small t-ink">JOURNAL: written before and after each PayPal call</T>
          <line x1={60} y1={672} x2={1140} y2={672} className="edge" />
          {[
            { x: 130, kind: 'solid', a: 'hammer saved', b: 'state WINNER_SELECTED' },
            { x: 330, kind: 'hatch', a: 'intent saved', b: 'capture, request id, amount' },
            { x: 530, kind: 'hollow', a: 'PayPal capture call', b: 'same request id on retry' },
            { x: 730, kind: 'solid', a: 'capture_ok saved', b: 'state CAPTURED, intent cleared' },
            { x: 930, kind: 'solid', a: 'begin_void saved', b: 'every other hold targeted' },
            { x: 1090, kind: 'solid', a: 'all_released saved', b: 'state SETTLED' },
          ].map((t) => (
            <g key={t.x}>
              {t.kind === 'solid' && <rect x={t.x - 9} y={662} width={18} height={20} className="fill-solid" />}
              {t.kind === 'hatch' && <rect x={t.x - 9} y={662} width={18} height={20} fill={hatch(p)} className="fill-hatch-edge" />}
              {t.kind === 'hollow' && <rect x={t.x - 9} y={662} width={18} height={20} className="fill-hollow" />}
              <T x={t.x} y={700} anchor="middle" cls="t-small">{t.a}</T>
              <T x={t.x} y={715} anchor="middle" cls="t-small t-muted">{t.b}</T>
            </g>
          ))}

          <Legend p={p} x={30} y={38} />
          <T x={1170} y={50} anchor="end" cls="t-small t-muted">brass top rule: a state where money moves</T>
        </>
      )}
    />
  );
}
