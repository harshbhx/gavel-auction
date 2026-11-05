import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../${rel}`, import.meta.url)), 'utf8');

describe('dependency audit gate is wired (R8-Q03)', () => {
  it('has an npm script that runs the gate', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(pkg.scripts['check:audit']).toBe('node scripts/check-audit.mjs');
  });

  it('runs on pull requests, main and a weekly schedule, outside the required roll-up', () => {
    const wf = read('.github/workflows/audit.yml');
    expect(wf).toMatch(/npm run check:audit/);
    expect(wf).toMatch(/schedule:\s*\n\s*- cron:/);
    expect(wf).toMatch(/pull_request:/);
    expect(read('.github/workflows/ci.yml')).not.toMatch(/check:audit/);
  });
});

describe('security tests are collected by the runner (R8-Q02)', () => {
  it('keeps them under test/ and not in the unreachable security/ folder', () => {
    expect(existsSync(fileURLToPath(new URL('../security', import.meta.url)))).toBe(false);
    expect(existsSync(fileURLToPath(new URL('./security/fuzz.test.ts', import.meta.url)))).toBe(
      true,
    );
    expect(existsSync(fileURLToPath(new URL('./security/headers.test.ts', import.meta.url)))).toBe(
      true,
    );
  });
});

describe('differential workflow varies its seed (R8-Q06)', () => {
  it('runs the pinned seed and a rotating one on a schedule', () => {
    const wf = read('.github/workflows/differential.yml');
    expect(wf).toMatch(/--seed 20261104/);
    expect(wf).toMatch(/GITHUB_RUN_ID/);
    expect(wf).toMatch(/schedule:/);
    expect(wf).toMatch(/event_name == 'schedule'/);
  });
});

describe('gate-g4 does not hard-code a personal account (R8-Q07)', () => {
  it('reads the receiver URL from a repository variable', () => {
    const wf = read('.github/workflows/gate-g4.yml');
    expect(wf).toMatch(/RECEIVER_URL: \$\{\{ vars\.G4_RECEIVER_URL \}\}/);
    expect(wf).not.toMatch(/workers\.dev/);
  });
});

describe('documentation names what the code reads (R8-Q04)', () => {
  it('lists no secret names the server does not read', () => {
    const readme = read('README.md');
    expect(readme).not.toMatch(/ADMIN_TOKEN|AUCTIONEER_TOKEN_SECRET/);
    expect(readme).toMatch(/ADMIN_KEY/);
    expect(readme).toMatch(/TOKEN_SECRET/);
  });

  it('does not say the server has no entry point and says no socket gateway is mounted', () => {
    expect(read('docs/DEMO.md')).not.toMatch(/has no entry point or HTTP routes/);
    expect(read('packages/server/README.md')).toMatch(/No WebSocket gateway is mounted/);
  });

  it('does not point at a security review file that does not exist', () => {
    if (!existsSync(fileURLToPath(new URL('../../../docs/SECURITY-REVIEW.md', import.meta.url)))) {
      expect(read('SECURITY.md')).not.toMatch(/SECURITY-REVIEW\.md/);
    }
  });
});
