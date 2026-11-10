// Guards for the deploy, backup, quarantine and CI workflows (ops hardening).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const wf = (name) => readFileSync(`.github/workflows/${name}`, 'utf8');

describe('deploy workflows', () => {
  const prod = wf('deploy-prod.yml');

  it('refuses to deploy a commit that is not the head of main', () => {
    assert.match(prod, /git ls-remote .* refs\/heads\/main/);
    assert.match(prod, /if: \$\{\{ !inputs\.rollback \}\}/);
  });

  it('waits for the served version and rolls back automatically on a mismatch', () => {
    assert.match(prod, /scripts\/wait-version\.sh/);
    assert.match(prod, /Roll back automatically after a failed deploy/);
    assert.doesNotMatch(prod, /sleep 60/);
    assert.doesNotMatch(wf('deploy-staging.yml'), /sleep 60/);
    assert.match(wf('deploy-staging.yml'), /wait-version\.sh/);
  });

  it('does not pick the bad build for a second rollback', () => {
    assert.match(prod, /rollback_deploy_id/);
    assert.match(prod, /\.commit\.id/);
    assert.match(prod, /already a rollback/);
  });
});

describe('production gate and rollback (R-QA-042, R-QA-049)', () => {
  const prod = wf('deploy-prod.yml');

  it('deploys only on a tag or by hand, never on a push to a branch', () => {
    assert.match(prod, /tags: \['v\*'\]/);
    assert.match(prod, /workflow_dispatch:/);
    assert.doesNotMatch(prod, /branches:/);
    assert.doesNotMatch(prod, /pull_request/);
  });

  it('runs the deploy job in the production environment so the reviewer gate applies', () => {
    assert.match(prod, /deploy:\n(?:.*\n)*?\s+environment: production/);
  });

  it('keeps secrets in the environment and never echoes them', () => {
    assert.match(prod, /secrets\.RENDER_API_KEY/);
    assert.match(prod, /secrets\.RENDER_DEPLOY_HOOK_URL/);
    assert.doesNotMatch(prod, /echo[^\n]*\$RENDER_(API_KEY|DEPLOY_HOOK_URL)/);
  });

  it('records the live deploy, rolls back by deploy id and verifies /version', () => {
    assert.match(prod, /rollback:\n\s+description:/);
    assert.match(prod, /Record the live deploy before changing anything/);
    assert.match(prod, /\/rollback"/);
    assert.match(prod, /wait-version\.sh "\$PRODUCTION_URL" "\$expected"/);
    assert.match(prod, /TARGET_COMMIT/);
    assert.match(prod, /scripts\/smoke\.sh/);
  });

  it('documents the rollback and its rehearsal table', () => {
    const doc = readFileSync('infra/rollback.md', 'utf8');
    assert.match(doc, /rollback_deploy_id/);
    assert.match(doc, /## Rehearsal/);
    assert.match(doc, /\/version/);
  });
});

describe('uptime workflow (R-QA-045, R-QA-048)', () => {
  const up = wf('uptime.yml');

  it('probes the health, readiness and warmup routes plus web and docs', () => {
    for (const path of ['/healthz', '/readyz', '/warmup']) assert.ok(up.includes(path), path);
    assert.match(up, /WEB_URL/);
    assert.match(up, /DOCS_URL/);
  });

  it('fails a warmup slower than the 3 s budget and logs every probe time', () => {
    assert.match(up, /WARMUP_BUDGET_MS: '3000'/);
    assert.match(up, /over the \$\{WARMUP_BUDGET_MS\}ms budget/);
    assert.match(up, /GITHUB_STEP_SUMMARY/);
  });

  it('re-probes once and then raises an error annotation and a Needs-you issue', () => {
    assert.match(up, /sleep 30/);
    assert.match(up, /::error title=Uptime probe failed::/);
    assert.match(up, /gh issue create/);
    assert.match(up, /issues: write/);
  });
});

describe('backup workflow', () => {
  const text = wf('backup.yml');

  it('keeps going after a failed ledger and uploads whatever was saved', () => {
    assert.doesNotMatch(
      text,
      /curl -sS --fail --max-time 60[^\n]*\\\n[^\n]*-o "\$work\/\$id\.ndjson"\n/,
    );
    assert.match(text, /failed="\$failed \$id"/);
    assert.match(text, /upload-artifact@[0-9a-f]{40}\n\s+if: always\(\)/);
  });

  it('also exports payment state through the admin route into the same encrypted file', () => {
    assert.match(text, /admin\/export\?kind=payments&auction=\$id/);
    assert.match(text, /admin\/export\?kind=roomlog&auction=\$id/);
    assert.match(text, /admin\/export\?kind=payments-global/);
    assert.match(text, /failed="\$failed payments-\$id"/);
    // A failed ledger download must not skip the payment state of that auction.
    assert.ok(text.indexOf('kind=payments&auction=$id') < text.indexOf('export?auction=$id"'));
    assert.equal((text.match(/--encrypt/g) ?? []).length, 1);
  });

  it('fails a scheduled run without configuration and opens an issue', () => {
    assert.match(text, /\[ "\$EVENT" = "schedule" \]; then exit 1/);
    assert.match(text, /gh issue create/);
    assert.match(text, /issues: write/);
  });
});

describe('quarantine and report workflows', () => {
  const q = wf('quarantine.yml');

  it('only trusts push runs of this repository on main', () => {
    assert.match(q, /workflow_run\.head_repository\.full_name == github\.repository/);
    assert.match(q, /workflow_run\.event == 'push'/);
    assert.match(q, /\.github\/workflows\/quarantine\.yml/);
    assert.match(q, /\.github\/workflows\/ci\.yml/);
    assert.match(
      wf('report.yml'),
      /workflow_run\.head_repository\.full_name == github\.repository/,
    );
  });

  it('cleans test names before using them in an issue title', () => {
    assert.match(q, /tr -cd '\[:print:\]' \| cut -c1-120/);
  });
});

describe('ci workflow', () => {
  const ci = wf('ci.yml');

  it('runs the live host check', () => {
    assert.match(ci, /run: npm run check:live-host/);
  });

  it('boots the production configuration from the bundle', () => {
    const smoke = readFileSync('scripts/smoke-dist.mjs', 'utf8');
    assert.match(smoke, /NODE_ENV: 'production'/);
    assert.match(smoke, /STORE: 'file'/);
    assert.match(smoke, /PAYMENTS: 'sandbox'/);
    assert.match(smoke, /gavel\.lock/);
  });
});

describe('workflow comments about secrets', () => {
  it('say that the environment does not protect repository-level secrets', () => {
    for (const f of ['gate-g4.yml', 'nightly-sandbox.yml']) {
      assert.match(wf(f), /no\s+(#\s*)?reviewer/, f);
    }
  });
});
