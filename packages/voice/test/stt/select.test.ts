import { describe, expect, it } from 'vitest';
import { FakeStt, VirtualClock } from '../../src/stt/fake.js';
import { classifyHttpStatus, type FetchLike } from '../../src/stt/groq.js';
import type { SttProvider } from '../../src/stt/provider.js';
import { SttConfigError, selectProvider, type SttName } from '../../src/stt/select.js';
import { scanText } from '../../scripts/secret-scan.js';

const noFetch: FetchLike = () => Promise.reject(new Error('no network in tests'));

function stub(name: SttName): SttProvider {
  const inner = new FakeStt({ clock: new VirtualClock() });
  return Object.create(inner, { name: { value: name } }) as SttProvider;
}

const deepgramFactory = (): SttProvider => stub('deepgram');

describe('T-VOX-022 provider selection matrix', () => {
  it('unset prefers deepgram, then groq', () => {
    const both = selectProvider(
      { DEEPGRAM_API_KEY: 'k1', GROQ_API_KEY: 'k2' },
      { factories: { deepgram: deepgramFactory }, fetch: noFetch },
    );
    expect(both.name).toBe('deepgram');
    const groqOnly = selectProvider({ GROQ_API_KEY: 'k2' }, { fetch: noFetch });
    expect(groqOnly.name).toBe('groq');
    const noDeepgramBuild = selectProvider(
      { DEEPGRAM_API_KEY: 'k1', GROQ_API_KEY: 'k2' },
      { fetch: noFetch },
    );
    expect(noDeepgramBuild.name).toBe('groq');
  });

  it('warns when a configured default cannot be built and the next provider is used', () => {
    const warnings: Array<{ message: string; provider: string; usedInstead?: string }> = [];
    const p = selectProvider(
      { DEEPGRAM_API_KEY: 'k1', GROQ_API_KEY: 'k2' },
      {
        fetch: noFetch,
        warn: (message, fields) => warnings.push({ message, ...fields }),
      },
    );
    expect(p.name).toBe('groq');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ provider: 'deepgram', usedInstead: 'groq' });
    expect(warnings[0]?.message).not.toContain('k1');
  });

  it('does not warn when the first provider is built', () => {
    const warnings: string[] = [];
    selectProvider(
      { DEEPGRAM_API_KEY: 'k1', GROQ_API_KEY: 'k2' },
      { factories: { deepgram: deepgramFactory }, fetch: noFetch, warn: (m) => warnings.push(m) },
    );
    expect(warnings).toEqual([]);
  });

  it('nothing configured is a typed error', () => {
    expect(() => selectProvider({}, { fetch: noFetch })).toThrow(SttConfigError);
  });

  it('an unknown value lists the allowed values', () => {
    try {
      selectProvider({ VOICE_STT: 'whisperx' });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(SttConfigError);
      const err = e as SttConfigError;
      expect(err.code).toBe('unknown_provider');
      for (const n of ['deepgram', 'groq', 'webspeech', 'fake', 'replay']) {
        expect(err.message).toContain(n);
      }
    }
  });

  it('an explicit choice is honoured and fake needs no key', () => {
    expect(selectProvider({ VOICE_STT: 'fake' }).name).toBe('fake');
    expect(selectProvider({ VOICE_STT: 'GROQ', GROQ_API_KEY: 'k' }, { fetch: noFetch }).name).toBe(
      'groq',
    );
  });

  it('missing key is a typed auth-style config error that never echoes a key', () => {
    try {
      selectProvider({ VOICE_STT: 'groq', DEEPGRAM_API_KEY: 'zz9q' });
      expect.unreachable();
    } catch (e) {
      const err = e as SttConfigError;
      expect(err.code).toBe('missing_key');
      expect(err.message).not.toContain('zz9q');
    }
  });

  it('an explicit provider without a build is unavailable', () => {
    expect(() => selectProvider({ VOICE_STT: 'replay' })).toThrow(SttConfigError);
    expect(() => selectProvider({ VOICE_STT: 'deepgram', DEEPGRAM_API_KEY: 'k' })).toThrow(
      /not available/,
    );
  });

  it('logs the selection once and never the key', () => {
    const lines: string[] = [];
    selectProvider(
      { GROQ_API_KEY: 'zz9q' },
      { fetch: noFetch, log: (m, f) => lines.push(`${m} ${JSON.stringify(f)}`) },
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('groq');
    expect(lines[0]).not.toContain('zz9q');
  });
});

describe('T-VOX-099 error classification', () => {
  it('429 and 5xx retry, 401 and 403 do not', () => {
    expect(classifyHttpStatus(429).retryable).toBe(true);
    expect(classifyHttpStatus(503).retryable).toBe(true);
    expect(classifyHttpStatus(401)).toEqual({ code: 'auth', retryable: false });
    expect(classifyHttpStatus(403)).toEqual({ code: 'auth', retryable: false });
  });
});

describe('T-VOX-023 secret scan', () => {
  it('flags key-shaped strings without returning them', () => {
    const groq = `const k = "${'gsk_' + 'a1'.repeat(15)}";`;
    const hex = `x = ${'ab12'.repeat(10)}`;
    const found = scanText('f.ts', `ok\n${groq}\n${hex}\n`);
    expect(found).toEqual([
      { file: 'f.ts', line: 2, pattern: 'groq-key' },
      { file: 'f.ts', line: 3, pattern: 'long-hex' },
    ]);
    expect(JSON.stringify(found)).not.toContain('gsk_');
  });

  it('passes ordinary code', () => {
    expect(scanText('f.ts', 'const apiKey = env.GROQ_API_KEY;')).toEqual([]);
  });
});
