import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { saveRunFile, type RunFile } from '../../gates/runner.js';

describe('HRD-04 run files carry no URL query values', () => {
  it('redacts approve links in completed steps and in the awaiting step', () => {
    const dir = mkdtempSync(join(tmpdir(), 'runfile-'));
    try {
      const path = join(dir, 'g3.run.json');
      const link = 'https://www.sandbox.paypal.com/checkoutnow?token=tok-a1&x=2';
      const run = {
        v: 1,
        gate: 'g3',
        runId: 'r1',
        completed: { order: { orderId: 'ORD1', approveUrl: link } },
        approved: [],
        awaiting: { step: 'approve', url: link },
      } as unknown as RunFile;
      saveRunFile(path, run);
      const text = readFileSync(path, 'utf8');
      expect(text).not.toContain('tok-a1');
      expect(text).toContain('ORD1');
      expect(text).toContain('checkoutnow?token=[REDACTED]&x=[REDACTED]');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
