import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EXIT_OK, runCli, type CliDeps } from '../../src/eval/cli.js';
import { parseUtterance } from '../../src/parser/utterance.js';
import { gateUtterance } from '../../src/eval/gate.js';

const fixture = (p: string): string => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

const base = {
  text: 'paddle seven three hundred',
  speaker: null,
  currentPriceCents: 10_000,
  minIncrementCents: 1_000,
} as const;

describe('gateUtterance (issue 1865)', () => {
  it('holds a clean bid for confirmation on the room mic', () => {
    const g = gateUtterance({ ...base, mic: 'room', sttConfidence: 0.99 });
    expect(g.decision).toBe('confirm');
    expect(g.actual.kind).toBe('confirm');
    expect(g.sttSource).toBe('recorded');
  });

  it('never auto-accepts a rules-only bid, even a confident clean one', () => {
    const g = gateUtterance({ ...base, mic: 'device', sttConfidence: 0.99 });
    expect(g.decision).toBe('confirm');
    expect(g.confidence).toBeLessThan(0.85);
  });

  it('auto-accepts a clean, confident bid once a model reading agrees, off the room mic', () => {
    const llm = (text: string, ctx: Parameters<typeof parseUtterance>[1]) =>
      parseUtterance(text, ctx);
    const device = gateUtterance({ ...base, mic: 'device', sttConfidence: 0.99, llm });
    expect(device.actual).toEqual({ kind: 'accept', pair: { who: '7', amountCents: 30_000 } });
    expect(device.decision).toBe('auto');
    const room = gateUtterance({ ...base, mic: 'room', sttConfidence: 0.99, llm });
    expect(room.decision).toBe('confirm');
  });

  it('never accepts below AUTO when the speech confidence is low', () => {
    const g = gateUtterance({ ...base, mic: 'device', sttConfidence: 0.5 });
    expect(g.decision).not.toBe('auto');
  });

  it('marks an unrecorded confidence as assumed, not recorded', () => {
    const g = gateUtterance({ ...base, mic: 'device' });
    expect(g.sttSource).toBe('neutral_assumed');
  });

  it('drops speech that is not a bid', () => {
    const g = gateUtterance({ ...base, text: 'going once', mic: 'room' });
    expect(g.decision).toBe('drop');
    expect(g.actual).toEqual({ kind: 'none' });
  });
});

describe('eval cli reports parse accuracy and gate outcome', () => {
  function run(
    args: string[],
  ): Promise<{ code: number; json: Record<string, unknown>; md: string }> {
    const written = new Map<string, string>();
    const deps: CliDeps = {
      readFile: fixture,
      exists: () => false,
      writeFile: (p, d) => written.set(p, d),
      env: {},
      gitSha: () => 'abc1234',
      log: () => undefined,
    };
    return runCli(args, deps).then((code) => ({
      code,
      json: JSON.parse(written.get('eval-out/report.json') ?? '{}') as Record<string, unknown>,
      md: written.get('eval-out/report.md') ?? '',
    }));
  }

  it('keeps the parser metrics and adds the room gate section', async () => {
    const r = await run(['--mode', 'text']);
    expect(r.code).toBe(EXIT_OK);
    const gated = r.json['gated'] as {
      mic: string;
      outcomes: { auto: number; confirm: number; drop: number };
      sttConfidence: { recorded: number; neutralAssumed: number };
      metrics: { n: number };
    };
    expect(gated.mic).toBe('room');
    // The room mic forces confirm, and a rules-only bid scores below AUTO anyway.
    expect(gated.outcomes.auto).toBe(0);
    expect(gated.outcomes.confirm).toBeGreaterThan(0);
    expect(gated.sttConfidence.recorded).toBe(0);
    expect(gated.sttConfidence.neutralAssumed).toBe(gated.metrics.n);
    expect((r.json['metrics'] as { n: number }).n).toBe(gated.metrics.n);
    expect(r.md).toContain('## Room gate (AUTO/CONFIRM)');
  });

  it('reports a rules-only run under the device mic with no auto accepts', async () => {
    const r = await run(['--mode', 'text', '--mic', 'device']);
    const gated = r.json['gated'] as {
      mic: string;
      outcomes: { auto: number; confirm: number; drop: number };
    };
    expect(gated.mic).toBe('device');
    expect(gated.outcomes.auto).toBe(0);
  });
});
