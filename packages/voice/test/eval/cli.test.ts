import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EXIT_FAILED,
  EXIT_NO_KEYS,
  EXIT_OK,
  LIVE_CONCURRENCY,
  mapLimited,
  parseArgs,
  redact,
  runCli,
  type CliDeps,
} from '../../src/eval/cli.js';

const fixture = (p: string): string => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

interface Harness {
  deps: CliDeps;
  logs: string[];
  written: Map<string, string>;
  reads: string[];
}

function harness(extra: Record<string, string> = {}, env: Record<string, string> = {}): Harness {
  const logs: string[] = [];
  const written = new Map<string, string>();
  const reads: string[] = [];
  const files = new Map<string, string>(Object.entries(extra));
  const dirs = new Set(['fixtures/stt-cache/deepgram', 'fixtures/model-cache']);
  const deps: CliDeps = {
    readFile: (p) => {
      reads.push(p);
      const mem = files.get(p);
      if (mem !== undefined) return mem;
      return fixture(p);
    },
    exists: (p) => dirs.has(p) || files.has(p),
    writeFile: (p, data) => {
      written.set(p, data);
    },
    env,
    gitSha: () => 'abc1234',
    log: (line) => logs.push(line),
  };
  return { deps, logs, written, reads };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('T-VOX-083 modes (R-VOX-075)', () => {
  it('parses flags and rejects bad ones', () => {
    expect(parseArgs(['--mode', 'cached', '--provider', 'groq', '--set', 'dev'])).toMatchObject({
      mode: 'cached',
      provider: 'groq',
      set: 'dev',
    });
    expect(parseArgs(['--mode', 'fast'])).toMatch(/--mode/);
    expect(parseArgs(['--set'])).toMatch(/missing value/);
    expect(parseArgs(['--nope', 'x'])).toMatch(/unknown flag/);
  });

  it('text mode needs no env and makes no network call', async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error('network is disabled');
    });
    vi.stubGlobal('fetch', fetchSpy);
    const h = harness();
    const code = await runCli(['--mode', 'text', '--set', 'dev'], h.deps);
    expect(code).toBe(EXIT_OK);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(h.reads).toEqual(['fixtures/text/cases.json']);
    const json = JSON.parse(h.written.get('eval-out/report.json') ?? '{}') as {
      mode: string;
      metrics: { n: number };
    };
    expect(json.mode).toBe('text');
    expect(json.metrics.n).toBeGreaterThan(100);
    expect(h.written.has('eval-out/report.md')).toBe(true);
  });

  it('text mode gives the same report.json twice', async () => {
    const a = harness();
    const b = harness();
    await runCli(['--mode', 'text'], a.deps);
    await runCli(['--mode', 'text'], b.deps);
    expect(b.written.get('eval-out/report.json')).toBe(a.written.get('eval-out/report.json'));
  });

  it('cached mode reads the recorded provider output', async () => {
    const manifest = JSON.parse(fixture('fixtures/audio/manifest.json')) as Array<{
      id: string;
      text: string;
    }>;
    const extra: Record<string, string> = {};
    for (const m of manifest) {
      extra[`fixtures/stt-cache/deepgram/${m.id}.json`] = JSON.stringify({
        text: m.text,
        latencyMs: 120,
      });
    }
    const h = harness(extra);
    const code = await runCli(['--mode', 'cached', '--provider', 'deepgram'], h.deps);
    expect(code).toBe(EXIT_OK);
    expect(h.reads.filter((r) => r.startsWith('fixtures/stt-cache/deepgram/'))).toHaveLength(
      manifest.length,
    );
    const json = JSON.parse(h.written.get('eval-out/report.json') ?? '{}') as {
      metrics: { n: number; latencyP50Ms: number };
    };
    expect(json.metrics.n).toBe(manifest.length);
    expect(json.metrics.latencyP50Ms).toBe(120);
  });

  it('cached mode fails with a message when a recording is missing', async () => {
    const h = harness();
    const code = await runCli(['--mode', 'cached'], h.deps);
    expect(code).toBe(EXIT_FAILED);
    expect(h.logs.join('\n')).toMatch(/missing fixtures\/stt-cache\/deepgram\//);
  });

  it('live mode without a key exits with code 2 and names the variable', async () => {
    const h = harness();
    const code = await runCli(['--mode', 'live', '--provider', 'groq'], h.deps);
    expect(code).toBe(EXIT_NO_KEYS);
    expect(h.logs.join('\n')).toContain('GROQ_API_KEY');
    expect(h.written.size).toBe(0);
  });
});

describe('T-VOX-088 live limits (R-VOX-080)', () => {
  it('never runs more than 2 calls at once over 10 items', async () => {
    let active = 0;
    let peak = 0;
    const out = await mapLimited(
      Array.from({ length: 10 }, (_v, i) => i),
      LIVE_CONCURRENCY,
      async (i) => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 1));
        active -= 1;
        return i * 2;
      },
    );
    expect(peak).toBe(2);
    expect(out).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18]);
  });

  it('live runs cap concurrency and never log the key', async () => {
    const key = ['zz', 'unit', 'marker', '42'].join('-');
    let active = 0;
    let peak = 0;
    const h = harness({}, { DEEPGRAM_API_KEY: key });
    h.deps.transcribe = async (id, _provider, k) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 1));
      active -= 1;
      if (id === 'a05') throw new Error(`request rejected for ${k}`);
      return { text: 'three hundred' };
    };
    const failed = await runCli(['--mode', 'live'], h.deps);
    expect(failed).toBe(EXIT_FAILED);
    expect(peak).toBeLessThanOrEqual(LIVE_CONCURRENCY);
    expect(h.logs.join('\n')).not.toContain(key);
    expect(h.logs.join('\n')).toContain('[redacted]');
  });

  it('redact removes every occurrence and ignores empty secrets', () => {
    expect(redact('a k1 b k1', ['k1', ''])).toBe('a [redacted] b [redacted]');
  });
});
