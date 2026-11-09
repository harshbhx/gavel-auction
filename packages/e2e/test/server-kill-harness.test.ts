import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runServerKill } from '../src/sandbox/server-kill';

// The whole harness of issue 2185 against the fake PayPal: a real server process, a whole auction
// over HTTP and WebSocket, a SIGKILL at the checkpoint after the capture request, a restart on the
// same data folder, and the checks. This proves the harness; the evidence it writes says "fake".

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('server kill harness (fake PayPal)', () => {
  it('kills the real server mid-settlement, restarts it and verifies the outcome', async () => {
    const out = mkdtempSync(join(tmpdir(), 'gavel-kill-'));
    dirs.push(out);
    const r = await runServerKill({ mode: 'fake', outDir: out, env: process.env });
    const failed = r.evidence.checks.filter((c) => !c.pass);
    expect(failed).toEqual([]);
    expect(r.verdict).toBe('PASS');
    expect(r.evidence.pidBefore).not.toBe(r.evidence.pidAfter);
    expect(r.evidence.winnerCaptures).toBe(1);
    expect(r.evidence.voidedLosers).toBe(2);
    expect(r.evidence.journalDiffs).toBe(0);
    expect(r.evidence.label).toContain('not sandbox evidence');
    const file = JSON.parse(readFileSync(join(out, 'server-kill-evidence.json'), 'utf8')) as {
      verdict: string;
    };
    expect(file.verdict).toBe('PASS');
    expect(readFileSync(join(out, 'server-kill-evidence.sha256'), 'utf8')).toMatch(
      /^[0-9a-f]{64} {2}/,
    );
    expect(readFileSync(join(out, 'server-kill-transcript.jsonl'), 'utf8')).toContain(
      'server exited',
    );
  }, 240_000);
});
