import { buildPrompt, type PromptInput } from './prompt.js';
import { cacheKey, LlmCacheMissError, type LlmCache } from './cache.js';
import { parseLlmOutput, type LlmOutput } from './schema.js';

/** Call limits of R-VOX-056. */
export const LLM_TIMEOUT_MS = 1500;
export const LLM_MAX_OUTPUT_TOKENS = 200;
export const LLM_TEMPERATURE = 0;

export type LlmInput = PromptInput;

/** Provider-agnostic parser interface (R-VOX-054). */
export interface LlmParser {
  parse(input: LlmInput, signal: AbortSignal): Promise<LlmOutput>;
}

export interface LlmRequest {
  prompt: string;
  temperature: 0;
  maxOutputTokens: number;
  signal: AbortSignal;
}

/** Provider call: resolves with the raw model reply (JSON text or an object). Provider and model are config. */
export type LlmTransport = (request: LlmRequest) => Promise<unknown>;

export type LlmFailure = 'timeout' | 'aborted' | 'invalid' | 'error';

/** The model is unavailable for this segment; the caller continues on rules alone. */
export class LlmUnavailableError extends Error {
  readonly reason: LlmFailure;
  constructor(reason: LlmFailure) {
    super(`language model unavailable: ${reason}`);
    this.name = 'LlmUnavailableError';
    this.reason = reason;
  }
}

/** live: transport only. record: cache first, miss calls the transport and writes. replay: cache only. */
export type LlmMode = 'live' | 'record' | 'replay';

export interface LlmClientOptions {
  mode: LlmMode;
  /** Required for live and record. */
  transport?: LlmTransport;
  /** Required for record and replay. */
  cache?: LlmCache;
  timeoutMs?: number;
  /** Injected timer so tests control time. */
  setTimer?: (fn: () => void, ms: number) => () => void;
}

export type LlmStatus = 'up' | 'down';

export interface LlmClient extends LlmParser {
  /** down after a timeout or provider error, up after the next good reply. */
  readonly status: LlmStatus;
}

const defaultSetTimer = (fn: () => void, ms: number): (() => void) => {
  const id = setTimeout(fn, ms);
  return () => {
    clearTimeout(id);
  };
};

export function createLlmClient(options: LlmClientOptions): LlmClient {
  const { mode, transport, cache } = options;
  const timeoutMs = options.timeoutMs ?? LLM_TIMEOUT_MS;
  const setTimer = options.setTimer ?? defaultSetTimer;
  if (mode !== 'replay' && transport === undefined) {
    throw new Error('a transport is required unless the mode is replay');
  }
  if (mode !== 'live' && cache === undefined) {
    throw new Error('a cache is required for record and replay');
  }
  let status: LlmStatus = 'up';

  async function callOnce(input: LlmInput, outer: AbortSignal): Promise<LlmOutput> {
    if (transport === undefined) throw new LlmUnavailableError('error');
    if (outer.aborted) throw new LlmUnavailableError('aborted');
    const controller = new AbortController();
    let failure: LlmFailure | null = null;
    const stop = (why: LlmFailure): void => {
      if (failure === null) failure = why;
      controller.abort();
    };
    const onOuter = (): void => {
      stop('aborted');
    };
    outer.addEventListener('abort', onOuter, { once: true });
    const cancelTimer = setTimer(() => {
      stop('timeout');
    }, timeoutMs);
    try {
      const reply = await Promise.race([
        transport({
          prompt: buildPrompt(input),
          temperature: LLM_TEMPERATURE,
          maxOutputTokens: LLM_MAX_OUTPUT_TOKENS,
          signal: controller.signal,
        }),
        new Promise<never>((_resolve, reject) => {
          controller.signal.addEventListener(
            'abort',
            () => {
              reject(new LlmUnavailableError(failure ?? 'aborted'));
            },
            { once: true },
          );
        }),
      ]);
      const parsed = parseLlmOutput(reply);
      if (parsed === null) throw new LlmUnavailableError('invalid');
      return parsed;
    } catch (e) {
      if (e instanceof LlmUnavailableError) throw e;
      throw new LlmUnavailableError(failure ?? 'error');
    } finally {
      cancelTimer();
      outer.removeEventListener('abort', onOuter);
    }
  }

  return {
    get status() {
      return status;
    },
    async parse(input, signal) {
      const { transcript, ...context } = input;
      const key = mode === 'live' ? '' : await cacheKey(transcript, context);
      if (mode !== 'live' && cache !== undefined) {
        const hit = cache.get(key);
        if (hit !== undefined) return hit;
        if (mode === 'replay') throw new LlmCacheMissError(key);
      }
      try {
        const out = await callOnce(input, signal);
        status = 'up';
        if (mode === 'record' && cache !== undefined) cache.set(key, out);
        return out;
      } catch (e) {
        if (e instanceof LlmUnavailableError && e.reason !== 'aborted') status = 'down';
        throw e;
      }
    },
  };
}
