'use client';

import { Chip } from '@/components/holdline/chip';
import { DiagramFrame } from './frame';
import { StepControls, stepStyle, useSteps } from './interactive';
import { Badge, Defs, Node, T, hatch } from './kit';

// D7. Idempotency and request ids. Everything drawn comes from:
//   packages/payments/src/requestId.ts          buildRequestId: five parts, JSON array, SHA-256, base32, "gv1-" + 40
//   packages/payments/src/saga/capture.ts        the write-ahead intent is reused, so a resume repeats the id
//   packages/payments/src/transport.ts           4 attempts, 10 s timeout, full jitter 250 ms to 4 s, same header
//   packages/payments/src/saga/reauth.ts         generation + 1 for a reauthorization
//   packages/payments/src/fake/idempotency.ts    replay and conflict in the fake
// The example id is computed from made-up parts (auction auc1, hold hold-1, 35000 cents).
const EXAMPLE = 'gv1-N6WFTAIWCCILC45XMRS4ZE3E535MCVQCA5WCJ4JG';
const SHORT = 'gv1-N6WFTAIW...WCJ4JG';

const PARTS: [string, string][] = [
  ['auctionId', 'auc1'],
  ['op', 'capture'],
  ['holdId', 'hold-1'],
  ['amountCents', '35000'],
  ['generation', '0'],
];

const STAGES = [
  {
    title: 'Intent saved',
    sub: 'journal, before the call',
    id: SHORT,
    same: true,
    lines: ['id built once, generation 0', 'saved with the amount, then sent', 'write-ahead: no save, no call'],
  },
  {
    title: 'Retry in the transport',
    sub: 'one logical request',
    id: SHORT,
    same: true,
    lines: ['network error, 429, 500, 502, 503, 504:', 'up to 4 attempts, 10 s each,', 'backoff random(0, min(4 s, 250 ms x 2^n))', 'same PayPal-Request-Id on every attempt'],
  },
  {
    title: 'Restart and resume',
    sub: 'process died mid-call',
    id: SHORT,
    same: true,
    lines: ['saved intent is reused, id repeats', 'truth is read first: a capture', 'already there is adopted, not sent again'],
  },
  {
    title: 'A different call',
    sub: 'parameters changed',
    id: 'gv1-O4ZTTPFJ...CMIZP',
    same: false,
    lines: ['other amount, hold or operation:', 'a different id', 'reauthorization: generation + 1', 'never on retry or resume'],
  },
];

const LABELS = [
  <>
    <b>The id is a fingerprint of the call.</b> Five parts are hashed as a JSON array, so no two different calls can
    share an input. File: <code>packages/payments/src/requestId.ts</code>. The example uses made-up parts.
  </>,
  <>
    <b>1. Save the intent first.</b> The capture saves its intent, with the request id, before it calls PayPal. File:{' '}
    <code>packages/payments/src/saga/capture.ts</code>.
  </>,
  <>
    <b>2. Retries repeat the id.</b> The transport sends every attempt of one request with the same header, with
    exponential backoff and full jitter. File: <code>packages/payments/src/transport.ts</code>.
  </>,
  <>
    <b>3. A restart repeats it too.</b> The resume finds the saved intent and sends the same id. It reads the truth
    before it sends anything, because an id only helps if PayPal remembers it.
  </>,
  <>
    <b>4. Only a changed call changes the id.</b> A reauthorization uses the next generation number; the capture,
    void and authorize ids stay at generation 0.
  </>,
];

export function IdempotencyDiagram() {
  const steps = useSteps(5, 4);
  return (
    <DiagramFrame
      title="Request ids: one call, one id, however many tries"
      desc="Top: five parts (auction id, operation, hold id, amount in cents, generation) are hashed as a JSON array with SHA-256, written in base32, cut to 40 characters and prefixed gv1-, giving a 44 character id. Below, four stages: the intent is saved with the id before the call; the transport retries with the same id; a restart reuses the saved id after reading the truth; a changed amount, hold or operation, or the next reauthorization generation, gives a different id. At the bottom, what PayPal does with a repeated id: the sandbox answered a second capture send with the same capture, the fake replays or reports a conflict, and the truth read protects against a forgotten id."
      width={1200}
      height={640}
      badge={
        <>
          <Chip kind="sandbox">Sandbox: R5 repeat capture</Chip>
          <Chip kind="fake">Fake: replay and conflict</Chip>
        </>
      }
      toolbar={<StepControls steps={steps} labels={LABELS} title="Step" />}
      caption={
        <>
          Read from <code>packages/payments/src/requestId.ts</code>, <code>transport.ts</code>,{' '}
          <code>saga/capture.ts</code>, <code>saga/reauth.ts</code> and <code>fake/idempotency.ts</code>. The sandbox
          nightly run 42200708552 recorded spec R5: a second capture send answered 200 with the same capture. How long
          PayPal remembers a request id has not been measured here. The crash variants with a forgotten id table are the
          simulated scenario S6.
        </>
      }
      transcript={
        <>
          <p>Derivation: auction id, operation (order, authorize, capture, void or reauth), hold id, amount in cents and generation are put in a JSON array, hashed with SHA-256, written in base32, cut to 40 characters and prefixed gv1-. The example {EXAMPLE} comes from made-up parts.</p>
          <ol>
            <li>Intent saved: the capture intent, with the id, is saved in the journal before the PayPal call.</li>
            <li>Retry: the transport makes up to 4 attempts with a 10 second timeout each and full-jitter backoff from 250 ms to 4 s, all with the same PayPal-Request-Id.</li>
            <li>Restart: the saved intent is reused, so the id repeats; the truth is read first and a capture already there is adopted.</li>
            <li>A different call: another amount, hold or operation gives another id; a reauthorization uses generation + 1.</li>
          </ol>
          <p>PayPal sandbox: a second capture send answered 200 with the same capture (R5). Fake PayPal: the same operation, id and request id with equal parameters replays the stored result; different parameters conflict, which the saga treats as an invariant fault and sends to review. If the id table is forgotten the retry would run again, so the saga reads the truth first.</p>
        </>
      }
      render={(p) => (
        <>
          <Defs p={p} />
          <rect x={0} y={0} width={1200} height={640} style={{ fill: 'var(--hl-bg)' }} />

          {/* derivation */}
          <T x={14} y={24} cls="t-big">buildRequestId(parts)</T>
          {PARTS.map(([k, v], i) => (
            <g key={k}>
              <rect x={14 + i * 172} y={40} width={162} height={46} rx={2} className="node" />
              <T x={14 + i * 172 + 81} y={59} anchor="middle" cls="t-small t-muted">{k}</T>
              <T x={14 + i * 172 + 81} y={77} anchor="middle" cls="t-big">{v}</T>
            </g>
          ))}
          <path d="M440 90 V112" className="edge" markerEnd={`url(#${p}-arrow)`} />
          <Node x={14} y={112} w={210} h={48} label="JSON array" sub="[auc1,capture,...]" />
          <path d="M224 136 H254" className="edge-thick" markerEnd={`url(#${p}-arrow-dark)`} />
          <Node x={254} y={112} w={210} h={48} label="SHA-256" sub="32 bytes" />
          <path d="M464 136 H494" className="edge-thick" markerEnd={`url(#${p}-arrow-dark)`} />
          <Node x={494} y={112} w={210} h={48} label="base32" sub="first 40 characters" />
          <path d="M704 136 H734" className="edge-thick" markerEnd={`url(#${p}-arrow-dark)`} />
          <Node x={734} y={112} w={210} h={48} label={'"gv1-" + 40'} sub="44 characters" money />
          <rect x={14} y={176} width={930} height={30} rx={2} fill={hatch(p)} className="fill-hatch-edge" />
          <rect x={22} y={181} width={914} height={20} style={{ fill: 'var(--hl-panel)' }} />
          <T x={479} y={196} anchor="middle" cls="t-big">{EXAMPLE}</T>
          <T x={960} y={196} cls="t-small t-muted">example from made-up parts</T>

          <line x1={14} y1={232} x2={1186} y2={232} className="guide" />

          {/* stages */}
          {STAGES.map((s, i) => {
            const x = 14 + i * 300;
            return (
              <g key={s.title} style={stepStyle(steps, i + 1)}>
                <Badge x={x} y={248} n={i + 1} />
                <Node x={x} y={274} w={270} h={56} label={s.title} sub={s.sub} />
                <rect x={x} y={344} width={270} height={26} rx={2} fill={s.same ? hatch(p) : 'none'} className={s.same ? 'fill-hatch-edge' : 'fill-hollow'} />
                <rect x={x + 6} y={348} width={258} height={18} style={{ fill: 'var(--hl-panel)' }} />
                <T x={x + 135} y={361} anchor="middle" cls={`t-small ${s.same ? '' : 't-ink'}`}>{s.same ? `same id: ${s.id}` : `new id: ${s.id}`}</T>
                {s.lines.map((l, j) => (
                  <T key={l} x={x + 2} y={392 + j * 16} cls="t-small t-muted">{l}</T>
                ))}
                {i < STAGES.length - 1 && <path d={`M${x + 270} 302 H${x + 300}`} className="edge-thick" markerEnd={`url(#${p}-arrow-dark)`} />}
              </g>
            );
          })}

          <line x1={14} y1={478} x2={1186} y2={478} className="guide" />
          <T x={14} y={502} cls="t-big">What happens to a repeated id</T>
          <g style={stepStyle(steps, 2)}>
            <rect x={14} y={516} width={380} height={108} className="panel" />
            <T x={26} y={538} cls="t-ink">PayPal sandbox (R5)</T>
            <T x={26} y={558} cls="t-small">second capture send with the same id:</T>
            <T x={26} y={574} cls="t-small">HTTP 200, the same capture.</T>
            <T x={26} y={594} cls="t-small t-muted">retention time of an id: not measured</T>
            <rect x={410} y={516} width={380} height={108} className="panel" />
            <T x={422} y={538} cls="t-ink">Fake PayPal</T>
            <T x={422} y={558} cls="t-small">same id, same parameters: stored result</T>
            <T x={422} y={574} cls="t-small">replayed. Same id, other parameters:</T>
            <T x={422} y={590} cls="t-small">conflict, which the saga sends to review.</T>
            <rect x={806} y={516} width={380} height={108} className="panel" />
            <T x={818} y={538} cls="t-ink">The id is not the only guard</T>
            <T x={818} y={558} cls="t-small">If the id table is forgotten the retry runs</T>
            <T x={818} y={574} cls="t-small">again, so the saga reads the truth first.</T>
            <T x={818} y={594} cls="t-small t-muted">simulated: S6 ends with one charge</T>
          </g>
        </>
      )}
    />
  );
}
