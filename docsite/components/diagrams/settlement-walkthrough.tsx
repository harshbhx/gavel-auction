'use client';

import { useState } from 'react';
import { Chip } from '@/components/holdline/chip';
import { DiagramFrame } from './frame';
import { StepControls, useSteps, type Steps } from './interactive';
import { Defs, Legend, Node, T, hatch } from './kit';

// D. Settlement walkthrough: one winner, three holds, integer cents. Read from:
//   packages/payments/src/saga/plan.ts        the plan: candidates in the engine's order at the engine's prices
//   packages/payments/src/saga/capture.ts     write-ahead intent, capture(final), definite failure and the truth check
//   packages/payments/src/saga/fallback.ts    the next candidate at its own planned price
//   packages/payments/src/saga/remainder.ts   the winner's remainder (G1 decision A: closed by PayPal, release inferred)
//   packages/payments/src/saga/void.ts        every hold except the winner's is voided, sorted by bidder id
//   packages/payments/src/saga/machine.ts     the state names
// The numbers are those of nightly sandbox spec R7 (packages/e2e/sandbox/r5-r8.spec.ts): three holds of
// 20000 cents, prices 12500, 11000 and 10000, winner captured 12500, saga SETTLED, journal against PayPal
// 0 differences. The fallback branch has been run only against the fake PayPal.

type Kind = 'held' | 'charged' | 'released';
type Seg = { kind: Kind; cents: number };
type Scenario = 'sale' | 'fallback';

const CEIL = 20000;
const PRICE: Record<string, number> = { A: 12500, B: 11000, C: 10000 };
const IDS = ['A', 'B', 'C'] as const;
const X0 = 150;
const PX = 0.026; // pixels per cent: 20000 cents = 520 px

const rest = (kind: Kind): Seg[] => [{ kind, cents: CEIL }];

function segments(scn: Scenario, s: number): Record<string, Seg[]> {
  const out: Record<string, Seg[]> = { A: rest('held'), B: rest('held'), C: rest('held') };
  const winner = scn === 'sale' ? 'A' : 'B';
  const price = PRICE[winner] ?? 0;
  if (s >= 3) {
    const tail: Kind = s >= 4 ? 'released' : 'held';
    out[winner] = [
      { kind: 'charged', cents: price },
      { kind: tail, cents: CEIL - price },
    ];
  }
  if (s >= 5) {
    for (const id of IDS) if (id !== winner) out[id] = rest('released');
  }
  return out;
}

function totals(segs: Record<string, Seg[]>): Record<Kind, number> {
  const t: Record<Kind, number> = { held: 0, charged: 0, released: 0 };
  for (const id of IDS) for (const g of segs[id] ?? []) t[g.kind] += g.cents;
  return t;
}

const STATE: Record<Scenario, string[]> = {
  sale: ['BIDDING', 'WINNER_SELECTED', 'CAPTURING', 'CAPTURED', 'CAPTURED', 'VOIDING', 'SETTLED'],
  fallback: [
    'BIDDING',
    'WINNER_SELECTED',
    'CAPTURING (A refused)',
    'FALLBACK_RUNNER_UP > CAPTURED',
    'CAPTURED',
    'VOIDING',
    'SETTLED',
  ],
};

const JOURNAL: Record<Scenario, string[]> = {
  sale: [
    'plan saved: candidates A 12500, B 11000, C 10000; holds A, B, C of 20000 each',
    'intent saved before the call: capture, hold A, 12500, request id gv1-...',
    'capture_ok: CAPTURED (intent cleared, capture id kept)',
    'remainder:A recorded remainder_closed_by_paypal (release inferred, no void sent)',
    'voids: B voided, C voided (sorted by bidder id, three at a time at most)',
    'all_released: SETTLED',
  ],
  fallback: [
    'plan saved: candidates A 12500, B 11000, C 10000; holds A, B, C of 20000 each',
    'intent saved: capture, hold A, 12500; PayPal refuses it for good (definite failure)',
    'truth read: no capture on A. definite_fail, next_candidate: B at its own price 11000, capture_ok',
    'remainder:B recorded remainder_closed_by_paypal (release inferred, no void sent)',
    'voids: A released, C voided (A is a failed candidate, not the winner)',
    'all_released: SETTLED',
  ],
};

const STEPS: Record<Scenario, { title: string; body: string }[]> = {
  sale: [
    { title: 'Three holds', body: 'Buyers A, B and C each hold 200.00 (20000 cents). Hatched means held: nothing is charged. The auction is still BIDDING.' },
    { title: 'Hammer: the plan', body: 'The engine hands over its candidates in order, each priced as if every earlier candidate were out: A at 12500, B at 11000, C at 10000. A candidate with no hold, or a price above its own hold, is left out of the plan. The plan is saved to the journal. State: WINNER_SELECTED.' },
    { title: 'Intent first', body: 'Before any PayPal call the saga saves the intent: capture, hold A, 12500, with a request id derived from those facts. Then it captures with final_capture true. Nothing has moved yet in the picture.' },
    { title: 'Capture the winner', body: 'PayPal answers the capture: 12500 of the 20000 is now charged (solid). The 7500 left on A is still shown as held until the next step. State: CAPTURED.' },
    { title: 'Check the remainder', body: 'The saga reads A again. With the final capture in place PayPal reports the authorization as CAPTURED, so the 7500 remainder counts as released and no void is sent. Release is inferred from that reading and from the G1 sandbox runs; no run read a buyer balance.' },
    { title: 'Void everyone else', body: 'B and C are not the winner: their authorizations are voided, each under its own fixed request id. State: VOIDING. A void answered "already voided" or "expired" counts as released.' },
    { title: 'Settled', body: 'Every hold is charged or released and the journal says SETTLED. The ledger balances: 12500 charged plus 47500 released is the 60000 that was held.' },
  ],
  fallback: [
    { title: 'Three holds', body: 'Same start: A, B and C each hold 20000 cents. The auction is BIDDING.' },
    { title: 'Hammer: the plan', body: 'Same plan: A at 12500, B at 11000, C at 10000, saved to the journal. State: WINNER_SELECTED.' },
    { title: 'A capture is refused', body: 'The saga saves the intent for A and sends the capture. PayPal refuses it for good (a definite failure that names this hold, such as a declined or expired authorization). An unknown answer would not do this: it would wait.' },
    { title: 'Truth check, then B at its own price', body: 'Before moving on, the saga reads A: no capture exists. It records the failure and moves to the next candidate, B, at B\'s own planned price of 11000, not at A\'s 12500 and not at B\'s ceiling. The capture succeeds. State: FALLBACK_RUNNER_UP, CAPTURING, CAPTURED.' },
    { title: 'Check the remainder', body: 'B\'s remainder (9000) is checked the same way: closed by PayPal after the final capture, release inferred, no void sent.' },
    { title: 'Void the others', body: 'A (a failed candidate) and C are released: voided, or already expired. State: VOIDING.' },
    { title: 'Settled', body: 'The ledger balances: 11000 charged plus 49000 released is the 60000 that was held. This branch ran against the fake PayPal only.' },
  ],
};

function Bar({ p, id, y, segs, step, scn }: { p: string; id: string; y: number; segs: Seg[]; step: number; scn: Scenario }) {
  let x = X0;
  const price = PRICE[id] ?? 0;
  const refused = scn === 'fallback' && id === 'A' && step >= 2 && step < 5;
  return (
    <g>
      <T x={30} y={y + 22} cls="t-big">
        {id}
      </T>
      <T x={56} y={y + 22} cls="t-small t-muted">
        hold {CEIL}
      </T>
      {segs.map((g, i) => {
        const w = g.cents * PX;
        const r = (
          <rect
            key={i}
            x={x}
            y={y}
            width={w}
            height={34}
            fill={g.kind === 'held' ? hatch(p) : undefined}
            className={g.kind === 'held' ? 'fill-hatch-edge' : g.kind === 'charged' ? 'fill-solid' : 'fill-hollow'}
          />
        );
        const label = g.kind === 'charged' ? `charged ${g.cents}` : g.kind === 'released' ? `released ${g.cents}` : `held ${g.cents}`;
        const lx = x + w / 2;
        x += w;
        return (
          <g key={i}>
            {r}
            <rect x={lx - 5 * label.length * 0.62 - 4} y={y + 8} width={label.length * 6.2 + 8} height={18} rx={2} style={{ fill: 'var(--hl-panel)' }} />
            <T x={lx} y={y + 21} anchor="middle" cls="t-small">
              {label}
            </T>
          </g>
        );
      })}
      {step >= 1 && (
        <g>
          <line x1={X0 + price * PX} y1={y - 8} x2={X0 + price * PX} y2={y + 42} className="guide-dash" />
          <T x={X0 + price * PX} y={y - 12} anchor="middle" cls="t-small t-ink">
            price {price}
          </T>
        </g>
      )}
      {refused && (
        <g>
          <polygon points={`${X0 + CEIL * PX - 18},${y + 34} ${X0 + CEIL * PX},${y + 34} ${X0 + CEIL * PX},${y + 16}`} className="fill-stop" />
          <T x={X0 + CEIL * PX + 10} y={y + 22} cls="t-small t-stop">
            capture refused
          </T>
        </g>
      )}
    </g>
  );
}

export function SettlementWalkthroughDiagram() {
  const steps: Steps = useSteps(7);
  const [scn, setScn] = useState<Scenario>('sale');
  const s = steps.index;
  const segs = segments(scn, s);
  const t = totals(segs);
  const lines = JOURNAL[scn];
  const shown = s; // journal line k appears at step k+1

  const btn = (id: Scenario, label: string) => (
    <button
      type="button"
      aria-pressed={scn === id}
      onClick={() => setScn(id)}
      className={`rounded-[2px] border px-2 py-1 font-mono text-[0.68rem] font-bold uppercase ${scn === id ? 'bg-fd-accent' : ''}`}
    >
      {label}
    </button>
  );

  return (
    <DiagramFrame
      title="Settlement walkthrough: three holds, one winner, integer cents"
      desc="Three horizontal bars show the holds of buyers A, B and C, each 20000 cents. The saga plans the settlement, captures the winner at the hammer price, checks the winner's remainder, voids the other holds and ends SETTLED. A second scenario shows the winner's capture refused for good, the runner-up charged at its own price, and the others released. A ledger shows held, charged and released cents that always add up to 60000."
      width={1100}
      height={660}
      minWidth={900}
      badge={
        <>
          <Chip kind="sandbox">Sale path: sandbox R7</Chip>
          <Chip kind="fake">Fallback: fake PayPal</Chip>
        </>
      }
      toolbar={
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[0.7rem] uppercase text-fd-muted-foreground">Scenario</span>
            {btn('sale', 'Winner is charged')}
            {btn('fallback', 'Winner capture refused')}
          </div>
          <StepControls
            steps={steps}
            labels={STEPS[scn].map((x) => (
              <span key={x.title}>
                <strong>{x.title}.</strong> {x.body}
              </span>
            ))}
          />
        </div>
      }
      caption={
        <>
          Plan, capture, fallback, remainder and void behaviour are read from{' '}
          <code>packages/payments/src/saga/plan.ts</code>, <code>capture.ts</code>, <code>fallback.ts</code>,{' '}
          <code>remainder.ts</code> and <code>void.ts</code>. The amounts are those of nightly sandbox spec R7 in{' '}
          <code>packages/e2e/sandbox/r5-r8.spec.ts</code> (three holds of 20000, prices 12500, 11000, 10000; winner
          captured 12500; saga SETTLED; 0 differences against PayPal). That the 7500 remainder is released is inferred
          (gate G1 decision A), not observed. The fallback branch has run against the fake PayPal only.
        </>
      }
      transcript={
        <>
          <p>Worked example, in cents. Three holds of 20000. Prices from the engine: A 12500, B 11000, C 10000.</p>
          <ol>
            {STEPS.sale.map((x) => (
              <li key={x.title}>
                <strong>{x.title}.</strong> {x.body}
              </li>
            ))}
          </ol>
          <p>Variant: the winner&apos;s capture is refused for good.</p>
          <ol>
            {STEPS.fallback.map((x) => (
              <li key={x.title}>
                <strong>{x.title}.</strong> {x.body}
              </li>
            ))}
          </ol>
        </>
      }
      render={(p) => (
        <>
          <Defs p={p} />
          <rect x={0} y={0} width={1100} height={660} style={{ fill: 'var(--hl-bg)' }} />
          <T x={30} y={34} cls="t-big">
            Three holds of 200.00, shown in cents
          </T>
          <T x={30} y={54} cls="t-small t-muted">
            bar length is proportional to cents; the dashed line marks each candidate&apos;s planned price
          </T>

          {IDS.map((id, i) => (
            <Bar key={id} p={p} id={id} y={110 + i * 80} segs={segs[id] ?? []} step={s} scn={scn} />
          ))}

          {/* saga state and ledger */}
          <T x={730} y={92} cls="t-small t-muted">
            Saga state
          </T>
          <Node x={730} y={100} w={340} h={48} label={STATE[scn][s] ?? ''} kind={s === 6 ? 'term' : 'node'} money={s >= 2 && s <= 4} />
          <T x={730} y={186} cls="t-small t-muted">
            Ledger (cents)
          </T>
          <rect x={730} y={194} width={340} height={96} rx={2} className="panel" />
          <T x={744} y={218}>held</T>
          <T x={1056} y={218} anchor="end">{t.held}</T>
          <T x={744} y={244}>charged</T>
          <T x={1056} y={244} anchor="end">{t.charged}</T>
          <T x={744} y={270}>released</T>
          <T x={1056} y={270} anchor="end">{t.released}</T>
          <line x1={744} y1={278} x2={1056} y2={278} className="guide" />
          <T x={744} y={286} cls="t-small t-muted">total</T>
          <T x={1056} y={286} anchor="end" cls="t-small t-muted">{t.held + t.charged + t.released}</T>

          {/* journal */}
          <T x={30} y={376} cls="t-small t-muted">
            Journal: each line is one compare-and-set save, written before the next effect
          </T>
          <rect x={30} y={386} width={1040} height={200} rx={2} className="panel" />
          {lines.map((l, i) => (
            <g key={i} style={{ opacity: shown > i ? 1 : 0.18 }}>
              <T x={44} y={412 + i * 28} cls="t-small t-muted">
                {i + 1}
              </T>
              <T x={64} y={412 + i * 28} cls="t-small">
                {l}
              </T>
            </g>
          ))}
          <Legend p={p} x={30} y={620} />
        </>
      )}
    />
  );
}
