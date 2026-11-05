import { describe, expect, it } from 'vitest';
import { evaluate } from '../../src/eval/metrics.js';
import { renderReport, SWEEP_THRESHOLDS, type ReportItem } from '../../src/eval/report.js';

const pair = (who: string, amountCents: number) => ({ who, amountCents });

function item(id: string, category: string, confidence: number, over: Partial<ReportItem>) {
  const base: ReportItem = {
    id,
    category,
    confidence,
    expected: { outcome: 'bid', pair: pair('4', 30000) },
    actual: { kind: 'accept', pair: pair('4', 30000) },
    latencyMs: 10,
    provider: 'fake',
  };
  return { ...base, ...over };
}

const items: ReportItem[] = [
  item('b-02', 'plain', 0.97, {}),
  item('a-01', 'plain', 0.72, {}),
  item('c-03', 'hedged', 0.9, { actual: { kind: 'accept', pair: pair('4', 20000) } }),
  item('d-04', 'question', 0.5, {
    expected: { outcome: 'none' },
    actual: { kind: 'confirm', candidates: [pair('4', 30000)] },
  }),
  item('e-05', 'plain', 0.5, { actual: { kind: 'none' } }),
];

const meta = { gitSha: 'abc1234', mode: 'text', set: 'dev', provider: 'none', items };

describe('T-VOX-086 report (R-VOX-078)', () => {
  it('is byte-identical for the same inputs, whatever the input order', () => {
    const a = renderReport(evaluate(items), meta);
    const b = renderReport(evaluate([...items].reverse()), {
      ...meta,
      items: [...items].reverse(),
    });
    expect(b.json).toBe(a.json);
    expect(b.markdown).toBe(a.markdown);
  });

  it('writes per-category table, a 6 row sweep and the sha line', () => {
    const { markdown, json } = renderReport(evaluate(items), meta);
    expect(markdown).toContain('## Per category');
    expect(markdown).toContain('| plain | 3 |');
    expect(markdown).toContain('Git sha: abc1234');
    const sweepBlock = markdown.split('## Threshold sweep (AUTO)')[1]?.split('## Confusions')[0];
    const dataRows = (sweepBlock ?? '').split('\n').filter((l) => /^\| 0\.\d\d /.test(l));
    expect(dataRows).toHaveLength(6);
    expect(SWEEP_THRESHOLDS).toEqual([0.7, 0.75, 0.8, 0.85, 0.9, 0.95]);
    const parsed = JSON.parse(json) as { gitSha: string; sweep: unknown[] };
    expect(parsed.gitSha).toBe('abc1234');
    expect(parsed.sweep).toHaveLength(6);
  });

  it('turns low confidence accepts into confirms as the threshold rises', () => {
    const { json } = renderReport(evaluate(items), meta);
    const parsed = JSON.parse(json) as {
      sweep: Array<{ threshold: number; wrongAcceptRate: number; confirmRate: number }>;
    };
    const first = parsed.sweep[0];
    const last = parsed.sweep[5];
    expect(first?.threshold).toBe(0.7);
    expect(last?.threshold).toBe(0.95);
    expect(last?.confirmRate ?? 0).toBeGreaterThan(first?.confirmRate ?? 1);
    expect(last?.wrongAcceptRate ?? 1).toBeLessThan(first?.wrongAcceptRate ?? 0);
  });

  it('lists confusions and states the assist mode notice on a failed gate', () => {
    const { json, markdown } = renderReport(evaluate(items), meta);
    const parsed = JSON.parse(json) as { confusion: Array<{ id: string; kind: string }> };
    expect(parsed.confusion.map((c) => `${c.id}:${c.kind}`)).toEqual([
      'c-03:wrong_accept',
      'd-04:false_prompt',
      'e-05:missed_bid',
    ]);
    expect(markdown).toContain('assist mode');
  });
});
