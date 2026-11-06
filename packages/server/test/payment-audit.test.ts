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

  it('writes a settlement state change once per auction and seq, also after a restart (RT4-saga-04)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gavel-audit-'));
    dirs.push(dir);
    const file = join(dir, 'payment-audit.jsonl');
    const lines: string[] = [];
    const open = () =>
      createPaymentAudit({ clock: new ManualClock(1), sink: (l) => lines.push(l), file });
    const row = (seq: number) => ({
      kind: 'state_change' as const,
      auctionId: 'L1',
      from: 'CAPTURING',
      to: 'CAPTURED',
      label: 'journaled:capture_ok',
      seq,
      tsMs: 5,
    });
    const first = open();
    await first.append(row(4));
    // The saga writes the row again after a crash between the row and its next save.
    await first.append(row(4));
    const restarted = open();
    await restarted.append(row(4));
    await restarted.append(row(5));
    // Rows that record no history entry are all kept.
    const hold = { kind: 'state_change' as const, auctionId: 'L1', holdId: 'H1', tsMs: 6 };
    await restarted.append(hold);
    await restarted.append(hold);
    await restarted.append({ ...row(4), auctionId: 'L2' });
    const stored = readFileSync(file, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as { auctionId: string; seq?: number });
    expect(stored.map((e) => [e.auctionId, e.seq])).toEqual([
      ['L1', 4],
      ['L1', 5],
      ['L1', undefined],
      ['L1', undefined],
      ['L2', 4],
    ]);
    expect(lines).toHaveLength(5);
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
