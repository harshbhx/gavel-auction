import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLlmClient, LlmUnavailableError, type LlmInput } from '../../src/llm/client.js';
import {
  cacheKey,
  createCache,
  createMemoryStore,
  LlmCacheMissError,
} from '../../src/llm/cache.js';
import { createFakeTransport } from '../../src/llm/fake.js';

const good = {
  is_bid: true,
  paddle: '7',
  amount_dollars: 350,
  currency: 'USD',
  alternatives: [],
  is_correction: false,
  negated: false,
  confidence: 0.9,
};

const input: LlmInput = {
  transcript: 'paddle seven three fifty',
  currentPriceCents: 30000,
  minIncrementCents: 2500,
  registeredPaddles: ['7', '12'],
  speakerKnown: false,
  previousSegment: null,
};

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('T-VOX-064 call limits (R-VOX-056)', () => {
  it('aborts a 2000 ms reply at 1500 ms, marks the model down, calls once', async () => {
    const fake = createFakeTransport({ reply: good, delayMs: 2000 });
    const client = createLlmClient({ mode: 'live', transport: fake.transport });
    const outcome = client.parse(input, new AbortController().signal).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1500);
    const err = await outcome;
    expect(err).toBeInstanceOf(LlmUnavailableError);
    expect((err as LlmUnavailableError).reason).toBe('timeout');
    expect(client.status).toBe('down');
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.signal.aborted).toBe(true);
    expect(fake.calls[0]?.temperature).toBe(0);
    expect(fake.calls[0]?.maxOutputTokens).toBe(200);
  });

  it('aborts the call when a newer segment supersedes it', async () => {
    const fake = createFakeTransport({ reply: good, delayMs: 1000 });
    const client = createLlmClient({ mode: 'live', transport: fake.transport });
    const superseded = new AbortController();
    const outcome = client.parse(input, superseded.signal).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(100);
    superseded.abort();
    const err = await outcome;
    expect((err as LlmUnavailableError).reason).toBe('aborted');
    expect(fake.calls[0]?.signal.aborted).toBe(true);
    expect(client.status).toBe('up');
    expect(fake.calls).toHaveLength(1);
  });

  it('returns a valid reply and treats an invalid one as unavailable', async () => {
    const ok = createLlmClient({
      mode: 'live',
      transport: createFakeTransport({ reply: JSON.stringify(good) }).transport,
    });
    const p = ok.parse(input, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(0);
    expect(await p).toEqual(good);
    const bad = createLlmClient({
      mode: 'live',
      transport: createFakeTransport({ reply: { ...good, confidence: 1.2 } }).transport,
    });
    const q = bad.parse(input, new AbortController().signal).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(0);
    expect(((await q) as LlmUnavailableError).reason).toBe('invalid');
  });
});

describe('T-VOX-067 llm cache fixture (R-VOX-060)', () => {
  it('replay hit returns the recorded output without a transport', async () => {
    const { transcript, ...context } = input;
    const key = await cacheKey(transcript, context);
    const cache = createCache(createMemoryStore({ [key]: JSON.stringify(good) }));
    const client = createLlmClient({ mode: 'replay', cache });
    expect(await client.parse(input, new AbortController().signal)).toEqual(good);
  });

  it('replay miss throws a typed error', async () => {
    const cache = createCache(createMemoryStore());
    const client = createLlmClient({ mode: 'replay', cache });
    await expect(client.parse(input, new AbortController().signal)).rejects.toBeInstanceOf(
      LlmCacheMissError,
    );
  });

  it('record mode writes the output and then serves it from the cache', async () => {
    vi.useRealTimers();
    const store = createMemoryStore();
    const fake = createFakeTransport({ reply: good });
    const client = createLlmClient({
      mode: 'record',
      transport: fake.transport,
      cache: createCache(store),
    });
    expect(await client.parse(input, new AbortController().signal)).toEqual(good);
    expect(store.entries.size).toBe(1);
    expect(await client.parse(input, new AbortController().signal)).toEqual(good);
    expect(fake.calls).toHaveLength(1);
  });

  it('keys differ when the context differs', async () => {
    const a = await cacheKey('x', { currentPriceCents: 1 });
    const b = await cacheKey('x', { currentPriceCents: 2 });
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});
