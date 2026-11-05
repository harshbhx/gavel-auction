import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadScenarioFile } from '../src/dsl/load';
import { main, parseArgs } from '../src/runner/cli';
import { evaluateInvariants } from '../src/runner/invariants';
import { runScenarioInProc } from '../src/runner/inproc';

const S01 = fileURLToPath(new URL('../scenarios/S01-happy-path.yaml', import.meta.url));

describe('in-process scenario runner (T-QA-027)', () => {
  it('runs S01 without a browser in under 2 s and holds I1 to I5', { timeout: 2000 }, async () => {
    const result = await runScenarioInProc(loadScenarioFile(S01));
    expect(result.failures).toEqual([]);
    expect(result.outcome.winner).toBe('ana');
    expect(result.outcome.invariants).toEqual({ I1: true, I2: true, I3: true, I4: true, I5: true });
    expect(result.trace[0]?.kind).toBe('start');
  });

  it('records the seed override in the trace header', async () => {
    const result = await runScenarioInProc(loadScenarioFile(S01), { seed: 77 });
    expect(result.seed).toBe(77);
    expect(result.trace[0]?.data['seed']).toBe(77);
  });

  it('an altered expectation gives a diff and a non-zero exit, and the trace is written', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gavel-runner-'));
    const text = readFileSync(S01, 'utf8').replace('captured: 10000', 'captured: 9999');
    const file = join(dir, 'S01-altered.yaml');
    writeFileSync(file, text);
    const traces = join(dir, 'traces');
    const code = await main([file, '--trace', traces]);
    expect(code).toBe(1);
    expect(readdirSync(traces)).toEqual(['S01-happy-path.ndjson']);
    const lines = readFileSync(join(traces, 'S01-happy-path.ndjson'), 'utf8').trim().split('\n');
    expect(lines.length).toBeGreaterThan(5);
    for (const l of lines) expect(() => JSON.parse(l)).not.toThrow();
  });

  it('exits 0 for a passing scenario and 2 for bad usage', async () => {
    expect(await main([S01])).toBe(0);
    expect(await main([])).toBe(2);
    expect(() => parseArgs(['--seed', 'x'])).toThrow();
  });

  it('flags a second capture and a captured loser', () => {
    const base = { holdCents: 100, ceilingCents: 100, releasedCents: 0, voided: false };
    const inv = evaluateInvariants({
      winner: 'a',
      fakeOk: true,
      entries: [],
      holds: [
        { actor: 'a', ...base, capturedCents: 60, captureCount: 1 },
        { actor: 'b', ...base, capturedCents: 10, captureCount: 1 },
      ],
    });
    expect(inv.I1).toBe(false);
    expect(inv.I3).toBe(false);
  });
});
