'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';
import { Chip } from '@/components/holdline/chip';
import { DiagramFrame } from './frame';
import { DetailPanel, useHot } from './interactive';
import { Defs, T, hatch } from './kit';

// CI and deployment map. Every trigger, cron, secret name and artifact below is read from the
// workflow file named in the node (.github/workflows/<name>.yml on main). Secrets and variables
// appear by NAME only. Other workflows exist (for example payments-evidence, load, differential);
// this map shows the ones the docs lean on.

type LaneId = 'pr' | 'path' | 'schedule' | 'manual' | 'deploy';
const LANES: { id: LaneId; label: string; sub: string }[] = [
  { id: 'pr', label: 'Every pull request', sub: 'and every push to main' },
  { id: 'path', label: 'Pull request, only', sub: 'when these paths change' },
  { id: 'schedule', label: 'On a schedule', sub: 'cron, UTC' },
  { id: 'manual', label: 'Started by hand', sub: 'workflow_dispatch' },
  { id: 'deploy', label: 'Deploy', sub: 'host and docs site' },
];

type N = {
  id: string;
  lane: LaneId;
  name: string;
  l2: string;
  l3: string;
  sandbox?: boolean;
  simulated?: boolean;
  detail: ReactNode;
};

const NODES: N[] = [
  {
    id: 'ci',
    lane: 'pr',
    name: 'ci',
    l2: 'pull_request, push to main',
    l3: 'typecheck, lint, unit, property, voice ... then required',
    detail: (
      <>
        <b>ci.yml.</b> A <code>changes</code> job classifies the pull request; a documentation-only change skips the build, test and type jobs. Pushes to main always run
        everything. The <code>required</code> roll-up always runs and needs: changes, prod-build, package-checks, typecheck, lint, format-check, unit, coverage, property,
        scenarios, deps, secrets, ascii-banned, docs-format, commitlint, voice, e2e-fixtures, reference-python, differential, tools and ownership.
      </>
    ),
  },
  {
    id: 'docsite',
    lane: 'pr',
    name: 'docsite',
    l2: 'PR and main, paths: docsite, GATES.md, SIM',
    l3: 'artifacts: docsite, docsite-shots (7 days)',
    detail: (
      <>
        <b>docsite.yml.</b> Builds this site (Next static export), type checks, checks the export, then takes screenshots in a browser in CI. The site reads{' '}
        <code>docs/GATES.md</code> and <code>docs/evidence/SIM/SIM-MULTIDAY.md</code> at build time, so a change to either rebuilds it. The deploy job publishes to a Cloudflare
        Pages project and ends green with a notice when <code>CLOUDFLARE_API_TOKEN</code> and <code>CLOUDFLARE_ACCOUNT_ID</code> are not both set.
      </>
    ),
  },
  {
    id: 'sim',
    lane: 'path',
    name: 'sim-multiday',
    l2: 'paths: payments src, simdays tests',
    l3: 'artifact: sim-multiday-report',
    simulated: true,
    detail: (
      <>
        <b>sim-multiday.yml.</b> SIMULATED. Runs <code>vitest run test/simdays</code> in <code>packages/payments</code>: our settlement code against the fake PayPal&apos;s model of
        authorization time on a simulated clock. No secrets, no network. It writes <code>docs/evidence/SIM/SIM-MULTIDAY.md</code> and fails when the committed copy differs. It
        does not replace the real G3 probe.
      </>
    ),
  },
  {
    id: 'screens',
    lane: 'path',
    name: 'ui-screens',
    l2: 'paths: web screens tests, config',
    l3: 'artifacts: ui-screens, failures',
    detail: (
      <>
        <b>ui-screens.yml.</b> Opens every web screen in every reachable state in a phone and a desktop viewport and in the dark and projector themes. Informational: it is not in the{' '}
        <code>required</code> roll-up and uses no secrets. Artifacts <code>ui-screens</code> (30 days) and <code>ui-screens-failures</code> (7 days, on failure).
      </>
    ),
  },
  {
    id: 'ns_pr',
    lane: 'path',
    name: 'nightly-sandbox (PR)',
    l2: 'skip-check job, no secrets',
    l3: 'proves the specs skip, not fail',
    detail: (
      <>
        <b>nightly-sandbox.yml, pull request job.</b> Runs the sandbox specs with no secrets and no environment to prove that every spec is skipped and the report says so. It touches
        no PayPal account. Paths: the workflow, <code>packages/e2e/sandbox</code>, the sandbox and gates sources and the sandbox report.
      </>
    ),
  },
  {
    id: 'early_pr',
    lane: 'path',
    name: 'gate-g3-early (PR)',
    l2: 'reads statuses only',
    l3: 'paths: workflow, early script',
    detail: (
      <>
        <b>gate-g3-early.yml, pull request.</b> A pull request that touches this file or <code>scripts/gate-g3-early.mjs</code> only reads statuses; it never probes.
      </>
    ),
  },
  {
    id: 'ns',
    lane: 'schedule',
    name: 'nightly-sandbox',
    l2: '30 20 * * *  (20:30 daily)',
    l3: 'sandbox-report, 14 days',
    sandbox: true,
    detail: (
      <>
        <b>nightly-sandbox.yml.</b> SANDBOX. Cron <code>30 20 * * *</code>. Environment <code>sandbox-nightly</code>. Needs the repository secrets <code>PAYPAL_CLIENT_ID</code>,{' '}
        <code>PAYPAL_CLIENT_SECRET</code>, <code>SANDBOX_BUYER_EMAIL</code>, <code>SANDBOX_BUYER_PASSWORD</code>. Runs the real sandbox specs R1 to R10 (R9 is skipped without the buyer2 and
        buyer3 secrets) and the G5 speech harness, then writes <code>report/sandbox.json</code>. Without the secrets every spec is marked skipped; on the main repository a scheduled run
        then ends red only if the variable <code>NIGHTLY_SANDBOX_REQUIRED</code> is true. The environment has no reviewer and no secrets of its own, so it protects nothing yet.
      </>
    ),
  },
  {
    id: 'judge',
    lane: 'schedule',
    name: 'judge-smoke',
    l2: '45 21 * * *  (21:45 daily)',
    l3: 'traces on failure, 7 days',
    detail: (
      <>
        <b>judge-smoke.yml.</b> Cron <code>45 21 * * *</code>. Runs the live red-team walk (<code>qa/live-redteam/run.mjs</code>) in smoke mode against the public domains (inputs <code>web_url</code> and <code>api_url</code>); the
        job fails when any step fails, so a green run means the journey worked.
      </>
    ),
  },
  {
    id: 'g3',
    lane: 'schedule',
    name: 'gate-g3',
    l2: '17 */6 * * *  (every 6 hours)',
    l3: 'g3-probe-state, g3-entry',
    sandbox: true,
    detail: (
      <>
        <b>gate-g3.yml.</b> SANDBOX, RUNNING. Cron <code>17 */6 * * *</code> from main. The scheduled runs pick the probe up again and do the checks at 3.5, 4 and 5 days; the last one
        appends the GATES.md entry. Day 0 was 7 Nov 2026 03:06 UTC; the final reading is about 12 Nov 06:17 UTC. State lives in the artifact <code>g3-probe-state</code> (14 days), guarded
        by a keyed tag; <code>g3-entry</code> is kept 30 days. A scheduled run with no probe, or a finished one, ends with mode skip.
      </>
    ),
  },
  {
    id: 'uptime',
    lane: 'schedule',
    name: 'uptime',
    l2: '*/5 * * * *  (every 5 minutes)',
    l3: 'off until UPTIME_ENABLED',
    detail: (
      <>
        <b>uptime.yml.</b> Probes <code>/healthz</code>, <code>/readyz</code> and <code>/warmup</code> of the production host. Runs only when the variable <code>UPTIME_ENABLED</code> is{' '}
        <code>true</code> and <code>PRODUCTION_URL</code> is set. When the previous round also failed it opens one Needs-you issue, or comments on the open one. GitHub may delay scheduled
        runs; the external monitor in <code>infra/uptime.md</code> is the primary probe.
      </>
    ),
  },
  {
    id: 'backup',
    lane: 'schedule',
    name: 'backup',
    l2: '17 3 * * *  (03:17 daily)',
    l3: 'red when it cannot back up',
    detail: (
      <>
        <b>backup.yml.</b> Cron <code>17 3 * * *</code>. Environment <code>production</code>; needs the secrets <code>ADMIN_KEY</code> and <code>BACKUP_GPG_PUBLIC_KEY</code> and the variable <code>PRODUCTION_URL</code>. Encrypts the ledger export to the public key. A scheduled run that cannot back anything up fails, so a backup that was never configured does not look healthy. See the{' '}
        <a href="/docs/safety/backup">backup page</a>.
      </>
    ),
  },
  {
    id: 'audit',
    lane: 'schedule',
    name: 'audit',
    l2: '17 5 * * 1  (Monday 05:17)',
    l3: 'also on push to main',
    detail: (
      <>
        <b>audit.yml.</b> Cron <code>17 5 * * 1</code>, and on every push to main and on pull requests that touch dependency files. Runs <code>npm run check:audit</code> with expiring waivers. Informational: not in the <code>required</code> roll-up yet.
      </>
    ),
  },
  {
    id: 'mutation',
    lane: 'schedule',
    name: 'mutation',
    l2: '0 3 * * 0  (Sunday 03:00)',
    l3: 'seeded check, stryker',
    detail: (
      <>
        <b>mutation.yml.</b> Cron <code>0 3 * * 0</code>. A seeded pipeline check (a mutated comparison must be reported as killed), then a Stryker run (<code>stryker.config.mjs</code> at the repository root).
      </>
    ),
  },
  {
    id: 'm_g3',
    lane: 'manual',
    name: 'gate-g3: start the probe',
    l2: 'Run workflow on main',
    l3: 'day 0 of the 5 day probe',
    sandbox: true,
    detail: (
      <>
        <b>gate-g3.yml, manual run.</b> Starts a new probe: a headless browser signs in as the sandbox buyer and approves four orders. First it checks that the four secrets exist (names only
        are printed): <code>PAYPAL_CLIENT_ID</code>, <code>PAYPAL_CLIENT_SECRET</code>, <code>SANDBOX_BUYER_EMAIL</code>, <code>SANDBOX_BUYER_PASSWORD</code>. Runs only from main.
      </>
    ),
  },
  {
    id: 'm_early',
    lane: 'manual',
    name: 'gate-g3-early',
    l2: 'input mode: read or probe',
    l3: 'artifact: g3-early-evidence',
    sandbox: true,
    detail: (
      <>
        <b>gate-g3-early.yml.</b> Early G3 evidence from the two sandbox authorizations the G2 run created on 5 Nov 2026, which are older than the timed probe. Mode <code>read</code> reports status;
        mode <code>probe</code> tries a 1.00 partial capture and a reauthorization once an authorization reaches its checkpoint age (3.0 days for G2-wallet, 3.5 days for G2-card). It never touches{' '}
        <code>g3-probe-state</code>. This is an additional early reading, not the full 5 day result.
      </>
    ),
  },
  {
    id: 'm_live',
    lane: 'manual',
    name: 'ui-screens-live',
    l2: 'inputs: web_url, api_url',
    l3: 'artifact: ui-screens-live',
    detail: (
      <>
        <b>ui-screens-live.yml.</b> A screen tour of the hosted site. Inputs <code>web_url</code> and <code>api_url</code>. The secret <code>GAVEL_STAGING_ADMIN_KEY</code> (same value as{' '}
        <code>ADMIN_KEY</code> on the host) lets it open the room screens; without it only screens that need no room are taken, and the run summary says so.
      </>
    ),
  },
  {
    id: 'staging',
    lane: 'deploy',
    name: 'deploy-staging',
    l2: 'manual only, not configured',
    l3: 'hook, wait for sha, smoke',
    detail: (
      <>
        <b>deploy-staging.yml.</b> Environment <code>staging</code>. Runs on manual dispatch only; it is not the deploy path (the owner uses Manual Deploy of main in Render). Needs the secret <code>RENDER_DEPLOY_HOOK_URL</code> and the variable <code>STAGING_URL</code>; without them the run says SKIPPED in its summary and fails when started by hand.
        It calls the Render deploy hook, waits until <code>/version</code> reports the commit, runs <code>scripts/smoke.sh</code> and then the security header and fuzz specs against staging.
      </>
    ),
  },
  {
    id: 'prod',
    lane: 'deploy',
    name: 'deploy-prod',
    l2: 'tag v*, manual (with rollback)',
    l3: 'must be the head of main',
    detail: (
      <>
        <b>deploy-prod.yml.</b> Environment <code>production</code>. Runs on a tag <code>v*</code> or manual dispatch. A new build must be the head of main. It needs the secrets{' '}
        <code>RENDER_API_KEY</code> and <code>RENDER_DEPLOY_HOOK_URL</code> and the variables <code>RENDER_SERVICE_ID</code> and <code>PRODUCTION_URL</code>, otherwise it ends green with a notice. It records
        the live deploy before changing anything; the <code>rollback</code> input redeploys the previous live deploy (see <code>infra/rollback.md</code>).
      </>
    ),
  },
  {
    id: 'docs_deploy',
    lane: 'deploy',
    name: 'docsite deploy job',
    l2: 'main, same-repo PRs',
    l3: 'Cloudflare Pages preview',
    detail: (
      <>
        <b>docsite.yml, deploy job.</b> Publishes the built site with <code>wrangler pages deploy</code>: production from main, a branch preview for pull requests from this repository. It skips
        cleanly when the two Cloudflare secrets are missing.
      </>
    ),
  },
];

// Geometry: lanes top to bottom, nodes left to right inside each lane.
const LANE_Y: Record<LaneId, number> = { pr: 50, path: 176, schedule: 302, manual: 450, deploy: 576 };
const LANE_H: Record<LaneId, number> = { pr: 116, path: 116, schedule: 138, manual: 116, deploy: 116 };
const X0 = 196;
const X1 = 1176;

function layout(): Record<string, { x: number; y: number; w: number; h: number }> {
  const out: Record<string, { x: number; y: number; w: number; h: number }> = {};
  for (const lane of LANES) {
    const ns = NODES.filter((n) => n.lane === lane.id);
    // Seven nodes in the schedule lane sit in two rows.
    const perRow = lane.id === 'schedule' ? 4 : ns.length;
    ns.forEach((n, i) => {
      const row = Math.floor(i / perRow);
      const col = i % perRow;
      const inRow = Math.min(perRow, ns.length - row * perRow);
      const gap = 10;
      const w = (X1 - X0 - gap * (inRow - 1)) / inRow;
      const h = lane.id === 'schedule' ? 56 : 86;
      out[n.id] = {
        x: X0 + col * (w + gap),
        y: LANE_Y[lane.id] + 14 + row * (h + 8),
        w,
        h,
      };
    });
  }
  return out;
}

const POS = layout();

const Active = createContext<{ lane: LaneId | 'all'; hot: ReturnType<typeof useHot> } | null>(null);

function WorkflowNode({ n, p }: { n: N; p: string }) {
  const ctx = useContext(Active);
  if (ctx === null) throw new Error('context');
  const { x, y, w, h } = POS[n.id] as { x: number; y: number; w: number; h: number };
  const on = ctx.lane === 'all' || ctx.lane === n.lane;
  const isHot = ctx.hot.active === n.id;
  const compact = h < 70;
  return (
    <g {...ctx.hot.props(n.id)} aria-label={n.name} opacity={on ? 1 : 0.2}>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={2}
        className="node"
        strokeDasharray={n.simulated ? '6 4' : undefined}
        style={isHot ? { strokeWidth: 3, stroke: 'var(--hl-signal-ink)' } : undefined}
      />
      {n.sandbox && <rect x={x} y={y} width={w} height={8} fill={hatch(p)} className="fill-hatch-edge" />}
      <text x={x + 10} y={y + (compact ? 22 : 30)} className="t-big" style={{ fontSize: 12.5 }}>
        {n.name}
      </text>
      <text x={x + 10} y={y + (compact ? 38 : 50)} className="t-small">
        {n.l2}
      </text>
      <text x={x + 10} y={y + (compact ? 51 : 66)} className="t-small t-muted">
        {n.l3}
      </text>
    </g>
  );
}

export function CiPipelineDiagram() {
  const hot = useHot();
  const [lane, setLane] = useState<LaneId | 'all'>('all');
  const details: Record<string, ReactNode> = Object.fromEntries(NODES.map((n) => [n.id, n.detail]));

  const toolbar = (
    <div>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Show one trigger">
        {(['all', ...LANES.map((l) => l.id)] as (LaneId | 'all')[]).map((id) => (
          <button
            key={id}
            type="button"
            aria-pressed={lane === id}
            onClick={() => setLane(id)}
            className={`rounded-[2px] border px-2 py-1 font-mono text-[0.68rem] font-bold uppercase hover:bg-fd-accent ${
              lane === id ? 'bg-[var(--hl-signal)] text-[var(--hl-on-signal)]' : ''
            }`}
          >
            {id === 'all' ? 'All triggers' : (LANES.find((l) => l.id === id)?.label ?? id)}
          </button>
        ))}
      </div>
      <div className="mt-2">
        <DetailPanel active={hot.active} details={details} hint="Hover, focus or tap a workflow for its trigger, secrets (names only), artifacts and evidence label." />
      </div>
    </div>
  );

  return (
    <DiagramFrame
      title="CI and deployment map: which workflow runs when"
      desc="Five lanes by trigger. Every pull request: ci and docsite. Pull requests that change certain paths: sim-multiday, ui-screens, the sandbox skip check and the early G3 read. Scheduled: nightly-sandbox at 20:30 UTC, judge-smoke at 21:45 UTC, gate-g3 every six hours, uptime every five minutes, backup daily, audit weekly and mutation weekly. Started by hand: the G3 probe start, gate-g3-early and the live screen tour. Deploy: deploy-staging on server changes on main, deploy-prod on a version tag, and the docs site deploy job."
      width={1200}
      height={720}
      badge={<Chip kind="sandbox">Sandbox workflows marked</Chip>}
      toolbar={toolbar}
      caption={
        <>
          Every trigger, cron and artifact comes from the workflow file of the same name in <code>.github/workflows</code> on main. A hatched top edge marks a workflow that calls the PayPal sandbox with
          repository secrets; a dashed border marks the simulated-clock suite, which is a simulation and not a sandbox result. Secrets and variables appear by name only. Other workflows exist; this map
          shows the ones these docs rely on.
        </>
      }
      transcript={
        <>
          <ul>
            <li>Every pull request and push to main: ci (typecheck, lint, unit, property, voice and more, rolled up by the required job) and docsite (build, screenshots, deploy).</li>
            <li>Pull requests that change certain paths: sim-multiday (simulated clock), ui-screens, the nightly-sandbox skip check, and the gate-g3-early read.</li>
            <li>Scheduled, in UTC: nightly-sandbox 20:30 daily, judge-smoke 21:45 daily, gate-g3 every six hours at minute 17, uptime every five minutes, backup 03:17 daily, audit Monday 05:17, mutation Sunday 03:00.</li>
            <li>Started by hand: gate-g3 to start the probe, gate-g3-early in read or probe mode, ui-screens-live with the web and API origins.</li>
            <li>Deploy: the API is deployed by hand in Render; deploy-staging (manual, not configured), deploy-prod on a v tag that is the head of main, and the docs site deploy job.</li>
          </ul>
        </>
      }
      render={(p) => (
        <Active.Provider value={{ lane, hot }}>
          <Defs p={p} />
          <rect x={0} y={0} width={1200} height={720} style={{ fill: 'var(--hl-bg)' }} />
          <T x={16} y={30} cls="t-small t-muted">Hatched top edge: calls the PayPal sandbox with repository secrets. Dashed border: simulated clock, no network.</T>
          {LANES.map((l) => (
            <g key={l.id} opacity={lane === 'all' || lane === l.id ? 1 : 0.3}>
              <rect x={16} y={LANE_Y[l.id]} width={1168} height={LANE_H[l.id]} className="panel" />
              <T x={28} y={LANE_Y[l.id] + 32} cls="t-small t-ink">{l.label.toUpperCase()}</T>
              <T x={28} y={LANE_Y[l.id] + 48} cls="t-small t-muted">{l.sub}</T>
            </g>
          ))}
          {NODES.map((n) => (
            <WorkflowNode key={n.id} n={n} p={p} />
          ))}
        </Active.Provider>
      )}
    />
  );
}
