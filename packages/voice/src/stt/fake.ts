import type { AudioBatch } from '../audio/frame.js';
import { FLAG_KEEPALIVE } from '../audio/frame.js';
import {
  EventChannel,
  SttStats,
  type InstrumentedSttProvider,
  type SttErrorCode,
  type SttEvent,
} from './provider.js';

type TimerEntry = { id: number; at: number; seq: number; fn: () => void };

/** Deterministic clock: time only moves when advance() is called. */
export class VirtualClock {
  private t = 0;
  private nextId = 1;
  private timers: TimerEntry[] = [];

  now(): number {
    return this.t;
  }

  setTimeout(fn: () => void, ms: number): number {
    const id = this.nextId++;
    this.timers.push({ id, at: this.t + Math.max(0, ms), seq: id, fn });
    return id;
  }

  clearTimeout(id: number): void {
    this.timers = this.timers.filter((x) => x.id !== id);
  }

  /** Run every timer due within the window in time order, then settle at now + ms. */
  advance(ms: number): void {
    const end = this.t + ms;
    for (;;) {
      let next: TimerEntry | undefined;
      for (const x of this.timers) {
        if (x.at <= end && (!next || x.at < next.at || (x.at === next.at && x.seq < next.seq)))
          next = x;
      }
      if (!next) break;
      this.timers = this.timers.filter((x) => x.id !== next?.id);
      this.t = Math.max(this.t, next.at);
      next.fn();
    }
    this.t = end;
  }
}

export type ScriptFault =
  | { kind: 'drop' }
  | { kind: 'delay'; ms: number }
  | { kind: 'duplicate'; times?: number };

export interface ScriptStep {
  /** Milliseconds after start() on the virtual clock. */
  atMs: number;
  event: SttEvent;
  fault?: ScriptFault;
}

export interface FakeSttOptions {
  clock: VirtualClock;
  script?: ScriptStep[];
  /** Pending audio batches kept before the oldest is dropped. */
  capacity?: number;
  /** Virtual time the fake needs per batch; 0 consumes batches instantly. */
  processMsPerBatch?: number;
  /** Bound on undelivered events. */
  maxBufferedEvents?: number;
}

export class FakeStt implements InstrumentedSttProvider {
  readonly name = 'fake' as const;
  readonly stats = new SttStats();
  keyterms: string[] = [];
  /** True when the last accepted batch followed a drop. */
  discontinuity = false;
  processedBatches = 0;

  private readonly clock: VirtualClock;
  private readonly script: ScriptStep[];
  private readonly capacity: number;
  private readonly processMs: number;
  private readonly channel: EventChannel<SttEvent>;
  private pending: AudioBatch[] = [];
  private timerIds: number[] = [];
  private draining = false;
  private startedAt = 0;
  private open = false;
  private ended = false;

  constructor(opts: FakeSttOptions) {
    this.clock = opts.clock;
    this.script = opts.script ?? [];
    this.capacity = opts.capacity ?? 50;
    this.processMs = opts.processMsPerBatch ?? 0;
    this.channel = new EventChannel<SttEvent>(opts.maxBufferedEvents ?? 1024);
  }

  start(opts: { keyterms: string[]; language: 'en' }): Promise<void> {
    if (this.open || this.ended) return Promise.resolve();
    this.keyterms = [...opts.keyterms];
    this.open = true;
    this.startedAt = this.clock.now();
    this.emit({ type: 'state', state: 'connecting' });
    this.emit({ type: 'state', state: 'open' });
    for (const step of this.script) this.schedule(step);
    return Promise.resolve();
  }

  write(batch: AudioBatch): void {
    if (!this.open) return;
    this.stats.addBytes(batch.pcm.byteLength);
    if ((batch.flags & FLAG_KEEPALIVE) !== 0) return;
    if (this.processMs <= 0) {
      this.processedBatches += 1;
      return;
    }
    this.pending.push(batch);
    if (this.pending.length > this.capacity) {
      this.pending.shift();
      this.stats.addDropped();
      this.discontinuity = true;
    }
    this.kickDrain();
  }

  events(): AsyncIterable<SttEvent> {
    return this.channel.iterable();
  }

  stop(): Promise<void> {
    if (this.ended) return Promise.resolve();
    this.ended = true;
    this.open = false;
    for (const id of this.timerIds) this.clock.clearTimeout(id);
    this.timerIds = [];
    this.pending = [];
    this.emit({ type: 'state', state: 'closed' });
    this.channel.close();
    return Promise.resolve();
  }

  /** Emit an event now, as if the vendor had sent it. */
  inject(event: SttEvent): void {
    if (this.open) this.emit(event);
  }

  injectError(code: SttErrorCode, retryable: boolean): void {
    this.inject({ type: 'error', code, retryable });
  }

  get droppedEvents(): number {
    return this.channel.dropped;
  }

  private schedule(step: ScriptStep): void {
    const fault = step.fault;
    if (fault?.kind === 'drop') return;
    const delay = fault?.kind === 'delay' ? fault.ms : 0;
    const copies = fault?.kind === 'duplicate' ? 1 + Math.max(1, fault.times ?? 1) : 1;
    const id = this.clock.setTimeout(() => {
      for (let i = 0; i < copies; i++) this.emit(step.event);
    }, step.atMs + delay);
    this.timerIds.push(id);
  }

  private emit(event: SttEvent): void {
    let latency: number | undefined;
    if (event.type === 'final') latency = this.clock.now() - (this.startedAt + event.endMs);
    this.stats.observe(event, latency);
    this.channel.push(event);
  }

  private kickDrain(): void {
    if (this.draining || this.pending.length === 0) return;
    this.draining = true;
    const id = this.clock.setTimeout(() => {
      this.draining = false;
      if (this.pending.shift()) this.processedBatches += 1;
      this.kickDrain();
    }, this.processMs);
    this.timerIds.push(id);
  }
}
