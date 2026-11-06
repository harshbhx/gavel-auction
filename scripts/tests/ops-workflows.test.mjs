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
