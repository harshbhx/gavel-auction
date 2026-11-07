'use client';

import { useState, type ReactNode } from 'react';
import { GateBadge } from '@/components/holdline/chip';
import { gateById, repoData } from '@/lib/repo-data';
import { DiagramFrame } from './frame';
import { DetailPanel, useHot } from './interactive';
import { Defs, T, hatch } from './kit';

// D15. Evidence map: each claim, its status, what it ran on and the file or workflow behind it.
// Gate statuses (G0 to G5) are read from docs/GATES.md at build time (lib/repo-data.ts), so this
// map cannot disagree with the gates page. The limits quoted per row are the "Scope", "Verdict"
// and "Evidence" lines of docs/GATES.md and the "does not prove" lists of the SIM and nightly
// entries. Every path listed here exists on main; the build of this page was written against:
//   docs/GATES.md, docs/evidence/{G1,G2,G4,SIM,nightly}, docs/SECURITY-REVIEW.md, docs/A11Y.md,
//   .github/workflows/{gate-g0,gate-g3,gate-g3-early,voice-eval,sim-multiday,nightly-sandbox,
//   measure-sandbox,gitleaks-history,judge-smoke,uptime}.yml, packages/*/test.

const codeUrl = (path: string) => `https://github.com/harshbhx/gavel-auction/blob/main/${path}`;

export type EvStatus = 'PASS' | 'FAIL' | 'PARTIAL' | 'IN PROGRESS' | 'SIMULATED' | 'OPEN' | 'CI';

type Row = {
  id: string;
  claim: string;
  status: EvStatus;
  ranOn: string;
  evidence: string[];
  limit: ReactNode;
};

function gateStatus(id: string): EvStatus {
  const g = gateById(id);
  if (g.status === 'PASS') return 'PASS';
  if (g.status === 'FAIL') return 'FAIL';
  if (g.status === 'PARTIAL') return 'PARTIAL';
  return 'IN PROGRESS';
}

function rows(): Row[] {
  const wrong = repoData.speech.map((r) => Number(r.wrongAccept));
  const lo = Math.min(...wrong).toFixed(3);
  const hi = Math.max(...wrong).toFixed(3);
  return [
    {
      id: 'g0',
      claim: 'G0: the sandbox app signs in and creates an AUTHORIZE order',
      status: gateStatus('G0'),
      ranOn: 'PayPal sandbox',
      evidence: ['.github/workflows/gate-g0.yml'],
      limit: 'The only record is the run log of workflow gate-g0 (run 41815593520, 4 Nov). No evidence file is committed, so it is reported, not independently verifiable.',
    },
    {
      id: 'g1',
      claim: 'G1: a final capture closes the authorization',
      status: gateStatus('G1'),
      ranOn: 'PayPal sandbox',
      evidence: ['docs/evidence/G1/G1-20261104T231047Z.jsonl', 'docs/evidence/G1/G1-20261105T123116Z.jsonl'],
      limit: 'Two PayPal-account buyers. The authorization reads CAPTURED and the order COMPLETED. That the remainder is released is inferred, not read from a buyer balance (decision A).',
    },
    {
      id: 'g2',
      claim: 'G2: card and guest AUTHORIZE work in SDK v6',
      status: gateStatus('G2'),
      ranOn: 'PayPal sandbox',
      evidence: ['docs/evidence/G2/G2-20261105T115228Z.jsonl'],
      limit: 'AUTHORIZE only. Capture and void of the guest card authorization were not run.',
    },
    {
      id: 'g4',
      claim: 'G4: real webhooks verify through PayPal',
      status: gateStatus('G4'),
      ranOn: 'PayPal sandbox',
      evidence: ['docs/evidence/G4/G4-20261105T012205Z.jsonl', 'packages/payments/test/fixtures/webhooks'],
      limit: 'Six real deliveries answered SUCCESS. Rejection of a tampered event is covered against the fake only. Retry behaviour stays UNVERIFIED.',
    },
    {
      id: 'g3',
      claim: 'G3: honor period, validity window and reauthorize',
      status: gateStatus('G3'),
      ranOn: 'PayPal sandbox (real probe)',
      evidence: ['.github/workflows/gate-g3.yml', '.github/workflows/gate-g3-early.yml'],
      limit: 'In progress. Day 0 was 7 Nov 2026 03:06 UTC; checkpoints at 3.5, 4 and 5 days; the final reading is about 12 Nov 06:17 UTC. No result exists yet, so no claim is made.',
    },
    {
      id: 'g5',
      claim: 'G5: spoken bids are accurate enough to accept unconfirmed',
      status: gateStatus('G5'),
      ranOn: 'Recorded provider outputs, synthetic audio',
      evidence: ['docs/GATES.md', 'packages/voice/fixtures/stt-cache', 'packages/voice/fixtures/stt-cache-human', '.github/workflows/voice-eval.yml'],
      limit: `Wrong-accept ${lo} to ${hi} on 24 synthetic, noise-free clips per set (limit 0.05), for both providers, after fixes chosen on those same clips (the 15 hold-out clips only check for regressions). No real-room or noisy-room test. Spoken bids always go through the confirm prompt.`,
    },
    {
      id: 'sim',
      claim: '30 simulated days settle correctly, ledger balanced to the cent',
      status: 'SIMULATED',
      ranOn: 'Fake clock and fake PayPal',
      evidence: ['docs/evidence/SIM/SIM-MULTIDAY.md', 'packages/payments/test/simdays/multiday.test.ts', '.github/workflows/sim-multiday.yml'],
      limit: 'It runs our code against a model of PayPal rules. A pass says our code is right if PayPal follows the model, and says nothing about whether PayPal does. PayPal 29-day validity was not verified in the real sandbox.',
    },
    {
      id: 'nightly',
      claim: 'Nightly sandbox specs R1 to R10',
      status: 'OPEN',
      ranOn: 'PayPal sandbox',
      evidence: ['docs/evidence/nightly/NIGHTLY-42200708552.json', 'docs/evidence/nightly/NIGHTLY-42317068784.json', '.github/workflows/nightly-sandbox.yml'],
      limit: 'Run 42200708552 (6 Nov) report overall inconclusive: pass 7, fail 0, inconclusive 1, skipped 2. Reauthorize (R3) answered HTTP 422, so it proves nothing about G3. The staging restart spec was skipped.',
    },
    {
      id: 'latency',
      claim: 'Sandbox call latency, hammer to CAPTURED and SETTLED targets',
      status: 'OPEN',
      ranOn: 'PayPal sandbox, n=10',
      evidence: ['docs/GATES.md', '.github/workflows/measure-sandbox.yml'],
      limit: 'Per-call p50 and p95 were measured (run 42047543821, 5 Nov). The end to end targets stay UNVERIFIED: only the capture call was measured, in 10 samples.',
    },
    {
      id: 'saga',
      claim: 'The settlement saga resumes after a crash without a double capture',
      status: 'CI',
      ranOn: 'Fake PayPal',
      evidence: ['packages/payments/test/saga/crash.test.ts', 'packages/payments/test/saga/crashChain.test.ts', 'packages/payments/test/saga/machine.test.ts'],
      limit: 'Tests in CI against the fake PayPal. On the sandbox the nightly spec R10 recorded one in-process crash, not a killed server.',
    },
    {
      id: 'ledger',
      claim: 'The audit ledger is a hash chain',
      status: 'CI',
      ranOn: 'In process, no PayPal',
      evidence: ['packages/engine/src/ledger/chain.ts', 'packages/engine/test/chain.test.ts'],
      limit: 'A property of the code, checked by tests in CI. It makes edits detectable; it does not stop someone with write access from rewriting the whole chain.',
    },
    {
      id: 'webhook',
      claim: 'Webhooks are de-duplicated, ordered and verified before use',
      status: 'CI',
      ranOn: 'Fake PayPal',
      evidence: ['packages/payments/test/webhooks/dedupe.test.ts', 'packages/payments/test/webhooks/order.test.ts', 'packages/payments/test/webhooks/verify.test.ts'],
      limit: 'Against the fake. Only the signature check on real events is sandbox evidence (G4).',
    },
    {
      id: 'a11y',
      claim: 'Accessibility of the web app',
      status: 'CI',
      ranOn: 'Automated browser checks',
      evidence: ['docs/A11Y.md', 'packages/web/test/visual/a11y.spec.ts'],
      limit: 'Automated checks (axe) only. The screen-reader and 200 percent zoom passes are recorded in docs/A11Y.md as not yet performed.',
    },
    {
      id: 'secscan',
      claim: 'No secrets in the repository history',
      status: 'CI',
      ranOn: 'GitHub Actions scan',
      evidence: ['.github/workflows/gitleaks-history.yml'],
      limit: 'A scan job. Its latest result is read from the workflow run, not recorded in these docs.',
    },
    {
      id: 'sec',
      claim: 'Security checklist SEC-01 to SEC-18 signed off',
      status: 'OPEN',
      ranOn: 'Review by a second person',
      evidence: ['docs/SECURITY-REVIEW.md'],
      limit: 'Every item reads OPEN: nobody has signed an item off yet. Submission rules say no P0 item may be OPEN. The automated checks listed per item exist, but a sign-off is a person.',
    },
    {
      id: 'live',
      claim: 'The hosted app passes the nightly judge walkthrough',
      status: 'OPEN',
      ranOn: 'Not run',
      evidence: ['.github/workflows/judge-smoke.yml', '.github/workflows/uptime.yml'],
      limit: 'The workflow fails when JUDGE_URL is empty, so a run that tested nothing cannot look like a pass. The uptime probe is off until UPTIME_ENABLED is true. docs/GATES.md keeps staging security and load tests UNVERIFIED until a staging URL exists.',
    },
  ];
}

const ORDER: EvStatus[] = ['PASS', 'FAIL', 'PARTIAL', 'IN PROGRESS', 'SIMULATED', 'OPEN', 'CI'];

const MEANING: Record<EvStatus, string> = {
  PASS: 'a recorded sandbox run passed, with evidence',
  FAIL: 'a recorded run failed; the fallback is in force',
  PARTIAL: 'a run exists but does not close the gate question (for example synthetic data only)',
  'IN PROGRESS': 'a real run is under way; no result yet',
  SIMULATED: 'a simulation with a fake clock, not a PayPal result',
  OPEN: 'evidence exists but the claim is not concluded or not signed off',
  CI: 'checked by tests or workflows in CI; no recorded run in the docs',
};

const ROW_H = 46;
const TOP = 74;

function Pill({ x, y, status, p }: { x: number; y: number; status: EvStatus; p: string }) {
  const w = 126;
  const h = 26;
  const label = status;
  return (
    <g>
      {status === 'PASS' && <rect x={x} y={y} width={w} height={h} rx={2} className="fill-solid" />}
      {status === 'FAIL' && <rect x={x} y={y} width={w} height={h} rx={2} className="node-stop" />}
      {(status === 'IN PROGRESS' || status === 'PARTIAL') && <rect x={x} y={y} width={w} height={h} rx={2} fill={hatch(p)} className="fill-hatch-edge" />}
      {status === 'SIMULATED' && <rect x={x} y={y} width={w} height={h} rx={2} className="edge-dash" />}
      {status === 'OPEN' && <rect x={x} y={y} width={w} height={h} rx={2} className="fill-hollow" />}
      {status === 'CI' && <rect x={x} y={y} width={w} height={h} rx={2} className="panel-2" style={{ stroke: 'var(--hl-hairline)' }} />}
      {(status === 'IN PROGRESS' || status === 'PARTIAL') && <rect x={x + 8} y={y + 5} width={w - 16} height={h - 10} rx={1} style={{ fill: 'var(--hl-panel)' }} />}
      <text
        x={x + w / 2}
        y={y + 17.5}
        textAnchor="middle"
        className={status === 'FAIL' ? 't-stop' : undefined}
        style={{
          fontWeight: 800,
          fontSize: 12,
          ...(status === 'PASS' ? { fill: 'var(--hl-bg)' } : {}),
        }}
      >
        {label}
      </text>
      {status === 'FAIL' && <polygon points={`${x + w - 12},${y + h} ${x + w},${y + h} ${x + w},${y + h - 12}`} className="fill-stop" />}
    </g>
  );
}

function fit(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}...`;
}

export function EvidenceMapDiagram() {
  const hot = useHot();
  const [filter, setFilter] = useState<EvStatus | 'all'>('all');
  const data = rows();
  const height = TOP + data.length * ROW_H + 70;
  const counts = Object.fromEntries(ORDER.map((s) => [s, data.filter((r) => r.status === s).length])) as Record<EvStatus, number>;

  const details: Record<string, ReactNode> = Object.fromEntries(
    data.map((r) => [
      r.id,
      <span key={r.id}>
        <strong>
          {r.claim} ({r.status}, {r.ranOn}).
        </strong>{' '}
        {r.limit} Evidence:{' '}
        {r.evidence.map((e, i) => (
          <span key={e}>
            {i > 0 && ', '}
            <a href={codeUrl(e)} className="underline" target="_blank" rel="noreferrer">
              <code>{e}</code>
            </a>
          </span>
        ))}
        .
      </span>,
    ]),
  );

  const btn =
    'rounded-[2px] border px-2 py-1 font-mono text-[0.68rem] font-bold uppercase hover:bg-fd-accent aria-pressed:bg-fd-accent aria-pressed:border-[var(--hl-fg)]';

  return (
    <DiagramFrame
      title="Evidence map: claim, status, evidence"
      desc={`A table of ${data.length} claims. Each row has the claim, a status (PASS, FAIL, PARTIAL, IN PROGRESS, SIMULATED, OPEN or CI), what it ran on, and the first file or workflow that backs it. Gates G0, G1, G2 and G4 pass on the PayPal sandbox, G3 is in progress, G5 is partial (synthetic audio only), the 30 day run is simulated, and the security checklist is not signed off.`}
      width={1200}
      height={height}
      minWidth={1000}
      badge={<GateBadge id="G5" />}
      toolbar={
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter claims by status">
            <button type="button" className={btn} aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
              All {data.length}
            </button>
            {ORDER.map((s) => (
              <button key={s} type="button" className={btn} aria-pressed={filter === s} onClick={() => setFilter(filter === s ? 'all' : s)}>
                {s} {counts[s]}
              </button>
            ))}
          </div>
          <DetailPanel active={hot.active} details={details} hint="Hover, focus or tap a row for its limits and links to the files behind it." />
        </div>
      }
      caption={
        <>
          Gate rows read their status from <code>docs/GATES.md</code> when the site is built. Limits are quoted from the Scope, Verdict and Evidence lines there, from{' '}
          <code>docs/evidence/SIM/SIM-MULTIDAY.md</code> and from <code>docs/SECURITY-REVIEW.md</code>. G3 is in progress (day 0 7 Nov 2026 03:06 UTC, final about 12 Nov). The 30 day run is a simulation. Sandbox and fake PayPal are labelled as they are in <code>docs/GATES.md</code>. Every path in the map exists on main.
        </>
      }
      transcript={
        <>
          <ul>
            {data.map((r) => (
              <li key={r.id}>
                <strong>{r.claim}</strong>: {r.status}, ran on {r.ranOn}. {r.limit} Evidence: {r.evidence.join(', ')}.
              </li>
            ))}
          </ul>
          <p>
            Status meanings: {ORDER.map((s) => `${s}, ${MEANING[s]}`).join('; ')}.
          </p>
        </>
      }
      render={(p) => (
        <>
          <Defs p={p} />
          <rect x={0} y={0} width={1200} height={height} style={{ fill: 'var(--hl-bg)' }} />
          <T x={20} y={34} cls="t-small t-ink">CLAIM</T>
          <T x={470} y={34} cls="t-small t-ink">STATUS</T>
          <T x={620} y={34} cls="t-small t-ink">RAN ON</T>
          <T x={810} y={34} cls="t-small t-ink">FIRST EVIDENCE</T>
          <line x1={10} y1={46} x2={1190} y2={46} className="guide" />
          {data.map((r, i) => {
            const y = TOP + i * ROW_H - 16;
            const dim = filter !== 'all' && filter !== r.status;
            const active = hot.active === r.id;
            return (
              <g key={r.id} {...hot.props(r.id)} aria-label={`${r.claim}, ${r.status}`} style={{ opacity: dim ? 0.18 : 1, cursor: 'pointer', outline: 'none' }}>
                <rect x={10} y={y - 4} width={1180} height={ROW_H - 2} className={active ? 'panel-2' : 'panel'} style={{ stroke: active ? 'var(--hl-fg)' : undefined, strokeWidth: active ? 2 : undefined }} />
                <text x={20} y={y + 20} className="t-big" style={{ fontSize: 12.5 }}>
                  {fit(r.claim, 60)}
                </text>
                <Pill x={470} y={y + 3} status={r.status} p={p} />
                <text x={620} y={y + 20} className="t-small t-muted">
                  {fit(r.ranOn, 30)}
                </text>
                <text x={810} y={y + 20} className="t-small">
                  {fit(r.evidence[0] ?? '', 52)}
                  {r.evidence.length > 1 ? `  +${r.evidence.length - 1}` : ''}
                </text>
              </g>
            );
          })}
          <T x={20} y={height - 44} cls="t-small t-muted">PASS: recorded sandbox run. FAIL: recorded run failed. IN PROGRESS: real run under way. SIMULATED: fake clock, not PayPal.</T>
          <T x={20} y={height - 28} cls="t-small t-muted">OPEN: evidence exists, claim not concluded or not signed off. CI: tests or workflows in CI, no recorded run in the docs.</T>
        </>
      )}
    />
  );
}
