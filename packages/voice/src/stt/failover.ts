import { FLAG_KEEPALIVE, type AudioBatch } from '../audio/frame.js';
import {
  EventChannel,
  SttStats,
  type InstrumentedSttProvider,
  type SttEvent,
  type SttProvider,
} from './provider.js';

const SAMPLE_RATE = 16000;

/** Timer source; VirtualClock satisfies it, so tests never sleep. */
export interface FailoverClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(id: number): void;
}

export const realClock: FailoverClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => Number(setTimeout(fn, ms)),
  clearTimeout: (id) => clearTimeout(id),
};

export type SwitchReason = 'silent' | 'fatal' | 'errors' | 'late_final' | 'recovered';

export interface FailoverOptions {
  /** Builders, because a stopped provider cannot be restarted (needed for the probe). */
  primary: () => SttProvider;
  fallback: () => SttProvider;
  clock: FailoverClock;
  /** No event within this long after audio start switches (default 3000). */
  silenceMs?: number;
  /** A final later than this after speech end switches (default 4000). */
  lateFinalMs?: number;
  /** Time the primary is skipped after a switch (default 30000). */
  circuitMs?: number;
  /** Audio replayed into the fallback (default 5000). */
  replayMs?: number;
  onSwitch?: (info: { from: string; to: string; reason: SwitchReason }) => void;
}

/**
 * Runs the primary provider and moves to the fallback on the triggers of R-VOX-019, replaying the
 * last seconds of audio so the current utterance survives. After the circuit window one probe
 * stream is fed in parallel; the first healthy event from it returns the session to the primary.
 */
export class FailoverStt implements InstrumentedSttProvider {
  readonly stats = new SttStats();
  switches = 0;

  private readonly o: Required<Omit<FailoverOptions, 'onSwitch'>> &
    Pick<FailoverOptions, 'onSwitch'>;
  private readonly channel = new EventChannel<SttEvent>(1024);
  private active: SttProvider;
  private onPrimary = true;
  private probe: SttProvider | null = null;
  private probeTimer: number | null = null;
  private circuitUntil = 0;
  private ring: AudioBatch[] = [];
  private ringSamples = 0;
  private startOpts: { keyterms: string[]; language: 'en' } = { keyterms: [], language: 'en' };
  private startedAt = 0;
  private silenceTimer: number | null = null;
  private armed = false;
  private sawEvent = false;
  private consecutiveErrors = 0;
  private open = false;
  private ended = false;
  private pumps: Array<Promise<void>> = [];

  constructor(opts: FailoverOptions) {
    this.o = {
      silenceMs: 3000,
      lateFinalMs: 4000,
      circuitMs: 30000,
      replayMs: 5000,
      ...opts,
    };
    this.active = this.o.primary();
  }

  get name(): SttProvider['name'] {
    return this.active.name;
  }

  get usingPrimary(): boolean {
    return this.onPrimary;
  }

  async start(opts: { keyterms: string[]; language: 'en' }): Promise<void> {
    if (this.open || this.ended) return;
    this.open = true;
    this.startOpts = { keyterms: [...opts.keyterms], language: opts.language };
    this.startedAt = this.o.clock.now();
    this.pump(this.active);
    await this.active.start(this.startOpts);
  }

  write(batch: AudioBatch): void {
    if (!this.open) return;
    try {
      this.stats.addBytes(batch.pcm.byteLength);
      if ((batch.flags & FLAG_KEEPALIVE) === 0) {
        this.remember(batch);
        if (!this.armed && this.onPrimary) this.armSilence();
        this.maybeProbe();
      }
      this.active.write(batch);
      this.probe?.write(batch);
    } catch {
      this.stats.addDropped();
    }
  }

  events(): AsyncIterable<SttEvent> {
    return this.channel.iterable();
  }

  async stop(): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    this.open = false;
    this.clearSilence();
    this.clearProbeTimer();
    const probe = this.probe;
    this.probe = null;
    if (probe) await probe.stop();
    await this.active.stop();
    await Promise.all(this.pumps);
    this.channel.close();
  }

  // ---- audio ring ----

  private remember(batch: AudioBatch): void {
    this.ring.push(batch);
    this.ringSamples += batch.pcm.length;
    const max = Math.round((this.o.replayMs * SAMPLE_RATE) / 1000);
    while (this.ringSamples > max && this.ring.length > 1) {
      const dropped = this.ring.shift();
      this.ringSamples -= dropped?.pcm.length ?? 0;
    }
  }

  // ---- event handling ----

  private pump(provider: SttProvider): void {
    const run = (async () => {
      for await (const e of provider.events()) this.handle(provider, e);
    })().catch(() => undefined);
    this.pumps.push(run);
  }

  private handle(provider: SttProvider, e: SttEvent): void {
    if (provider === this.active) this.fromActive(e);
    else if (provider === this.probe) this.fromProbe(e);
  }

  private fromActive(e: SttEvent): void {
    this.emit(e);
    if (!this.onPrimary || this.ended) return;
    if (e.type === 'interim' || e.type === 'final' || e.type === 'utterance_end') {
      this.sawEvent = true;
      this.clearSilence();
    }
    if (e.type === 'interim' || e.type === 'final') this.consecutiveErrors = 0;
    if (e.type === 'error') {
      if (!e.retryable) {
        this.switchToFallback('fatal');
        return;
      }
      this.consecutiveErrors += 1;
      if (this.consecutiveErrors >= 2) this.switchToFallback('errors');
      return;
    }
    if (e.type === 'final') {
      const lateBy = this.o.clock.now() - (this.startedAt + e.endMs);
      if (lateBy > this.o.lateFinalMs) this.switchToFallback('late_final');
    }
  }

  private emit(e: SttEvent): void {
    this.stats.observe(e);
    this.channel.push(e);
  }

  // ---- switching ----

  private armSilence(): void {
    this.armed = true;
    this.silenceTimer = this.o.clock.setTimeout(() => {
      this.silenceTimer = null;
      if (!this.sawEvent && this.onPrimary && !this.ended) this.switchToFallback('silent');
    }, this.o.silenceMs);
  }

  private clearSilence(): void {
    if (this.silenceTimer !== null) this.o.clock.clearTimeout(this.silenceTimer);
    this.silenceTimer = null;
  }

  private switchToFallback(reason: SwitchReason): void {
    if (!this.onPrimary || this.ended) return;
    const from = this.active;
    const to = this.o.fallback();
    this.onPrimary = false;
    this.active = to;
    this.switches += 1;
    this.stats.counters.reconnects += 1;
    this.clearSilence();
    this.circuitUntil = this.o.clock.now() + this.o.circuitMs;
    this.o.onSwitch?.({ from: from.name, to: to.name, reason });
    void from.stop().catch(() => undefined);
    this.pump(to);
    void to
      .start(this.startOpts)
      .then(() => {
        for (const b of this.ring) to.write(b);
      })
      .catch(() => undefined);
  }

  // ---- probe ----

  private maybeProbe(): void {
    if (this.onPrimary || this.probe || this.ended) return;
    if (this.o.clock.now() < this.circuitUntil) return;
    const p = this.o.primary();
    this.probe = p;
    this.pump(p);
    this.probeTimer = this.o.clock.setTimeout(() => this.failProbe(), this.o.silenceMs);
    void p
      .start(this.startOpts)
      .then(() => {
        for (const b of this.ring) p.write(b);
      })
      .catch(() => this.failProbe());
  }

  private fromProbe(e: SttEvent): void {
    if (e.type === 'error') {
      this.failProbe();
      return;
    }
    if (e.type !== 'interim' && e.type !== 'final') return;
    const probe = this.probe;
    if (!probe) return;
    this.clearProbeTimer();
    const old = this.active;
    this.probe = null;
    this.active = probe;
    this.onPrimary = true;
    this.sawEvent = true;
    this.consecutiveErrors = 0;
    this.switches += 1;
    this.o.onSwitch?.({ from: old.name, to: probe.name, reason: 'recovered' });
    void old.stop().catch(() => undefined);
    this.fromActive(e);
  }

  private failProbe(): void {
    const p = this.probe;
    if (!p) return;
    this.probe = null;
    this.clearProbeTimer();
    this.circuitUntil = this.o.clock.now() + this.o.circuitMs;
    void p.stop().catch(() => undefined);
  }

  private clearProbeTimer(): void {
    if (this.probeTimer !== null) this.o.clock.clearTimeout(this.probeTimer);
    this.probeTimer = null;
  }
}
