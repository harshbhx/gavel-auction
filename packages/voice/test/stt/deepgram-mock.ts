import type { SttScheduler } from '../../src/stt/deepgram-config.js';
import type { WsFactory, WsLike } from '../../src/stt/deepgram.js';
import type { SttEvent, SttProvider } from '../../src/stt/provider.js';

interface Timer {
  fn: () => void;
  ms: number;
  next: number;
  repeat: boolean;
  live: boolean;
}

/** Virtual clock that implements the provider scheduler seam. */
export class FakeScheduler implements SttScheduler {
  t = 0;
  private timers: Timer[] = [];

  every(fn: () => void, ms: number): () => void {
    return this.add({ fn, ms, next: this.t + ms, repeat: true, live: true });
  }

  after(fn: () => void, ms: number): () => void {
    return this.add({ fn, ms, next: this.t + ms, repeat: false, live: true });
  }

  private add(timer: Timer): () => void {
    this.timers.push(timer);
    return () => {
      timer.live = false;
    };
  }

  /** Run every timer due within `ms`, in time order, letting promises settle between them. */
  async advance(ms: number): Promise<void> {
    const end = this.t + ms;
    for (;;) {
      const due = this.timers
        .filter((x) => x.live && x.next <= end)
        .sort((a, b) => a.next - b.next)[0];
      if (!due) break;
      this.t = due.next;
      if (due.repeat) due.next += due.ms;
      else due.live = false;
      due.fn();
      await flush();
    }
    this.t = end;
    await flush();
  }
}

export async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

export interface MockWsOptions {
  /** Open on the next microtask (default true). */
  autoOpen?: boolean;
  /** Close the socket like the server does when it receives CloseStream (default true). */
  closeOnCloseStream?: boolean;
}

export class MockWs implements WsLike {
  sent: Array<string | Uint8Array> = [];
  bufferedAmount = 0;
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(
    readonly url: string,
    readonly protocols: string[],
    private readonly opts: MockWsOptions = {},
  ) {
    if (opts.autoOpen !== false) queueMicrotask(() => this.open());
  }

  get texts(): string[] {
    return this.sent.filter((x): x is string => typeof x === 'string');
  }

  get binaries(): Uint8Array[] {
    return this.sent.filter((x): x is Uint8Array => typeof x !== 'string');
  }

  open(): void {
    this.onopen?.();
  }

  message(obj: unknown): void {
    this.onmessage?.({ data: typeof obj === 'string' ? obj : JSON.stringify(obj) });
  }

  send(data: string | Uint8Array): void {
    if (this.closed) throw new Error('socket closed');
    this.sent.push(data);
    if (data === '{"type":"CloseStream"}' && this.opts.closeOnCloseStream !== false) {
      queueMicrotask(() => this.serverClose(1000));
    }
  }

  close(): void {
    this.closed = true;
  }

  serverClose(code: number): void {
    this.closed = true;
    this.onclose?.({ code });
  }
}

export function mockFactory(opts: MockWsOptions = {}): { factory: WsFactory; sockets: MockWs[] } {
  const sockets: MockWs[] = [];
  const factory: WsFactory = (url, protocols) => {
    const ws = new MockWs(url, protocols, opts);
    sockets.push(ws);
    return ws;
  };
  return { factory, sockets };
}

/** Collect events in the background; `events` fills as the provider emits. */
export function record(provider: SttProvider): { events: SttEvent[]; done: Promise<void> } {
  const events: SttEvent[] = [];
  const it = provider.events()[Symbol.asyncIterator]();
  const done = (async () => {
    for (;;) {
      const r = await it.next();
      if (r.done) return;
      events.push(r.value);
    }
  })();
  return { events, done };
}
