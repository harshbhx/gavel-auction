'use client';

import { Chip } from '@/components/holdline/chip';
import { repoData, usd } from '@/lib/repo-data';
import { DiagramFrame } from './frame';
import { Defs, Legend, T, hatch } from './kit';

// D4. The multi-day simulation. Scenario days come from the scenario notes in
// docs/evidence/SIM/SIM-MULTIDAY.md; every count and every dollar figure is read from that file
// by scripts/gen-repo-data.mjs. Per-day fault positions are random in S8 and are not in the file,
// so they are not drawn.
const X0 = 300;
const PX = 25;
const dx = (d: number) => X0 + d * PX;

type Row = {
  id: string;
  label: string;
  hold: [number, number];
  capture?: number[];
  reauth?: number[];
  crash?: number;
  released?: number[];
};

const rows: Row[] = [
  { id: 'S1', label: 'hold day 0, capture day 1', hold: [0, 1], capture: [1] },
  { id: 'S2', label: 'close day 2.5, inside honor period', hold: [0, 2.5], capture: [2.5] },
  { id: 'S3', label: 'capture day 3.5, reauthorized', hold: [0, 3.5], capture: [3.5], reauth: [3.5] },
  { id: 'S4', label: 'reauth day 3, capture day 5', hold: [0, 5], capture: [5], reauth: [3.04] },
  { id: 'S5', label: 'never reauthorized, day 30', hold: [0, 30], capture: [30], released: [32] },
  { id: 'S6', label: 'crash and restart at day 2', hold: [0, 2], capture: [2.25], crash: 2 },
  { id: 'S7', label: 'late expiry webhook, day 31', hold: [0, 29], reauth: [3.5], released: [29, 31] },
  { id: 'S8', label: '40 lots, 100 bidders, crashes', hold: [0, 30], capture: [30] },
];

export function TimelineDiagram() {
  const s8 = repoData.sim.s8;
  const scn = (id: string) => repoData.sim.scenarios.find((s) => s.id === id);
  return (
    <DiagramFrame
      title="30 day simulated timeline"
      desc="Eight simulated scenarios on a day axis from day 0 to day 32, run on a fake PayPal with a fake clock. Each row shows holds as hatched bars and captures as solid blocks. Dashed lines mark the model's 3 day honor period and 29 day validity. The bottom shows the totals of scenario S8 and that the ledger balances. This is a simulation, not real traffic and not the PayPal sandbox."
      width={1200}
      height={680}
      badge={<Chip kind="hatched">SIMULATED</Chip>}
      caption={
        <>
          What this shows: the settlement code kept its invariants under injected crashes and faults, on a
          model of PayPal. What it does not show: real PayPal behaviour over days. That is gate G3, still
          in progress. The honor period (3 days) and validity (29 days) are assumptions of the model, not
          PayPal facts. Figures are read from <code>docs/evidence/SIM/SIM-MULTIDAY.md</code> (seed {s8.seed}).
        </>
      }
      transcript={
        <>
          <p>Everything here is simulated: a fake PayPal and a fake clock.</p>
          <ul>
            {rows.map((r) => (
              <li key={r.id}>
                {r.id}: {r.label}. {scn(r.id)?.checks} checks, {scn(r.id)?.result}.
              </li>
            ))}
          </ul>
          <p>
            S8 ran {s8.lotsSettled + s8.lotsInReview} lots: {s8.lotsSettled} settled, {s8.lotsInReview} in review. {s8.holds} holds, {s8.reauthorizeCalls} reauthorize calls,
            {' '}{s8.crashesSurvived} process crashes survived, {s8.faultsArmed} PayPal faults armed, {s8.fallbackLots} lots used the runner-up fallback,
            {' '}{s8.stormSettled} of {s8.stormLots} injected rate-limit storms settled after a restart.
          </p>
          <p>
            Ledger: held {usd(s8.heldCents)} = captured {usd(s8.capturedCents)} + released {usd(s8.releasedCents)} + open {usd(s8.openCents)}.
          </p>
        </>
      }
      render={(p) => (
        <>
          <Defs p={p} />
          <rect x={0} y={0} width={1200} height={680} style={{ fill: 'var(--hl-bg)' }} />

          {/* banner: hatched, so it reads as pencilled in */}
          <rect x={20} y={14} width={1160} height={38} fill={hatch(p)} className="fill-hatch-edge" />
          <rect x={300} y={20} width={600} height={26} style={{ fill: 'var(--hl-panel)' }} />
          <T x={600} y={38} anchor="middle" cls="t-big">SIMULATED: fake PayPal, fake clock. Not real traffic, not sandbox.</T>

          {/* axis */}
          <line x1={X0} y1={92} x2={dx(32)} y2={92} className="edge" />
          {Array.from({ length: 33 }, (_, d) => (
            <g key={d}>
              <line x1={dx(d)} y1={d % 4 === 0 ? 86 : 89} x2={dx(d)} y2={92} className="edge" />
              {d % 4 === 0 && (
                <T x={dx(d)} y={78} anchor="middle" cls="t-small t-muted">{`Day ${d}`}</T>
              )}
            </g>
          ))}

          {/* model guides */}
          <line x1={dx(3)} y1={96} x2={dx(3)} y2={476} className="guide-dash" />
          <T x={dx(3) + 4} y={108} cls="t-small t-muted">honor period ends, day 3 (model)</T>
          <line x1={dx(29)} y1={96} x2={dx(29)} y2={476} className="guide-dash" />
          <T x={dx(29) - 4} y={108} anchor="end" cls="t-small t-muted">valid until day 29 (model)</T>

          {rows.map((r, i) => {
            const y = 124 + i * 42;
            const c = y + 14;
            const sc = scn(r.id);
            return (
              <g key={r.id}>
                <line x1={20} y1={y + 36} x2={1180} y2={y + 36} className="guide" />
                <T x={20} y={c + 4} cls="t-small"><tspan style={{ fontWeight: 800 }}>{r.id}</tspan>{`  ${r.label}`}</T>
                <rect x={dx(r.hold[0])} y={c - 7} width={(r.hold[1] - r.hold[0]) * PX} height={14} fill={hatch(p)} className="fill-hatch-edge" />
                {r.reauth?.map((d) => (
                  <path key={`ra${d}`} d={`M${dx(d)} ${c - 12} l7 12 l-7 12 l-7 -12 z`} className="fill-hollow" style={{ fill: 'var(--hl-bg)' }} />
                ))}
                {r.capture?.map((d) => (
                  <rect key={`cp${d}`} x={dx(d) - 5} y={c - 10} width={10} height={20} className="fill-solid" />
                ))}
                {r.released?.map((d) => (
                  <rect key={`rl${d}`} x={dx(d) - 5} y={c - 10} width={10} height={20} className="fill-hollow" />
                ))}
                {r.crash !== undefined && (
                  <path d={`M${dx(r.crash) - 7} ${c - 7} l14 14 m0 -14 l-14 14`} style={{ stroke: 'var(--hl-stop)', strokeWidth: 2.5 }} />
                )}
                <T x={1190} y={c + 4} anchor="end" cls="t-small t-muted">{sc ? `${sc.checks} ${sc.result}` : ''}</T>
              </g>
            );
          })}
          <T x={dx(0)} y={494} cls="t-small t-muted">diamond: reauthorize. cross: process crash. solid: capture. hollow block: hold released or expired. hatched bar: hold open.</T>

          {/* S8 totals and invariant */}
          <rect x={20} y={510} width={1160} height={112} className="panel" />
          <T x={36} y={534} cls="t-small t-ink">S8 TOTALS (read from SIM-MULTIDAY.md)</T>
          <T x={36} y={556} cls="t-small">{`${s8.lotsSettled + s8.lotsInReview} lots, 100 bidders: ${s8.lotsSettled} settled, ${s8.lotsInReview} in review. ${s8.holds} holds, ${s8.reauthorizeCalls} reauthorize calls, ${s8.crashesSurvived} crashes survived, ${s8.faultsArmed} PayPal faults armed.`}</T>
          <T x={36} y={574} cls="t-small">{`${s8.fallbackLots} lots used the runner-up. ${s8.stormSettled} of ${s8.stormLots} injected rate-limit storms settled after a restart.`}</T>
          <rect x={36} y={588} width={16} height={16} className="fill-solid" />
          <T x={60} y={601} cls="t-small t-go">balances to the cent</T>
          <T x={216} y={601} cls="t-small">{`held ${usd(s8.heldCents)} = captured ${usd(s8.capturedCents)} + released ${usd(s8.releasedCents)} + open ${usd(s8.openCents)}`}</T>
          <T x={36} y={616} cls="t-small t-muted">Fault positions inside the 30 days are random (seed {s8.seed}) and are not in the file, so they are not drawn.</T>

          <Legend p={p} x={30} y={644} />
        </>
      )}
    />
  );
}
