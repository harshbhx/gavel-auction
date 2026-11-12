'use client';

import { useState } from 'react';
import { Chip } from '@/components/holdline/chip';
import { DiagramFrame } from './frame';
import { DetailPanel, useHot } from './interactive';
import { Defs, Legend, T, hatch } from './kit';

// D. Honor period and reauthorization timeline, and what gate G3 tests. Read from:
//   packages/payments/src/fake/core.ts          the MODEL: honor 3 days, validity 29 days, reauthorize only after the
//                                               honor period (REAUTHORIZATION_TOO_EARLY before), a new authorization id and a new honor clock
//   packages/payments/src/fake/ASSUMPTIONS.md   A07 to A11, all modelled, not yet read from the sandbox, until G3
//   packages/payments/src/saga/reauth.ts        policy: off by default, DEFAULT_HONOR_SAFE_MS = 3 days minus 6 hours
//   packages/payments/src/holds/recover.ts      the stale flag (flag only; default max age 2 h in payments/src/config.ts)
//   packages/payments/src/saga/capture.ts       a capture refused after the honor period is a definite, per-hold refusal
//   packages/server/src/runtime/auction-service.ts   reauthorizeDue() runs before the capture when GAVEL_REAUTH is on
//   packages/payments/gates/g3.ts, g3-timed.ts  the real probe: checkpoints 3.5, 4 and 5 days; decideG3()
//   .github/workflows/gate-g3.yml               day 0 on 7 Nov 2026 03:06 UTC; scheduled runs at minute 17 of every 6th hour
//   docs/evidence/SIM/SIM-MULTIDAY.md           the SIMULATED scenarios S2, S3, S4
// Nothing here claims what PayPal does. The probe has no result yet.

const W = 1100;
const H = 700;
const X0 = 150;
const PXD = 118; // pixels per day
const MAXD = 6;
const x = (d: number) => X0 + d * PXD;

const DETAILS: Record<string, string> = {
  honor:
    'Honor period, 3 days: the fake PayPal models it (honorMs). A capture after it is refused with 422 AUTHORIZATION_NOT_HONORED_AFTER_HONOR_PERIOD in the strict reading. Simulated only: this is the model, not a PayPal observation. packages/payments/src/fake/core.ts, ASSUMPTIONS.md A09',
  safe:
    'Reauthorization threshold: with GAVEL_REAUTH on, a hold older than 2 days 18 hours (3 days minus 6 hours, honorSafeMs) is reauthorized before the capture, once per generation and never above its original ceiling. Off by default. packages/payments/src/saga/reauth.ts',
  stale:
    'Stale flag: at settlement start a hold older than GAVEL_HOLD_MAX_AGE_MS (default 2 hours) is flagged stale and audited. It is a flag only: the hold is still captured. packages/payments/src/holds/recover.ts',
  early:
    'Too early: the model refuses a reauthorization inside the honor period (422 REAUTHORIZATION_TOO_EARLY, name assumed). Simulated scenario S2 shows the refusal does not block the capture. docs/evidence/SIM/SIM-MULTIDAY.md',
  reauth:
    'Reauthorization (simulated S4): at day 3.04 the pass reauthorizes each candidate once. The model answers with a new authorization id and a new honor clock; the old id is closed. The journal keeps the old id in priorAuthIds and captures on the new one. SIMULATED, not a PayPal result.',
  capture5:
    'Capture at day 5 on the reauthorized authorization succeeds in the simulation (S4). The same capture without reauthorization is refused in the strict model, and the saga then falls back or releases (S3).',
  validity:
    'Validity, 29 days: modelled (validityMs). Past it the model reads EXPIRED and a capture fails with 422 AUTHORIZATION_EXPIRED (name assumed). Simulated scenario S5 shows holds that were never reauthorized expire cleanly. Simulated only. ASSUMPTIONS.md A07, A08',
  g31:
    'G3.1: on day 0 a fresh authorization gets an immediate reauthorize attempt, whose error name is recorded, and is then voided. packages/payments/gates/g3.ts',
  d35:
    'Checkpoint 3.5 days (due 10 Nov 2026 15:06 UTC): read the authorization, try a 1.00 partial capture (final_capture false), try a reauthorize, read again. The first scheduled run after it is at 18:17 UTC. Result: not recorded yet. packages/payments/gates/g3-timed.ts',
  d4:
    'Checkpoint 4 days (due 11 Nov 2026 03:06 UTC): same four steps on a second authorization. First scheduled run after it: 06:17 UTC. Result: not recorded yet.',
  d5:
    'Checkpoint 5 days (due 12 Nov 2026 03:06 UTC): same four steps on a third authorization. First scheduled run after it: 06:17 UTC, which also decides the gate. Result: not recorded yet.',
};

function readout(d: number): { model: string; probe: string } {
  let model: string;
  if (d <= 2.75) {
    model =
      'Inside the honor period and below the reauthorization threshold. The capture works. A reauthorize would be refused as too early.';
  } else if (d <= 3) {
    model =
      'Inside the honor period, past the 2.75 day threshold. With GAVEL_REAUTH on the policy asks for a reauthorization; the model still refuses it as too early (simulated S2). The capture works.';
  } else {
    model =
      'Past the honor period. Strict model: a capture is refused and a reauthorization is allowed and gives a new authorization with a new honor clock. Lenient model: the capture still works. Which one PayPal follows is what G3 measures.';
  }
  const probe =
    d < 3.5
      ? 'Real probe: the first checkpoint is at day 3.5. Nothing is read before it.'
      : d < 4
        ? 'Real probe: checkpoint 1 of 3 (day 3.5) is due. No result is recorded yet.'
        : d < 5
          ? 'Real probe: checkpoints at day 3.5 and day 4 are due. No result is recorded yet.'
          : 'Real probe: all three checkpoints (3.5, 4, 5 days) are due. No result is recorded in GATES.md yet.';
  return { model, probe };
}

function Bar({ p, a, b, y, h = 26, kind }: { p: string; a: number; b: number; y: number; h?: number; kind: 'held' | 'hollow' }) {
  return (
    <rect
      x={x(a)}
      y={y}
      width={x(b) - x(a)}
      height={h}
      fill={kind === 'held' ? hatch(p) : undefined}
      className={kind === 'held' ? 'fill-hatch-edge' : 'fill-hollow'}
      strokeDasharray={kind === 'hollow' ? '5 4' : undefined}
    />
  );
}

function Tag({ cx, cy, text, cls = 't-small' }: { cx: number; cy: number; text: string; cls?: string }) {
  const w = text.length * 6 + 10;
  return (
    <g>
      <rect x={cx - w / 2} y={cy - 12} width={w} height={17} rx={2} style={{ fill: 'var(--hl-panel)' }} />
      <T x={cx} y={cy} anchor="middle" cls={cls}>
        {text}
      </T>
    </g>
  );
}

export function HonorTimelineDiagram() {
  const hot = useHot();
  const [day, setDay] = useState(3.5);
  const r = readout(day);
  const act = (id: string) => hot.active === id;
  const spot = (id: string) => ({ ...hot.props(id), style: { cursor: 'pointer', outline: 'none' } as const });

  return (
    <DiagramFrame
      title="Honor period and reauthorization: the model, the simulation and the real G3 probe"
      desc="A timeline in days from 0 to 6, with a marker at day 29. First lane: one hold in the fake PayPal model, held for a 3 day honor period, with a stale flag after 2 hours, a reauthorization threshold at 2.75 days, and a validity limit at 29 days. Second lane: the simulated reauthorization at day 3.04 which starts a new honor clock, and a capture at day 5. Third group: the real sandbox probe gate G3, one authorization checked at day 3.5, 4 and 5, plus an immediate reauthorize test at day 0. The real probe has no result yet."
      width={W}
      height={H}
      minWidth={950}
      badge={
        <>
          <Chip kind="fake">Model and simulation</Chip>
          <Chip kind="solid">G3 PASS</Chip>
        </>
      }
      toolbar={
        <div className="space-y-3">
          <label className="flex flex-wrap items-center gap-3 font-mono text-[0.7rem] uppercase">
            <span>Day since the hold</span>
            <input
              type="range"
              min={0}
              max={MAXD}
              step={0.25}
              value={day}
              onChange={(e) => setDay(Number(e.target.value))}
              aria-valuetext={`day ${day}`}
              className="w-64 max-w-full"
            />
            <span className="font-bold">day {day}</span>
          </label>
          <p aria-live="polite">
            <strong>Model:</strong> {r.model}
          </p>
          <p aria-live="polite">
            <strong>{r.probe}</strong>
          </p>
          <DetailPanel active={hot.active} details={DETAILS} hint="Hover or focus a marker or bar for what it means and which file it comes from." />
        </div>
      }
      caption={
        <>
          The honor period (3 days), the validity (29 days) and the reauthorization rules in the first two lanes are
          the <strong>fake PayPal model</strong> in <code>packages/payments/src/fake/core.ts</code> (assumptions A07 to A11,
          all unverified) and the <strong>simulated</strong> scenarios S2 to S5 in{' '}
          <code>docs/evidence/SIM/SIM-MULTIDAY.md</code>; PayPal&apos;s real values are not verified. The third group is the
          real probe in <code>packages/payments/gates/g3.ts</code> and <code>g3-timed.ts</code>, run by{' '}
          <code>.github/workflows/gate-g3.yml</code> with day 0 on 7 Nov 2026 03:06 UTC. Gate G3 passed on 12 Nov: captures of 1.00 and reauthorize were accepted at 3.5, 4 and 5 days (wallet
          buyer, sandbox).
        </>
      }
      transcript={
        <>
          <ul>
            <li>Model: an authorization is held for a 3 day honor period and is valid for 29 days. A capture after the honor period is refused in the strict reading (the simulation uses it). A reauthorization is refused inside the honor period and, after it, returns a new authorization with its own id and a new honor clock.</li>
            <li>Policy: reauthorization is off by default (GAVEL_REAUTH). When on, a hold older than 2 days 18 hours is reauthorized before the capture, once, never above its ceiling. A hold older than 2 hours at settlement start is only flagged stale and is still captured.</li>
            <li>Simulation: S2 closes at day 2.5 and captures inside the honor period, and a too-early reauthorization at day 2.9 is refused without blocking the capture. S3 captures at day 3.5 with reauthorization and, with it off, nobody is charged. S4 reauthorizes at day 3.04 and captures at day 5. S5 lets holds expire at day 30 and the runner-up is charged its own price.</li>
            <li>Real probe G3 (PASS, day 0 is 7 Nov 2026 03:06 UTC): day 0 tries an immediate reauthorize on a fresh authorization and creates three authorizations. At 3.5, 4 and 5 days (10 Nov 15:06, 11 Nov 03:06, 12 Nov 03:06 UTC) it reads one, tries a 1.00 partial capture, tries a reauthorize and reads again. All three checkpoints accepted the capture and the reauthorize.</li>
          </ul>
        </>
      }
      render={(p) => (
        <>
          <Defs p={p} />
          <rect x={0} y={0} width={W} height={H} style={{ fill: 'var(--hl-bg)' }} />

          {/* axis */}
          <line x1={X0} y1={74} x2={x(MAXD)} y2={74} className="edge" />
          {[0, 1, 2, 3, 4, 5, 6].map((d) => (
            <g key={d}>
              <line x1={x(d)} y1={68} x2={x(d)} y2={80} className="edge" />
              <T x={x(d)} y={58} anchor="middle" cls="t-small">
                {`day ${d}`}
              </T>
            </g>
          ))}
          <T x={x(MAXD) + 18} y={78} cls="t-small t-muted">
            ...
          </T>
          <g {...spot('validity')}>
            <line x1={1030} y1={64} x2={1030} y2={84} className="edge-stop" />
            <T x={1030} y={52} anchor="middle" cls="t-small t-stop">
              day 29
            </T>
            <T x={1030} y={96} anchor="middle" cls="t-small t-muted">
              validity ends
            </T>
            {act('validity') && <rect x={1000} y={40} width={60} height={60} rx={2} className="fill-hollow" />}
          </g>

          {/* lane 1: model */}
          <T x={20} y={134} cls="t-big">
            One hold
          </T>
          <T x={20} y={152} cls="t-small t-muted">
            fake PayPal model
          </T>
          <g {...spot('honor')}>
            <Bar p={p} a={0} b={3} y={124} kind="held" />
            <Tag cx={x(1.5)} cy={142} text="honor period, 3 days (modelled)" />
          </g>
          <Bar p={p} a={3} b={MAXD} y={124} kind="hollow" />
          <Tag cx={x(4.5)} cy={142} text="strict model: capture refused" />
          <g {...spot('stale')}>
            <line x1={x(0.083)} y1={110} x2={x(0.083)} y2={156} className="guide-dash" />
            <T x={x(0.083) + 4} y={108} cls="t-small t-muted">
              2 h: stale flag
            </T>
          </g>
          <g {...spot('safe')}>
            <line x1={x(2.75)} y1={110} x2={x(2.75)} y2={156} className="edge-dash" />
            <T x={x(2.75) - 6} y={108} anchor="end" cls="t-small t-ink">
              2.75 d: reauth threshold
            </T>
          </g>
          <g {...spot('early')}>
            <rect x={x(2.75)} y={162} width={x(3) - x(2.75)} height={12} rx={1} className="fill-stop" />
            <T x={x(3) + 6} y={172} cls="t-small t-muted">
              2.75 to 3 d: reauth refused as too early (S2)
            </T>
          </g>

          {/* lane 2: simulated reauth */}
          <T x={20} y={234} cls="t-big">
            Reauthorized
          </T>
          <T x={20} y={252} cls="t-small t-muted">
            simulated S4
          </T>
          <Bar p={p} a={0} b={3.04} y={224} kind="held" />
          <g {...spot('reauth')}>
            <Bar p={p} a={3.04} b={MAXD} y={224} kind="held" />
            <line x1={x(3.04)} y1={214} x2={x(3.04)} y2={260} className="edge-thick" />
            <Tag cx={x(3.04)} cy={208} text="day 3.04: reauthorize, new id, new clock" cls="t-small t-ink" />
            <Tag cx={x(4.5)} cy={242} text="second honor clock" />
          </g>
          <g {...spot('capture5')}>
            <circle cx={x(5)} cy={237} r={7} className="fill-solid" />
            <T x={x(5)} y={274} anchor="middle" cls="t-small">
              day 5: capture (S4)
            </T>
          </g>

          {/* group 3: real probe */}
          <rect x={14} y={296} width={W - 28} height={232} rx={2} className="panel" />
          <T x={26} y={320} cls="t-big">
            Real sandbox probe: gate G3, passed
          </T>
          <T x={26} y={338} cls="t-small t-muted">
            day 0 = 7 Nov 2026 03:06 UTC. At each checkpoint: read, capture 1.00 (not final), reauthorize, read again.
          </T>

          <T x={26} y={376} cls="t-small">
            G3.1 fresh
          </T>
          <g {...spot('g31')}>
            <circle cx={x(0)} cy={372} r={6} className="fill-hollow" />
            <T x={x(0) + 14} y={376} cls="t-small t-muted">
              day 0: immediate reauthorize, then void
            </T>
          </g>

          {[
            { id: 'd35', d: 3.5, y: 404, label: '3.5 d, 10 Nov 15:06 UTC' },
            { id: 'd4', d: 4, y: 440, label: '4 d, 11 Nov 03:06 UTC' },
            { id: 'd5', d: 5, y: 476, label: '5 d, 12 Nov 03:06 UTC' },
          ].map((c) => (
            <g key={c.id} {...spot(c.id)}>
              <T x={26} y={c.y + 17} cls="t-small">
                {`authorization ${c.id === 'd35' ? '1' : c.id === 'd4' ? '2' : '3'}`}
              </T>
              <Bar p={p} a={0} b={c.d} y={c.y} h={24} kind="held" />
              <rect x={x(c.d) - 11} y={c.y + 1} width={22} height={22} rx={2} className="fill-hollow" style={{ fill: 'var(--hl-panel)' }} />
              <T x={x(c.d)} y={c.y + 17} anchor="middle" cls="t-big">
                ?
              </T>
              <T x={x(c.d) + 18} y={c.y + 17} cls="t-small">
                {`${c.label}: no result yet`}
              </T>
            </g>
          ))}

          {/* slider cursor */}
          <g aria-hidden="true">
            <line x1={x(day)} y1={84} x2={x(day)} y2={528} className="edge-thick" style={{ opacity: 0.55 }} />
            <rect x={x(day) - 24} y={86} width={48} height={16} rx={2} style={{ fill: 'var(--hl-signal)' }} />
            <text x={x(day)} y={98} textAnchor="middle" style={{ fill: 'var(--hl-on-signal)', fontWeight: 800, fontSize: 11 }}>
              {`d ${day}`}
            </text>
          </g>

          {/* decision rule */}
          <T x={26} y={560} cls="t-big">
            How the probe decides (decideG3)
          </T>
          <T x={26} y={582} cls="t-small">
            all three captures succeed: PASS, no reauthorization, keep the stale flag
          </T>
          <T x={26} y={602} cls="t-small">
            a capture fails and a reauthorize works: PASS-WITH-FALLBACK, enable reauthorization (GAVEL_REAUTH)
          </T>
          <T x={26} y={622} cls="t-small">
            a capture fails and no reauthorize works: FAIL, create holds minutes before capture and document it
          </T>
          <Legend p={p} x={26} y={664} />
        </>
      )}
    />
  );
}
