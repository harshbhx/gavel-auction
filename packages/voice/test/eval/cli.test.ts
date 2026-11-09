import { existsSync, readFileSync } from 'node:fs';
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
  dirs: Set<string>;
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
  return { deps, logs, written, reads, dirs };
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
    expect(parseArgs(['--mic', 'device'])).toMatchObject({ mic: 'device' });
    expect(parseArgs([])).toMatchObject({ mic: 'room' });
    expect(parseArgs(['--mic', 'hall'])).toMatch(/--mic/);
    expect(parseArgs(['--model', 'agree'])).toMatchObject({ model: 'agree' });
    expect(parseArgs(['--model', 'big'])).toMatch(/--model/);
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

  it('--clips human reads the separate human-like cache and rejects other sets', async () => {
    expect(parseArgs(['--clips', 'human'])).toMatchObject({ clips: 'human' });
    expect(parseArgs(['--clips', 'robot'])).toMatch(/--clips/);
    const manifest = JSON.parse(fixture('fixtures/audio/manifest.json')) as Array<{
      id: string;
      text: string;
    }>;
    const extra: Record<string, string> = {};
    for (const m of manifest) {
      extra[`fixtures/stt-cache-human/groq/${m.id}.json`] = JSON.stringify({
        text: m.text,
        latencyMs: 80,
      });
    }
    const h = harness(extra);
    h.dirs.add('fixtures/stt-cache-human/groq');
    const code = await runCli(
      ['--mode', 'cached', '--provider', 'groq', '--clips', 'human'],
      h.deps,
    );
    expect(code).toBe(EXIT_OK);
    expect(h.reads.filter((r) => r.startsWith('fixtures/stt-cache-human/groq/'))).toHaveLength(
      manifest.length,
    );
    expect(h.reads.some((r) => r.startsWith('fixtures/stt-cache/groq/'))).toBe(false);
  });

  it('cached mode fails with a message when a recording is missing', async () => {
    const h = harness();
    const code = await runCli(['--mode', 'cached'], h.deps);
    expect(code).toBe(EXIT_FAILED);
    expect(h.logs.join('\n')).toMatch(/missing fixtures\/stt-cache\/deepgram\//);
  });

  it('cached mode fails, never passes, when the recorded provider directory is absent', async () => {
    const h = harness();
    h.dirs.delete('fixtures/stt-cache/deepgram');
    const code = await runCli(['--mode', 'cached'], h.deps);
    expect(code).toBe(EXIT_FAILED);
    expect(h.logs.join('\n')).toMatch(/no recorded provider output/);
    expect(h.written.size).toBe(0);
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

  it('live --record writes provider text per clip and no key', async () => {
    const key = ['zz', 'rec', 'marker', '7'].join('-');
    const h = harness({}, { DEEPGRAM_API_KEY: key });
    h.deps.transcribe = async () => ({ text: 'three hundred', confidence: 0.9 });
    const code = await runCli(
      ['--mode', 'live', '--record', 'fixtures/stt-cache', '--out', 'o'],
      h.deps,
    );
    expect(code).toBe(EXIT_OK);
    const rec = h.written.get('fixtures/stt-cache/deepgram/a01.json') ?? '';
    expect(JSON.parse(rec)).toMatchObject({ text: 'three hundred', confidence: 0.9 });
    expect([...h.written.values()].join('\n')).not.toContain(key);
    expect([...h.written.keys()].filter((k) => k.includes('stt-cache'))).toHaveLength(24);
  });

  it('live --resume reuses recorded clips and asks the provider only for the rest', async () => {
    const h = harness(
      { 'fixtures/stt-cache/deepgram/a01.json': '{"text":"three hundred","latencyMs":5}' },
      { DEEPGRAM_API_KEY: 'k' },
    );
    const asked: string[] = [];
    h.deps.transcribe = async (id) => {
      asked.push(id);
      return { text: 'two fifty' };
    };
    const code = await runCli(
      ['--mode', 'live', '--record', 'fixtures/stt-cache', '--resume', 'true'],
      h.deps,
    );
    expect(code).toBe(EXIT_OK);
    expect(asked).toHaveLength(23);
    expect(asked).not.toContain('a01');
  });

  it('--clips heldout asks for the 120 held-out noisy clips and records apart from the other sets', async () => {
    expect(parseArgs(['--clips', 'heldout'])).toMatchObject({ clips: 'heldout' });
    const h = harness({}, { GROQ_API_KEY: 'k' });
    const asked: string[] = [];
    h.deps.recordingExists = () => true;
    h.deps.transcribe = async (id) => {
      asked.push(id);
      return { text: 'stub transcript for plumbing only' };
    };
    const code = await runCli(
      [
        '--mode',
        'live',
        '--provider',
        'groq',
        '--clips',
        'heldout',
        '--record',
        'fixtures/stt-cache-heldout',
      ],
      h.deps,
    );
    expect(code).toBe(EXIT_OK);
    expect(asked).toHaveLength(120);
    expect(asked.every((id) => /^h\d\d-s(20|10|5)-(room|babble)$/.test(id))).toBe(true);
    const recorded = [...h.written.keys()].filter((k) => k.startsWith('fixtures/'));
    expect(recorded).toHaveLength(120);
    expect(recorded.every((k) => k.startsWith('fixtures/stt-cache-heldout/groq/'))).toBe(true);
  });

  it('committed provider cache scores every audio clip for both providers', async () => {
    for (const provider of ['deepgram', 'groq'] as const) {
      const h = harness();
      h.deps.exists = (p) => existsSync(new URL(`../../${p}`, import.meta.url));
      const code = await runCli(['--mode', 'cached', '--provider', provider, '--out', 'o'], h.deps);
      expect(code).toBe(EXIT_OK);
      expect(h.logs.join('\n')).toContain('24 utterances');
    }
  });

  it('redact removes every occurrence and ignores empty secrets', () => {
    expect(redact('a k1 b k1', ['k1', ''])).toBe('a [redacted] b [redacted]');
  });
});

describe('expected paddle label of the audio manifest', () => {
  it('scores a spoken paddle against the manifest paddle, not an empty bidder', async () => {
    const manifest = JSON.parse(fixture('fixtures/audio/manifest.json')) as Array<{
      id: string;
      text: string;
    }>;
    const extra: Record<string, string> = {};
    for (const m of manifest) {
      extra[`fixtures/stt-cache/deepgram/${m.id}.json`] = JSON.stringify({
        text: m.text,
        latencyMs: 100,
      });
    }
    const h = harness(extra);
    const code = await runCli(['--mode', 'cached', '--provider', 'deepgram', '--out', 'o'], h.deps);
    expect(code).toBe(EXIT_OK);
    const json = JSON.parse(h.written.get('o/report.json') ?? '{}') as {
      utterances: Array<{ id: string; expected: string }>;
      confusion: Array<{ id: string; kind: string }>;
    };
    const a08 = json.utterances.find((u) => u.id === 'a08');
    expect(a08?.expected).toBe('bid 9 40000');
    const wrong = json.confusion.filter((c) => c.kind === 'wrong_accept').map((c) => c.id);
    expect(wrong).not.toContain('a08');
    expect(wrong).not.toContain('a09');
  });
});
