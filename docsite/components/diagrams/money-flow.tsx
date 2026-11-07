'use client';

import { Chip } from '@/components/holdline/chip';
import { repoData, usd } from '@/lib/repo-data';
import { DiagramFrame } from './frame';
import { Badge, Defs, Legend, T, hatch } from './kit';

// D2. Where the money is at each moment. The flow follows packages/payments: a hold is an
// AUTHORIZE order (holds/), capture uses final_capture with the winning price (saga/capture.ts),
// the winner's remainder is closed by PayPal after a final capture (saga/remainder.ts, mode A,
// release inferred in G1) and every other hold is voided (saga/void.ts).
const cols = { t0: 300, t1: 470, t2: 640, t3: 810, t4: 980 };

export function MoneyFlowDiagram() {
  const s = repoData.sim.s8;
  return (
    <DiagramFrame
      title="Money flow: holds, capture and void"
      desc="Three bidders approve holds at T0: A for 500 dollars, B for 300 and C for 200. A bids 350 at T1 and wins at the hammer at T2. At T3 GAVEL captures 350 dollars from A with final capture and PayPal closes the remaining 150 dollars. At T4 the holds of B and C are voided. Charged 350 plus released 150, 300 and 200 equals the 1000 dollars held in total."
      width={1200}
      height={700}
      badge={<Chip kind="sandbox">G1 on sandbox</Chip>}
      caption={
        <>
          G1 (partial capture with <code>final_capture</code>) passed on the real PayPal sandbox for two
          PayPal-account buyers. That the remainder is released is inferred (the authorization reads
          CAPTURED and a later void answers 422 PREVIOUSLY_CAPTURED), not read from a buyer balance.
          Settlement of a whole auction was run on the fake PayPal. The three bidders and their
          ceilings are round illustration numbers.
        </>
      }
      transcript={
        <>
          <ol>
            <li>T0 Approve: three bidders approve holds. A holds $500, B $300, C $200. A hold is an authorization, nothing is charged.</li>
            <li>T1 Bid: A bids $350. The engine accepts it and the ledger appends a hash-chained event.</li>
            <li>T2 Hammer: A wins at $350.</li>
            <li>T3 Capture: GAVEL reads the truth of A&apos;s hold, then captures $350 with final_capture. PayPal closes the remaining $150 (inferred in gate G1).</li>
            <li>T4 Void: the holds of B ($300) and C ($200) are voided. The journal closes.</li>
          </ol>
          <p>
            Invariant: charged $350 + released $150 + $300 + $200 = $1000 held. In the 30 day simulation the same equality holds on
            larger totals: held {usd(s.heldCents)} = captured {usd(s.capturedCents)} + released {usd(s.releasedCents)} + open {usd(s.openCents)}.
          </p>
        </>
      }
      render={(p) => (
        <>
          <Defs p={p} />
          <rect x={0} y={0} width={1200} height={700} style={{ fill: 'var(--hl-bg)' }} />

          {/* lanes */}
          <rect x={20} y={70} width={1160} height={80} className="panel" />
          <rect x={20} y={150} width={1160} height={100} className="panel panel-2" />
          <rect x={20} y={250} width={1160} height={230} className="panel" />
          <T x={34} y={96} cls="t-small t-ink">BIDDER</T>
          <T x={34} y={176} cls="t-small t-ink">GAVEL</T>
          <T x={34} y={276} cls="t-small t-ink">PAYPAL SANDBOX</T>

          {/* moments */}
          {[
            ['T0', 'Approve', cols.t0],
            ['T1', 'Bid', cols.t1],
            ['T2', 'Hammer', cols.t2],
            ['T3', 'Capture', cols.t3],
            ['T4', 'Void', cols.t4],
          ].map(([id, name, x]) => (
            <g key={String(id)}>
              <T x={Number(x)} y={44} anchor="middle" cls="t-big">{`${id} ${name}`}</T>
              <line x1={Number(x)} y1={58} x2={Number(x)} y2={480} className="guide-dash" />
            </g>
          ))}

          {/* bidder lane */}
          <T x={cols.t0} y={104} anchor="middle" cls="t-small">approve a ceiling</T>
          <T x={cols.t0} y={120} anchor="middle" cls="t-small t-muted">(a PayPal order, AUTHORIZE)</T>
          <T x={cols.t1} y={112} anchor="middle" cls="t-small">A bids $350</T>

          {/* gavel lane */}
          <T x={cols.t1} y={196} anchor="middle" cls="t-small">engine accepts,</T>
          <T x={cols.t1} y={212} anchor="middle" cls="t-small">ledger appends</T>
          <T x={cols.t2} y={196} anchor="middle" cls="t-small">hammer:</T>
          <T x={cols.t2} y={212} anchor="middle" cls="t-small">A wins at $350</T>
          <T x={cols.t3} y={188} anchor="middle" cls="t-small">truth read, then</T>
          <T x={cols.t3} y={204} anchor="middle" cls="t-small">capture $350</T>
          <T x={cols.t3} y={220} anchor="middle" cls="t-small">final_capture</T>
          <T x={cols.t4} y={196} anchor="middle" cls="t-small">void B and C,</T>
          <T x={cols.t4} y={212} anchor="middle" cls="t-small">journal closes</T>

          {/* bidder A: $500 ceiling, 50px */}
          <T x={178} y={310} cls="t-small">A  ceiling $500</T>
          <rect x={cols.t0} y={285} width={cols.t3 - cols.t0} height={50} fill={hatch(p)} className="fill-hatch-edge" />
          <rect x={cols.t3} y={285} width={250} height={35} className="fill-solid" />
          <rect x={cols.t3} y={320} width={250} height={15} className="fill-hollow" />
          <T x={1068} y={306} cls="t-small t-go">charged $350</T>
          <T x={1068} y={330} cls="t-small t-muted">$150 closed</T>

          {/* bidder B: $300, 30px */}
          <T x={178} y={384} cls="t-small">B  ceiling $300</T>
          <rect x={cols.t0} y={365} width={cols.t4 - cols.t0} height={30} fill={hatch(p)} className="fill-hatch-edge" />
          <rect x={cols.t4} y={365} width={80} height={30} className="fill-hollow" />
          <T x={1068} y={385} cls="t-small t-muted">released $300</T>

          {/* bidder C: $200, 20px */}
          <T x={178} y={440} cls="t-small">C  ceiling $200</T>
          <rect x={cols.t0} y={425} width={cols.t4 - cols.t0} height={20} fill={hatch(p)} className="fill-hatch-edge" />
          <rect x={cols.t4} y={425} width={80} height={20} className="fill-hollow" />
          <T x={1068} y={440} cls="t-small t-muted">released $200</T>

          <T x={178} y={466} cls="t-small t-muted">bar height is the dollar amount</T>

          {/* annotations */}
          {[
            { x: 30, a: 'A hold is an authorization,', b: 'not a payment. Nothing is charged at T0.' },
            { x: 420, a: 'Only the winning price is captured:', b: '$350, not the $500 ceiling.' },
            { x: 810, a: 'PayPal webhooks and a truth read', b: 'confirm each step (signatures: G4 PASS).' },
          ].map((n, i) => (
            <g key={n.x}>
              <Badge x={n.x} y={506} n={i + 1} />
              <T x={n.x + 30} y={520} cls="t-small">{n.a}</T>
              <T x={n.x + 30} y={536} cls="t-small t-muted">{n.b}</T>
            </g>
          ))}

          {/* balance line */}
          <rect x={20} y={560} width={1160} height={84} className="panel" />
          <rect x={34} y={576} width={22} height={12} className="fill-solid" />
          <T x={62} y={587} cls="t-small">charged 350</T>
          <T x={150} y={587} cls="t-small">+</T>
          <rect x={166} y={576} width={22} height={12} className="fill-hollow" />
          <T x={194} y={587} cls="t-small">released 150 + 300 + 200</T>
          <T x={380} y={587} cls="t-small">=</T>
          <rect x={398} y={576} width={22} height={12} fill={hatch(p)} className="fill-hatch-edge" />
          <T x={426} y={587} cls="t-small">held 500 + 300 + 200 = 1000 dollars</T>
          <T x={34} y={612} cls="t-small t-muted">
            {`The 30 day simulation keeps the same equality on its own totals: held ${usd(s.heldCents)} = captured ${usd(s.capturedCents)} + released ${usd(s.releasedCents)} + open ${usd(s.openCents)}.`}
          </T>
          <T x={34} y={632} cls="t-small t-muted">That run is SIMULATED (fake PayPal, fake clock). See the proof pages.</T>

          <Legend p={p} x={30} y={662} />
        </>
      )}
    />
  );
}
