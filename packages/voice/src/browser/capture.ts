import { FrameAssembler } from '../audio/assembler.js';
import type { AudioBatch } from '../audio/frame.js';
import { LevelMeter, type LevelReading } from '../audio/meter.js';
import { floatToInt16, resampleTo16k, type Resampler } from '../audio/resample.js';
import type { CaptureState } from '../privacy.js';
import { messageFor, reduce, type CaptureEvent } from './capture-state.js';

export const WORKLET_PROCESSOR = 'pcm-capture';

export interface CaptureConfig {
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
  /** URL of the built pcm-capture worklet module. */
  workletUrl?: string;
}

export interface CaptureTrack {
  stop(): void;
  addEventListener(type: 'ended', cb: () => void): void;
}

export interface CaptureStream {
  getTracks(): CaptureTrack[];
}

export interface CaptureNode {
  port: { onmessage: ((ev: { data: unknown }) => void) | null };
  disconnect(): void;
}

export interface CaptureContext {
  readonly sampleRate: number;
  readonly audioWorklet: { addModule(url: string): Promise<void> };
  createMediaStreamSource(stream: CaptureStream): {
    connect(node: CaptureNode): void;
    disconnect(): void;
  };
  resume(): Promise<void>;
  close(): Promise<void>;
}

/** Everything the controller needs from the browser, injectable for tests. */
export interface CaptureEnv {
  isSecureContext: boolean;
  getUserMedia:
    | ((constraints: { audio: Record<string, unknown> }) => Promise<CaptureStream>)
    | null;
  createContext: (() => CaptureContext) | null;
  createNode: (ctx: CaptureContext) => CaptureNode;
}

export function browserEnv(): CaptureEnv {
  const g = globalThis as unknown as {
    isSecureContext?: boolean;
    navigator?: { mediaDevices?: { getUserMedia?: (c: unknown) => Promise<unknown> } };
    AudioContext?: new () => unknown;
    AudioWorkletNode?: new (ctx: unknown, name: string, opts: unknown) => unknown;
  };
  const md = g.navigator?.mediaDevices;
  const gum = md?.getUserMedia;
  const Ctx = g.AudioContext;
  const Node = g.AudioWorkletNode;
  const hasWorklet = Ctx !== undefined && Node !== undefined && 'audioWorklet' in Ctx.prototype;
  return {
    isSecureContext: g.isSecureContext === true,
    getUserMedia: md && gum ? (c) => gum.call(md, c) as Promise<CaptureStream> : null,
    createContext: hasWorklet && Ctx ? () => new Ctx() as CaptureContext : null,
    createNode: (ctx) =>
      new (Node as NonNullable<typeof Node>)(ctx, WORKLET_PROCESSOR, {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        channelCount: 1,
      }) as CaptureNode,
  };
}

function errorName(e: unknown): string {
  return typeof e === 'object' && e !== null && 'name' in e
    ? String((e as { name: unknown }).name)
    : '';
}

/** Microphone capture through an audio worklet, resampled to 16 kHz and framed into batches. */
export class CaptureController {
  private state: CaptureState = 'idle';
  private readonly batchCbs: Array<(b: AudioBatch) => void> = [];
  private readonly stateCbs: Array<(s: CaptureState, message: string) => void> = [];
  private readonly levelCbs: Array<(l: LevelReading) => void> = [];
  private stream: CaptureStream | null = null;
  private ctx: CaptureContext | null = null;
  private node: CaptureNode | null = null;
  private assembler = new FrameAssembler();
  private meter = new LevelMeter();
  private resampler: Resampler | null = null;

  constructor(
    private readonly config: CaptureConfig = {},
    private readonly env: CaptureEnv = browserEnv(),
  ) {}

  get current(): CaptureState {
    return this.state;
  }

  onBatch(cb: (b: AudioBatch) => void): void {
    this.batchCbs.push(cb);
  }

  onState(cb: (s: CaptureState, message: string) => void): void {
    this.stateCbs.push(cb);
  }

  onLevel(cb: (l: LevelReading) => void): void {
    this.levelCbs.push(cb);
  }

  /** Feed an external event (mute, queue_drop, recovered) through the transition table. */
  dispatch(event: CaptureEvent): void {
    const next = reduce(this.state, event);
    if (next === this.state) return;
    this.state = next;
    const msg = messageFor(next);
    for (const cb of this.stateCbs) cb(next, msg);
  }

  async start(): Promise<void> {
    this.dispatch({ type: 'start' });
    if (this.state !== 'requesting') return;
    if (!this.env.isSecureContext) return this.dispatch({ type: 'insecure' });
    const { getUserMedia, createContext } = this.env;
    if (!getUserMedia || !createContext) return this.dispatch({ type: 'no_api' });

    let stream: CaptureStream;
    try {
      stream = await getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: this.config.echoCancellation ?? true,
          noiseSuppression: this.config.noiseSuppression ?? true,
          autoGainControl: this.config.autoGainControl ?? true,
        },
      });
    } catch (e) {
      const name = errorName(e);
      return this.dispatch({
        type: name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'notfound',
      });
    }

    try {
      const ctx = createContext();
      await ctx.audioWorklet.addModule(this.config.workletUrl ?? 'pcm-capture.worklet.js');
      const node = this.env.createNode(ctx);
      this.resampler = resampleTo16k(ctx.sampleRate);
      this.assembler = new FrameAssembler();
      this.meter = new LevelMeter();
      node.port.onmessage = (ev) => this.onBlock(ev.data);
      ctx.createMediaStreamSource(stream).connect(node);
      for (const t of stream.getTracks()) t.addEventListener('ended', () => this.onTrackEnded());
      this.stream = stream;
      this.ctx = ctx;
      this.node = node;
      await ctx.resume();
      this.dispatch({ type: 'granted' });
    } catch {
      for (const t of stream.getTracks()) t.stop();
      this.dispatch({ type: 'no_api' });
    }
  }

  private onBlock(data: unknown): void {
    if (!(data instanceof Float32Array) || !this.resampler) return;
    if (this.state !== 'running' && this.state !== 'degraded') return;
    const pcm = floatToInt16(this.resampler.process(data));
    const level = this.meter.push(pcm);
    if (level) for (const cb of this.levelCbs) cb(level);
    for (const b of this.assembler.push(pcm)) for (const cb of this.batchCbs) cb(b);
  }

  private onTrackEnded(): void {
    this.dispatch({ type: 'track_ended' });
    this.release(false);
  }

  private release(flush: boolean): void {
    if (flush) for (const b of this.assembler.flush()) for (const cb of this.batchCbs) cb(b);
    if (this.node) {
      this.node.port.onmessage = null;
      this.node.disconnect();
    }
    if (this.stream) for (const t of this.stream.getTracks()) t.stop();
    if (this.ctx) void this.ctx.close();
    this.node = null;
    this.stream = null;
    this.ctx = null;
  }

  stop(): void {
    this.release(true);
    this.dispatch({ type: 'stop' });
  }
}
