import { describe, expect, it } from 'vitest';
import { parseUtterance } from '@gavel/voice';
import {
  applyG5ToGates,
  classify,
  deepgramTranscribe,
  G5_UTTERANCES,
  groqTranscribe,
  renderEvidenceFile,
  renderG5Block,
  runG5,
  sha256Hex,
  summarize,
  type G5Fetch,
  type G5FormFetch,
  type G5Row,
  type G5Run,
} from '../src/gates/g5';

const bytes = new Uint8Array([1, 2, 3]);
const noKeyEnv = {};
const keyEnv = { DEEPGRAM_API_KEY: 'k'.repeat(40) };

const row = (outcome: G5Row['outcome'], noise = 'crowd-snr-10db'): G5Row => ({
  id: 'x',
  noise,
  heard: '',
  outcome,
  latencyMs: 0,
});

describe('G5 utterance set', () => {
  it('holds 20 distinct noisy utterances with labels', () => {
    expect(G5_UTTERANCES).toHaveLength(20);
    expect(new Set(G5_UTTERANCES.map((u) => u.id)).size).toBe(20);
    expect(G5_UTTERANCES.every((u) => u.noise.includes('snr') && u.amountCents > 0)).toBe(true);
  });

  it('parses every reference text to its label (the parser alone is not the problem)', () => {
    const wrong = G5_UTTERANCES.filter((u) => classify(parseUtterance(u.text, {}), u) !== 'exact');
    // A few phrasings are ambiguous by design and must come back as a confirm, never a wrong accept.
    for (const u of wrong) {
      expect(classify(parseUtterance(u.text, {}), u)).not.toBe('wrong_accept');
    }
    expect(G5_UTTERANCES.length - wrong.length).toBeGreaterThanOrEqual(10);
  });
});

describe('classify', () => {
  const u = G5_UTTERANCES[0];
  it('rejects a different amount as a wrong accept', () => {
    if (u === undefined) throw new Error('no utterance');
    expect(classify(parseUtterance('five hundred for paddle six', {}), u)).toBe('wrong_accept');
    expect(classify(parseUtterance('what a lovely room', {}), u)).toBe('none');
  });
});

describe('summarize and verdict', () => {
  it('passes at 90 percent usable with no wrong accept', () => {
    const rows = [
      ...Array(17)
        .fill(0)
        .map(() => row('exact')),
      row('confirm_recoverable'),
      row('confirm_recoverable'),
      row('none'),
    ];
    const s = summarize(rows);
    expect(s.usableRate).toBeCloseTo(0.95);
    expect(s.verdict).toBe('PASS');
    expect(s.confirmRate).toBeCloseTo(0.1);
  });

  it('is partial between 70 and 90 percent and fail below, or with too many wrong accepts', () => {
    const mk = (exact: number, none: number, wrong = 0): G5Row[] => [
      ...Array(exact)
        .fill(0)
        .map(() => row('exact')),
      ...Array(none)
        .fill(0)
        .map(() => row('none')),
      ...Array(wrong)
        .fill(0)
        .map(() => row('wrong_accept')),
    ];
    expect(summarize(mk(16, 4)).verdict).toBe('PARTIAL');
    expect(summarize(mk(10, 10)).verdict).toBe('FAIL');
    expect(summarize(mk(17, 0, 3)).verdict).toBe('FAIL');
    expect(summarize(mk(19, 0, 1)).verdict).toBe('PASS');
  });

  it('handles an empty run', () => {
    expect(summarize([]).verdict).toBe('FAIL');
  });
});

describe('runG5', () => {
  const clock = (): (() => number) => {
    let t = 0;
    return () => (t += 5);
  };

  it('skips without a key and never calls the provider', async () => {
    let called = false;
    const r = await runG5({
      env: noKeyEnv,
      readAudio: () => bytes,
      transcribe: async () => {
        called = true;
        return '';
      },
      now: clock(),
    });
    expect(r).toEqual({ status: 'skipped', reason: 'DEEPGRAM_API_KEY is not set' });
    expect(called).toBe(false);
  });

  it('skips when recordings are missing', async () => {
    const r = await runG5({
      env: keyEnv,
      readAudio: (id) => (id === 'g5-01' ? bytes : undefined),
      transcribe: async () => '',
      now: clock(),
    });
    expect(r).toEqual({ status: 'skipped', reason: '19 of 20 recordings missing' });
  });

  it('runs every utterance through the provider and the parser', async () => {
    const byAudio = new Map(G5_UTTERANCES.map((u, i) => [i, u.text]));
    let i = 0;
    const r = await runG5({
      env: keyEnv,
      readAudio: () => bytes,
      transcribe: async (_a, key) => {
        expect(key).toBe(keyEnv.DEEPGRAM_API_KEY);
        return byAudio.get(i++) ?? '';
      },
      now: clock(),
    });
    if (r.status !== 'done') throw new Error('expected a run');
    expect(r.rows).toHaveLength(20);
    expect(r.rows.every((x) => x.latencyMs === 5)).toBe(true);
    expect(r.summary.wrongAccept).toBe(0);
    expect(r.summary.exact).toBeGreaterThanOrEqual(10);
  });
});

describe('deepgramTranscribe', () => {
  it('sends the key in a header only and reads the transcript', async () => {
    const seen: { url: string; auth: string | undefined }[] = [];
    const f: G5Fetch = async (url, init) => {
      seen.push({ url, auth: init.headers['Authorization'] });
      return {
        status: 200,
        json: async () => ({
          results: { channels: [{ alternatives: [{ transcript: 'hello' }] }] },
        }),
      };
    };
    expect(await deepgramTranscribe(bytes, 'KEY', f)).toBe('hello');
    expect(seen[0]?.auth).toBe('Token KEY');
    expect(seen[0]?.url).not.toContain('KEY');
  });

  it('throws on a bad status without echoing the key', async () => {
    const f: G5Fetch = async () => ({ status: 401, json: async () => ({}) });
    await expect(deepgramTranscribe(bytes, 'KEY', f)).rejects.toThrow('answered 401');
  });
});

describe('GATES.md block', () => {
  const done: Extract<G5Run, { status: 'done' }> = {
    status: 'done',
    rows: [row('exact'), row('exact', 'street-snr-8db'), row('none', 'street-snr-8db')],
    summary: summarize([
      row('exact'),
      row('exact', 'street-snr-8db'),
      row('none', 'street-snr-8db'),
    ]),
  };
  const md = [
    '# Gates',
    '',
    '## G5: STT accuracy on noisy bids',
    '',
    'Status: NOT RUN',
    'Run date / by: n/a',
    'Setup: n/a',
    'Observed: n/a',
    'Verdict: n/a',
    'Decision: n/a',
    '',
    '### G5-text: text-level run (step 1)',
    '',
    'text stuff',
    '',
    '## Next section',
    '',
    'Status: NOT RUN',
    '',
  ].join('\n');

  it('renders the accuracy table', () => {
    const block = renderG5Block(done, '2026-11-05');
    expect(block).toContain('| crowd-snr-10db | 1 | 1 | 0 | 0 | 0 |');
    expect(block).toContain('| all | 3 | 2 | 0 | 0 | 1 |');
    expect(block).toContain('Verdict: FAIL');
  });

  it('sets the G5 fields, adds the block and leaves other sections alone', () => {
    const out = applyG5ToGates(md, done, '2026-11-05');
    expect(out).not.toContain('Status: RUN');
    expect(out).toContain('Status: FAIL');
    expect(out).toMatch(/^Evidence: .+/m);
    expect(out).toContain('Verdict: FAIL');
    expect(out).toContain('### G5-live');
    expect(out).toContain('text stuff');
    expect(out.split('## Next section')[1]).toContain('Status: NOT RUN');
    // A second run replaces the block instead of adding another.
    const again = applyG5ToGates(out, done, '2026-11-06');
    expect(again.match(/### G5-live/g)).toHaveLength(1);
    expect(again).toContain('Run 2026-11-06.');
  });

  it('refuses a file without a G5 section', () => {
    expect(() => applyG5ToGates('# nothing', done, '2026-11-05')).toThrow('no G5 section');
  });
});

describe('Groq measurement and evidence file', () => {
  it('skips Groq without GROQ_API_KEY and never calls the provider', async () => {
    let calls = 0;
    const run = await runG5(
      {
        env: keyEnv,
        readAudio: () => bytes,
        transcribe: async () => {
          calls += 1;
          return '';
        },
        now: () => 0,
      },
      'groq',
    );
    expect(run).toEqual({ status: 'skipped', reason: 'GROQ_API_KEY is not set' });
    expect(calls).toBe(0);
  });

  it('measures Groq when the key is set', async () => {
    const run = await runG5(
      {
        env: { GROQ_API_KEY: 'g'.repeat(40) },
        readAudio: () => bytes,
        transcribe: async () => 'what a lovely room',
        now: () => 0,
      },
      'groq',
    );
    expect(run.status).toBe('done');
    if (run.status === 'done') expect(run.provider).toBe('groq');
  });

  it('sends the key only in the header and throws on a bad status', async () => {
    const seen: { url: string; auth: string | undefined }[] = [];
    const ok: G5FormFetch = async (url, init) => {
      seen.push({ url, auth: init.headers['Authorization'] });
      return { status: 200, json: async () => ({ text: 'hello' }) };
    };
    expect(await groqTranscribe(bytes, 'KEY', ok)).toBe('hello');
    expect(seen[0]?.auth).toBe('Bearer KEY');
    expect(seen[0]?.url).not.toContain('KEY');
    const bad: G5FormFetch = async () => ({ status: 429, json: async () => ({}) });
    await expect(groqTranscribe(bytes, 'KEY', bad)).rejects.toThrow('answered 429');
  });

  it('writes a redacted evidence file and points the Evidence line at it with its sha256', () => {
    const rows = [{ ...row('exact'), heard: 'secret words' }, row('none')];
    const done: Extract<G5Run, { status: 'done' }> = {
      status: 'done',
      provider: 'groq',
      rows,
      summary: summarize(rows),
    };
    const text = renderEvidenceFile(done, '2026-11-05');
    expect(text).not.toContain('secret words');
    expect(text).toContain('"provider": "groq"');
    const sha = sha256Hex(text);
    expect(sha).toMatch(/^[0-9a-f]{64}$/);
    const md = '## G5: x\n\nStatus: NOT RUN\nRun date / by: n/a\n\n## Next\n';
    const out = applyG5ToGates(md, done, '2026-11-05', {
      path: 'docs/evidence/g5-groq-2026-11-05.json',
      sha256: sha,
    });
    expect(out).toContain(
      `Evidence: redacted evidence file docs/evidence/g5-groq-2026-11-05.json (sha256 ${sha})`,
    );
  });
});
