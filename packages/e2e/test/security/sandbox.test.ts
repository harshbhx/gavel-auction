import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PaymentsConfigError,
  SANDBOX_API_HOST,
  assertApproveUrl,
  assertSandboxConfig,
  assertSandboxUrl,
  loadConfig,
} from '@gavel/payments';

// T-QA-040 (R-QA-038, R-QA-026): the payments client refuses the live host and a live environment,
// and the CI grep fails on a planted live host string.

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const SCRIPT = join(ROOT, 'scripts', 'check-no-live-host.mjs');

// Built from parts so this file never contains the string the grep looks for.
const LIVE_API = ['https://api-m', 'paypal', 'com'].join('.');
const LIVE_CHECKOUT = ['https://www', 'paypal', 'com/checkoutnow'].join('.');

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    if (e instanceof PaymentsConfigError) return e.code;
    throw e;
  }
  return undefined;
}

describe('the client refuses the live host (T-QA-040)', () => {
  it('throws payments_not_sandbox for the live API host with and without fake mode', () => {
    for (const fake of [false, true]) {
      expect(codeOf(() => assertSandboxUrl(LIVE_API, { fake }))).toBe('payments_not_sandbox');
    }
    expect(codeOf(() => assertSandboxUrl(`https://${SANDBOX_API_HOST}`, { fake: false }))).toBe(
      undefined,
    );
  });

  it('throws payments_not_sandbox for the live checkout host', () => {
    for (const fake of [false, true]) {
      expect(codeOf(() => assertApproveUrl(LIVE_CHECKOUT, { fake }))).toBe('payments_not_sandbox');
    }
  });

  it('throws payments_not_sandbox for a live environment name, at config load and at the guard', () => {
    const env = {
      PAYPAL_CLIENT_ID: 'placeholder-id',
      PAYPAL_CLIENT_SECRET: 'fake',
      PAYPAL_WEBHOOK_ID: 'placeholder-webhook',
    };
    for (const name of ['live', 'production', 'LIVE', '', 'Sandbox']) {
      expect(codeOf(() => loadConfig({ ...env, PAYPAL_ENV: name }))).toBe('payments_not_sandbox');
    }
    expect(codeOf(() => loadConfig(env))).toBe('payments_not_sandbox');
    expect(codeOf(() => assertSandboxConfig({ env: 'live', baseUrl: LIVE_API, fake: false }))).toBe(
      'payments_not_sandbox',
    );
  });

  it('refuses a live base url handed in through PAYPAL_BASE_URL', () => {
    const cfg = {
      PAYPAL_ENV: 'sandbox',
      PAYPAL_CLIENT_ID: 'placeholder-id',
      PAYPAL_CLIENT_SECRET: 'fake',
      PAYPAL_WEBHOOK_ID: 'placeholder-webhook',
      PAYPAL_BASE_URL: LIVE_API,
    };
    expect(codeOf(() => assertSandboxConfig(loadConfig(cfg)))).toBe('payments_not_sandbox');
  });
});

describe('the CI grep for the live host (T-QA-040)', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function tree(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), 'gavel-live-host-'));
    dirs.push(dir);
    for (const [name, text] of Object.entries(files)) {
      const path = join(dir, name);
      mkdirSync(join(path, '..'), { recursive: true });
      writeFileSync(path, text);
    }
    return dir;
  }

  function run(root: string) {
    return spawnSync(process.execPath, [SCRIPT, '--root', root], { encoding: 'utf8' });
  }

  it('passes on a tree that names only sandbox hosts', () => {
    const root = tree({
      'src/client.ts': `const base = 'https://${SANDBOX_API_HOST}';\n`,
      'src/approve.ts': "const host = 'www.sandbox.paypal.com';\n",
    });
    expect(run(root).status).toBe(0);
  });

  it('fails on a planted live API host in source, config and workflow files', () => {
    for (const file of ['src/a.ts', 'render.yaml', '.github/workflows/x.yml', 'scripts/y.mjs']) {
      const root = tree({ [file]: `url: ${LIVE_API}/v2/checkout/orders\n` });
      const res = run(root);
      expect(res.status, file).toBe(1);
      expect(res.stderr).toContain('live host');
    }
  });

  it('fails on a planted live checkout host', () => {
    const root = tree({ 'src/a.ts': `const u = '${LIVE_CHECKOUT}';\n` });
    expect(run(root).status).toBe(1);
  });

  it('skips test folders, test files and dependencies, which name live hosts to refuse them', () => {
    const root = tree({
      'packages/p/test/guard.ts': LIVE_API,
      'packages/p/src/guard.test.ts': LIVE_API,
      'node_modules/x/index.js': LIVE_API,
    });
    expect(run(root).status).toBe(0);
  });

  it('passes on this repository', () => {
    const res = run(ROOT);
    expect(res.stderr).toBe('');
    expect(res.status).toBe(0);
  });
});
