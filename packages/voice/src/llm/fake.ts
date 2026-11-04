import type { LlmRequest, LlmTransport } from './client.js';

export interface FakeTransportOptions {
  /** Reply for every call: an object or a JSON string. */
  reply: unknown;
  /** Delay before replying, in milliseconds of the (injected or fake) timer. */
  delayMs?: number;
  setTimer?: (fn: () => void, ms: number) => () => void;
}

export interface FakeTransport {
  transport: LlmTransport;
  readonly calls: readonly LlmRequest[];
}

const defaultSetTimer = (fn: () => void, ms: number): (() => void) => {
  const id = setTimeout(fn, ms);
  return () => {
    clearTimeout(id);
  };
};

/** Scripted provider for tests: counts calls, honours the abort signal, needs no network or key. */
export function createFakeTransport(options: FakeTransportOptions): FakeTransport {
  const calls: LlmRequest[] = [];
  const setTimer = options.setTimer ?? defaultSetTimer;
  const delayMs = options.delayMs ?? 0;
  const transport: LlmTransport = (request) => {
    calls.push(request);
    return new Promise<unknown>((resolve, reject) => {
      if (request.signal.aborted) {
        reject(new Error('aborted'));
        return;
      }
      const cancel = setTimer(() => {
        resolve(options.reply);
      }, delayMs);
      request.signal.addEventListener(
        'abort',
        () => {
          cancel();
          reject(new Error('aborted'));
        },
        { once: true },
      );
    });
  };
  return { transport, calls };
}
