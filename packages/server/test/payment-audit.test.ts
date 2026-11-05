import { ManualClock } from '@gavel/shared';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createPaymentAudit } from '../src/boot/payment-audit';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('payment audit sink (R6-A03)', () => {
  it('writes every entry to the sink and an append-only file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gavel-audit-'));
    dirs.push(dir);
    const file = join(dir, 'payment-audit.jsonl');
    const lines: string[] = [];
    const audit = createPaymentAudit({
      clock: new ManualClock(1_789_000_000_000),
      sink: (l) => lines.push(l),
      file,
    });
    await audit.append({ kind: 'kill_switch', label: 'engaged', actor: 'admin', tsMs: 1 });
    await audit.append({ kind: 'kill_switch', label: 'released', actor: 'admin', tsMs: 2 });
    expect(lines).toHaveLength(2);
    const stored = readFileSync(file, 'utf8').trim().split('\n');
    expect(stored.map((l) => (JSON.parse(l) as { label: string }).label)).toEqual([
      'engaged',
      'released',
    ]);
  });

  it('works without a file', async () => {
    const lines: string[] = [];
    const audit = createPaymentAudit({
      clock: new ManualClock(1),
      sink: (l) => lines.push(l),
    });
    await audit.append({ kind: 'paypal_call', op: 'capture', tsMs: 1 });
    expect(lines[0]).toContain('payment audit');
  });
});
