import { describe, expect, it, vi } from 'vitest';
import { EXIT_NO_KEYS, EXIT_OK, runCli, type CliDeps } from '../../src/eval/cli.js';
import {
  LIVE_DEEPGRAM_URL,
  LIVE_GROQ_MODEL,
  LIVE_GROQ_URL,
  createLiveTranscriber,
  transcribeLive,
  type LiveFetch,
  type LiveRequestInit,
} from '../../src/eval/live.js';
import { encodeWav } from '../../src/audio/wav.js';

const KEY = 'test-key-not-a-secret-123';
// Generated tone clip, 100 ms at 16 kHz.
const tone = encodeWav(
  Int16Array.from({ length: 1600 }, (_, i) => Math.round(8000 * Math.sin(i / 5))),
);
const noSleep = (): Promise<void> => Promise.resolve();

interface Call {
  url: string;
  init: LiveRequestInit;
}
function fakeFetch(statuses: number[], body: unknown): { fetch: LiveFetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchFn: LiveFetch = (url, init) => {
    calls.push({ url, init });
    const status = statuses[Math.min(calls.length - 1, statuses.length - 1)] ?? 500;
    return Promise.resolve({ status, json: () => Promise.resolve(body) });
  };
  return { fetch: fetchFn, calls };
}

const deepgramBody = {
  results: {
    channels: [
      {
        alternatives: [
          {
            transcript: 'bid five hundred',
            confidence: 0.93,
            words: [
              { word: 'bid', start: 0.1, end: 0.3 },
              { word: 'hundred', start: 0.9, end: 1.2 },
            ],
          },
        ],
      },
    ],
  },
};

describe('transcribeLive deepgram', () => {
  it('posts the wav with a Token header and maps the segment', async () => {
    const { fetch, calls } = fakeFetch([200], deepgramBody);
    const out = await transcribeLive('deepgram', tone, KEY, { fetch, sleep: noSleep });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(LIVE_DEEPGRAM_URL);
    expect(calls[0]?.init.method).toBe('POST');
    expect(calls[0]?.init.headers).toEqual({
      Authorization: `Token ${KEY}`,
      'Content-Type': 'audio/wav',
    });
    expect(calls[0]?.init.body).toBe(tone);
    expect(out).toEqual({
      text: 'bid five hundred',
      segments: [{ text: 'bid five hundred', startMs: 100, endMs: 1200, confidence: 0.93 }],
    });
  });

  it('returns empty text for an empty answer', async () => {
    const { fetch } = fakeFetch([200], { results: { channels: [] } });
    expect(await transcribeLive('deepgram', tone, KEY, { fetch, sleep: noSleep })).toEqual({
      text: '',
      segments: [],
    });
  });
});

describe('transcribeLive groq', () => {
  it('posts a multipart form with a Bearer header and maps segments', async () => {
    const { fetch, calls } = fakeFetch([200], {
      text: ' five hundred ',
      segments: [{ text: ' five hundred ', start: 0, end: 1.5, avg_logprob: -0.1 }],
    });
    const out = await transcribeLive('groq', tone, KEY, { fetch, sleep: noSleep });
    expect(calls[0]?.url).toBe(LIVE_GROQ_URL);
    expect(calls[0]?.init.headers).toEqual({ Authorization: `Bearer ${KEY}` });
    const form = calls[0]?.init.body;
    expect(form).toBeInstanceOf(FormData);
    expect((form as FormData).get('model')).toBe(LIVE_GROQ_MODEL);
    expect((form as FormData).get('language')).toBe('en');
    expect((form as FormData).get('file')).toBeInstanceOf(Blob);
    expect(out.text).toBe('five hundred');
    expect(out.segments).toEqual([
      { text: 'five hundred', startMs: 0, endMs: 1500, confidence: 0.9 },
    ]);
  });

  it('falls back to one segment when the answer has none', async () => {
    const { fetch } = fakeFetch([200], { text: 'hello' });
    const out = await transcribeLive('groq', tone, KEY, { fetch, sleep: noSleep });
    expect(out.segments).toEqual([{ text: 'hello', startMs: 0, endMs: 0, confidence: 0.5 }]);
  });
});

describe('retry and errors', () => {
  it('retries 429 then 503 and succeeds, with growing delays', async () => {
    const { fetch, calls } = fakeFetch([429, 503, 200], { text: 'ok' });
    const sleep = vi.fn((_ms: number) => Promise.resolve());
    const out = await transcribeLive('groq', tone, KEY, { fetch, sleep, backoffMs: 10 });
    expect(out.text).toBe('ok');
    expect(calls).toHaveLength(3);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([10, 20]);
  });

  it('stops after the attempt bound and never leaks the key', async () => {
    const { fetch, calls } = fakeFetch([500], {});
    const err = await transcribeLive('deepgram', tone, KEY, {
      fetch,
      sleep: noSleep,
      maxAttempts: 3,
    }).catch((e: unknown) => e);
    expect(calls).toHaveLength(3);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('deepgram speech-to-text answered 500');
    expect((err as Error).message).not.toContain(KEY);
  });

  it('does not retry a 401', async () => {
    const { fetch, calls } = fakeFetch([401], {});
    await expect(transcribeLive('groq', tone, KEY, { fetch, sleep: noSleep })).rejects.toThrow(
      'groq speech-to-text answered 401',
    );
    expect(calls).toHaveLength(1);
  });

  it('retries a thrown network error without echoing its text', async () => {
    const fetchFn: LiveFetch = () => Promise.reject(new Error(`boom ${KEY}`));
    const err = await transcribeLive('groq', tone, KEY, { fetch: fetchFn, sleep: noSleep }).catch(
      (e: unknown) => e,
    );
    expect((err as Error).message).toBe('groq speech-to-text request failed');
  });

  it('createLiveTranscriber reports a missing recording by id', async () => {
    const { fetch } = fakeFetch([200], {});
    const t = createLiveTranscriber(() => undefined, { fetch });
    await expect(t('x1', 'groq', KEY)).rejects.toThrow('recording x1 is missing');
  });
});

describe('eval CLI live mode', () => {
  const manifest = JSON.stringify([
    {
      id: 'a1',
      category: 'plain',
      text: 'five hundred',
      context: { currentPriceCents: 40000 },
      expected: { outcome: 'none' },
    },
  ]);
  function deps(have: boolean, env: Record<string, string>): { d: CliDeps; logs: string[] } {
    const logs: string[] = [];
    const d: CliDeps = {
      readFile: () => manifest,
      exists: () => true,
      writeFile: () => undefined,
      env,
      gitSha: () => 'sha',
      log: (l) => logs.push(l),
      recordingExists: () => have,
      transcribe: () => Promise.resolve({ text: 'five hundred' }),
    };
    return { d, logs };
  }

  it('names the missing variable and prints no key', async () => {
    const { d, logs } = deps(true, {});
    expect(await runCli(['--mode', 'live', '--provider', 'groq'], d)).toBe(EXIT_NO_KEYS);
    expect(logs.join('\n')).toContain('GROQ_API_KEY');
  });

  it('skips when recordings are missing', async () => {
    const { d, logs } = deps(false, { DEEPGRAM_API_KEY: KEY });
    expect(await runCli(['--mode', 'live', '--provider', 'deepgram'], d)).toBe(EXIT_OK);
    expect(logs).toEqual(['eval: skipped: 1 of 1 recordings missing']);
  });

  it('runs when recordings exist', async () => {
    const { d, logs } = deps(true, { DEEPGRAM_API_KEY: KEY });
    expect(await runCli(['--mode', 'live', '--provider', 'deepgram'], d)).toBe(EXIT_OK);
    expect(logs.join('\n')).toContain('1 utterances');
    expect(logs.join('\n')).not.toContain(KEY);
  });
});
