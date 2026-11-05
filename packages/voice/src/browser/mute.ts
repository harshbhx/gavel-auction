import {
  FLAG_DISCONTINUITY,
  FLAG_END_OF_UTTERANCE,
  FLAG_KEEPALIVE,
  type AudioBatch,
} from '../audio/frame.js';
import type { CaptureState } from '../privacy.js';
import { MAX_AUTO_RESTARTS, reduce, type CaptureEvent } from './capture-state.js';

export type CaptureMode = 'open_mic' | 'push_to_talk';
export type MuteReason = 'user' | 'push_to_talk' | 'suspended';

/** Keepalive cadence while muted (R-VOX-011). */
export const KEEPALIVE_INTERVAL_MS = 5000;
/** How often the audio context state is polled; well inside the 1 s bound of R-VOX-010. */
export const CONTEXT_POLL_MS = 250;

/** Repeating timer seam: returns a cancel function. Tests drive it with a fake clock. */
export interface IntervalScheduler {
  every(fn: () => void, ms: number): () => void;
}

export const realScheduler: IntervalScheduler = {
  every(fn, ms) {
    const handle = setInterval(fn, ms);
    return () => clearInterval(handle);
  },
};

export interface MuteControllerOptions {
  /** Receives every outgoing batch: audio while live, keepalives while muted. Never throws upstream. */
  sink: (batch: AudioBatch) => void;
  scheduler?: IntervalScheduler;
  /** Milliseconds clock stamped on keepalives. */
  now: () => number;
  /** Current AudioContext state, polled; omit when there is no context. */
  contextState?: () => string;
  /** One automatic restart after the track ends; resolves true when capture is running again. */
  restart?: () => Promise<boolean>;
  onState?: (state: CaptureState, reason: MuteReason | null) => void;
  mode?: CaptureMode;
}

/**
 * Mute, push-to-talk, keepalive and device-loss handling in front of the audio sink.
 * Outgoing sequence numbers are assigned here so audio and keepalives stay contiguous.
 */
export class MuteController {
  private readonly o: MuteControllerOptions;
  private readonly scheduler: IntervalScheduler;
  private current: CaptureState = 'idle';
  private why: MuteReason | null = null;
  private modeNow: CaptureMode;
  private seq = 0;
  private discontinuity = false;
  private restarts = 0;
  private cancelKeepalive: (() => void) | null = null;
  private cancelPoll: (() => void) | null = null;

  constructor(opts: MuteControllerOptions) {
    this.o = opts;
    this.scheduler = opts.scheduler ?? realScheduler;
    this.modeNow = opts.mode ?? 'open_mic';
  }

  get state(): CaptureState {
    return this.current;
  }

  get reason(): MuteReason | null {
    return this.why;
  }

  get mode(): CaptureMode {
    return this.modeNow;
  }

  /** Mark capture running (permission granted) and begin watching the audio context. */
  attach(): void {
    this.restarts = 0;
    this.apply({ type: 'start' });
    this.apply({ type: 'granted' });
    this.startPoll();
    if (this.modeNow === 'push_to_talk') this.mute('push_to_talk');
  }

  detach(): void {
    this.stopKeepalive();
    this.stopPoll();
    this.apply({ type: 'stop' });
    this.why = null;
  }

  mute(reason: MuteReason = 'user'): void {
    if (this.current !== 'running' && this.current !== 'degraded') return;
    this.why = reason;
    this.apply({ type: 'mute' });
    this.startKeepalive();
    // Push-to-talk ends its utterance in talkEnd(); entering the mode is not a release.
    if (reason !== 'push_to_talk') this.endUtterance();
  }

  /** Tell the speech provider the speaker stopped, so a held utterance is finished now (R12-V06). */
  private endUtterance(): void {
    this.send({
      seq: this.seq,
      tsMs: this.o.now(),
      flags: FLAG_KEEPALIVE | FLAG_END_OF_UTTERANCE,
      pcm: new Int16Array(0),
    });
  }

  unmute(): void {
    if (this.current !== 'muted') return;
    this.stopKeepalive();
    this.why = null;
    this.discontinuity = true;
    this.apply({ type: 'unmute' });
  }

  setMode(mode: CaptureMode): void {
    if (mode === this.modeNow) return;
    this.modeNow = mode;
    // Push-to-talk starts silent; open-mic starts live unless the user or the browser muted it.
    if (mode === 'push_to_talk') this.mute('push_to_talk');
    else if (this.why === 'push_to_talk') this.unmute();
  }

  /** Talk key pressed. Ignored in open-mic mode. */
  talkStart(): void {
    if (this.modeNow === 'push_to_talk' && this.why === 'push_to_talk') this.unmute();
  }

  /** Talk key released. Ignored in open-mic mode. */
  talkEnd(): void {
    if (this.modeNow !== 'push_to_talk') return;
    const wasLive = this.current === 'running' || this.current === 'degraded';
    this.mute('push_to_talk');
    if (wasLive) this.endUtterance();
  }

  /** Browser reported the AudioContext statechange; also reached by polling. */
  checkContext(): void {
    if (this.o.contextState?.() === 'suspended') this.mute('suspended');
  }

  /** A user gesture resumed a suspended context. */
  gesture(): void {
    if (this.current !== 'muted' || this.why !== 'suspended') return;
    this.stopKeepalive();
    this.why = null;
    this.discontinuity = true;
    this.apply({ type: 'gesture' });
  }

  /** Capture pipeline delivers a batch; it is dropped while muted. */
  push(batch: AudioBatch): void {
    if (this.current !== 'running' && this.current !== 'degraded') return;
    let flags = batch.flags;
    if (this.discontinuity) {
      flags |= FLAG_DISCONTINUITY;
      this.discontinuity = false;
    }
    this.send({ seq: this.seq, tsMs: batch.tsMs, flags, pcm: batch.pcm });
  }

  /** The microphone track ended (device unplugged). Errors now, restarts once. */
  trackEnded(): void {
    if (this.current !== 'running' && this.current !== 'muted' && this.current !== 'degraded') {
      return;
    }
    this.stopKeepalive();
    this.why = null;
    this.apply({ type: 'track_ended' });
    if (this.restarts >= MAX_AUTO_RESTARTS || !this.o.restart) return;
    this.restarts += 1;
    this.apply({ type: 'restart', attempt: this.restarts });
    void this.o
      .restart()
      .then((ok) => {
        if (ok) {
          this.discontinuity = true;
          this.apply({ type: 'granted' });
          if (this.modeNow === 'push_to_talk') this.mute('push_to_talk');
        } else {
          this.apply({ type: 'notfound' });
        }
      })
      .catch(() => this.apply({ type: 'notfound' }));
  }

  private send(b: AudioBatch): void {
    this.seq += 1;
    try {
      this.o.sink(b);
    } catch {
      // the sink must never break capture
    }
  }

  private startKeepalive(): void {
    if (this.cancelKeepalive) return;
    this.cancelKeepalive = this.scheduler.every(() => {
      this.send({
        seq: this.seq,
        tsMs: this.o.now(),
        flags: FLAG_KEEPALIVE,
        pcm: new Int16Array(0),
      });
    }, KEEPALIVE_INTERVAL_MS);
  }

  private stopKeepalive(): void {
    this.cancelKeepalive?.();
    this.cancelKeepalive = null;
  }

  private startPoll(): void {
    if (this.cancelPoll || !this.o.contextState) return;
    this.cancelPoll = this.scheduler.every(() => this.checkContext(), CONTEXT_POLL_MS);
  }

  private stopPoll(): void {
    this.cancelPoll?.();
    this.cancelPoll = null;
  }

  private apply(event: CaptureEvent): void {
    const next = reduce(this.current, event);
    if (next === this.current) return;
    this.current = next;
    this.o.onState?.(next, this.why);
  }
}
