import {
  audioSocketUrl,
  openAudioSocket,
  type AudioFeed,
  type AudioProblem,
  type AudioSocket,
} from './audioSocket';
import {
  Batcher,
  encodeBatch,
  FLAG_DISCONTINUITY,
  FLAG_END_OF_STREAM,
  FLAG_END_OF_UTTERANCE,
  FLAG_KEEPALIVE,
} from './frame';
import { micSupport, startMic, type MicCaptureState, type MicHandle } from './micCapture';

/** Tap to start and tap to stop (`toggle`), or talk only while the key or button is held (`hold`). */
export type VoiceMode = 'toggle' | 'hold';

/** Cost and abuse limits, all on this side; the host has its own (rate, size, one stream per room source). */
export const MAX_HOLD_MS = 15_000;
/** Toggle mode: no speech for this long turns the microphone off. */
export const SILENCE_CUTOFF_MS = 20_000;
/** Hold mode: an armed microphone nobody pressed for this long is released. */
export const IDLE_DISARM_MS = 60_000;
/** Longest one microphone session, whatever happens. */
export const MAX_SESSION_MS = 5 * 60_000;
/** While nothing is sent, a keepalive every 5 s keeps the host's stream slot. */
export const KEEPALIVE_MS = 5_000;
/** Mean level (0..1) above which a 50 ms block counts as speech. */
export const SPEECH_LEVEL = 0.015;
const TICK_MS = 500;

/** Why voice is off or stopped: a refusal, a limit, or a plain end. */
export type VoiceProblem =
  | Exclude<MicCaptureState, 'off' | 'requesting' | 'live'>
  | AudioProblem
  | 'silence'
  | 'idle'
  | 'maxSession'
  | 'hidden'
  | 'closed';

export type VoicePhase = 'off' | 'asking' | 'connecting' | 'ready';

export interface VoiceState {
  phase: VoicePhase;
  /** Audio is being sent to the speech service right now. */
  talking: boolean;
  /** Input level 0..1. */
  level: number;
  caption: { text: string; final: boolean } | null;
  stt: 'ok' | 'degraded' | 'down' | null;
  problem: VoiceProblem | null;
  /** A short notice that is not a failure. */
  note: 'confirmExpired' | 'maxClip' | null;
  /** The recorded demo is playing: the host reads its own cached transcripts, no microphone is used. */
  replay: boolean;
}

export interface VoiceOptions {
  apiBase: string;
  roomId: string;
  /** Auctioneer token. Sent in the first socket message, never in a URL. */
  token: string;
  onChange(state: VoiceState): void;
  now?: () => number;
}

const IDLE: VoiceState = {
  phase: 'off',
  talking: false,
  level: 0,
  caption: null,
  stt: null,
  problem: null,
  note: null,
  replay: false,
};

/**
 * One microphone and one audio socket for one console. It never starts by itself, sends audio
 * only while `talking`, and releases the microphone and the socket on stop, on a hidden tab and
 * on dispose. It never decides about a bid: the host reads the speech and asks for a confirm.
 */
export class VoiceController {
  private state: VoiceState = IDLE;
  private mode: VoiceMode = 'toggle';
  private held = false;
  private gen = 0;
  private mic: MicHandle | null = null;
  private socket: AudioSocket | null = null;
  private micLive = false;
  private socketReady = false;
  private batcher = new Batcher();
  private seq = 0;
  private discontinuity = false;
  private startedAt = 0;
  private lastSpeechAt = 0;
  private lastActiveAt = 0;
  private lastSendAt = 0;
  private holdStartedAt = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly now: () => number;

  constructor(private readonly o: VoiceOptions) {
    this.now = o.now ?? (() => Date.now());
  }

  /** Starts watching the page: a hidden tab or a window that lost focus ends the microphone. */
  attach(): void {
    this.detach();
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibility);
    }
    if (typeof window !== 'undefined') window.addEventListener('blur', this.onBlur);
  }

  private detach(): void {
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibility);
    }
    if (typeof window !== 'undefined') window.removeEventListener('blur', this.onBlur);
  }

  get current(): VoiceState {
    return this.state;
  }

  get currentMode(): VoiceMode {
    return this.mode;
  }

  /** Switches mode. A running session is stopped first, so the two never mix. */
  setMode(mode: VoiceMode): void {
    if (mode === this.mode) return;
    if (this.state.phase !== 'off') this.stop();
    this.mode = mode;
  }

  /** Tap mode: starts when off, stops otherwise. */
  toggle(): void {
    if (this.mode !== 'toggle') return;
    if (this.state.phase === 'off') this.begin();
    else this.stop();
  }

  /** Hold mode: the key or button went down. */
  press(): void {
    if (this.mode !== 'hold' || this.held) return;
    this.held = true;
    this.holdStartedAt = this.now();
    if (this.state.phase === 'off') this.begin();
    else if (this.state.phase === 'ready') this.startTalking();
  }

  /** Hold mode: the key or button came up. */
  release(): void {
    if (!this.held) return;
    this.held = false;
    if (this.state.phase === 'ready' && this.state.talking) this.endTalking();
  }

  /** Stops everything. `problem` is why, or null for a plain stop by the user. */
  stop(problem: VoiceProblem | null = null): void {
    this.gen += 1;
    if (this.socket?.ready === true && this.state.talking) this.endOfStream();
    this.mic?.stop();
    this.socket?.close();
    this.mic = null;
    this.socket = null;
    this.micLive = false;
    this.socketReady = false;
    this.held = false;
    this.batcher.reset();
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.set({
      phase: 'off',
      talking: false,
      level: 0,
      problem,
      note: null,
      replay: false,
    });
  }

  dispose(): void {
    this.stop();
    this.detach();
  }

  private readonly onVisibility = (): void => {
    if (document.visibilityState === 'hidden' && this.state.phase !== 'off') this.stop('hidden');
  };

  private readonly onBlur = (): void => {
    // The key-up never arrives when the window loses focus mid-press.
    this.release();
  };

  private set(patch: Partial<VoiceState>): void {
    this.state = { ...this.state, ...patch };
    this.o.onChange(this.state);
  }

  private begin(): void {
    // A browser that cannot record is told so before any socket is opened.
    const unsupported = micSupport();
    if (unsupported !== null) {
      this.stop(unsupported);
      return;
    }
    const gen = (this.gen += 1);
    this.seq = 0;
    this.discontinuity = false;
    this.batcher = new Batcher();
    this.micLive = false;
    this.socketReady = false;
    this.startedAt = this.now();
    this.lastSpeechAt = this.startedAt;
    this.lastActiveAt = this.startedAt;
    this.lastSendAt = this.startedAt;
    this.set({
      phase: 'asking',
      talking: false,
      level: 0,
      caption: null,
      stt: null,
      problem: null,
      note: null,
    });
    try {
      this.socket = openAudioSocket(audioSocketUrl(this.o.apiBase, this.o.roomId), this.o.token, {
        onReady: () => {
          if (gen !== this.gen) return;
          this.socketReady = true;
          this.maybeReady();
        },
        onFeed: (msg) => {
          if (gen === this.gen) this.onFeed(msg);
        },
        onClose: (problem) => {
          if (gen === this.gen && problem !== null) this.stop(problem);
        },
      });
    } catch {
      this.stop('lost');
      return;
    }
    this.mic = startMic(
      {
        push: (pcm) => {
          if (gen === this.gen) this.onPcm(pcm);
        },
      },
      {
        onState: (s) => {
          if (gen === this.gen) this.onMicState(s);
        },
        onLevel: (level) => {
          if (gen === this.gen) this.onLevel(level);
        },
      },
    );
    // A browser that cannot capture reports at once, before the handle exists.
    if (gen !== this.gen) {
      this.mic.stop();
      this.mic = null;
    }
  }

  /**
   * Plays the host's recorded demo (cached speech mode): the same audio socket and the same host
   * pipeline, but no microphone and no audio sent. The host answers with captions at the recorded
   * offsets and decides bids as it would for live speech. Stops with the session limit or `stop`.
   */
  replay(): void {
    if (this.state.phase !== 'off') return;
    const gen = (this.gen += 1);
    this.seq = 0;
    this.discontinuity = false;
    this.batcher = new Batcher();
    this.micLive = false;
    this.socketReady = false;
    this.startedAt = this.now();
    this.lastSpeechAt = this.startedAt;
    this.lastActiveAt = this.startedAt;
    this.lastSendAt = this.startedAt;
    this.set({
      phase: 'connecting',
      talking: false,
      level: 0,
      caption: null,
      stt: null,
      problem: null,
      note: null,
      replay: true,
    });
    try {
      this.socket = openAudioSocket(audioSocketUrl(this.o.apiBase, this.o.roomId), this.o.token, {
        onReady: () => {
          if (gen !== this.gen) return;
          this.socketReady = true;
          this.set({ phase: 'ready' });
          this.timer = setInterval(() => this.tick(), TICK_MS);
        },
        onFeed: (msg) => {
          if (gen === this.gen) this.onFeed(msg);
        },
        onClose: (problem) => {
          if (gen === this.gen && problem !== null) this.stop(problem);
        },
      });
    } catch {
      this.stop('lost');
    }
  }

  private onMicState(s: MicCaptureState): void {
    if (s === 'live') {
      this.micLive = true;
      this.set({ phase: 'connecting' });
      this.maybeReady();
    } else if (s !== 'off' && s !== 'requesting') {
      this.stop(s);
    }
  }

  private maybeReady(): void {
    if (!this.micLive || !this.socketReady || this.state.phase === 'ready') return;
    this.lastActiveAt = this.now();
    this.set({ phase: 'ready' });
    this.timer = setInterval(() => this.tick(), TICK_MS);
    if (this.mode === 'toggle' || this.held) this.startTalking();
  }

  private startTalking(): void {
    this.batcher.reset();
    this.discontinuity = true;
    this.lastSpeechAt = this.now();
    this.lastActiveAt = this.now();
    this.set({ talking: true, note: null });
  }

  /** The speaker stopped: send what is held, then tell the host to finish the utterance. */
  private endTalking(): void {
    const rest = this.batcher.flush();
    if (rest !== null) this.sendAudio(rest, 0);
    this.sendKeepalive(FLAG_KEEPALIVE | FLAG_END_OF_UTTERANCE);
    this.lastActiveAt = this.now();
    this.set({ talking: false });
  }

  private endOfStream(): void {
    const rest = this.batcher.flush();
    if (rest !== null) this.sendAudio(rest, FLAG_END_OF_STREAM);
  }

  private onPcm(pcm: Int16Array): void {
    if (this.state.phase !== 'ready' || !this.state.talking) return;
    for (const batch of this.batcher.push(pcm)) this.sendAudio(batch, 0);
  }

  private onLevel(level: number): void {
    if (level >= SPEECH_LEVEL) {
      this.lastSpeechAt = this.now();
      if (this.state.talking) this.lastActiveAt = this.lastSpeechAt;
    }
    this.set({ level });
  }

  private onFeed(msg: AudioFeed): void {
    if (msg.t === 'caption') this.set({ caption: { text: msg.text, final: msg.final } });
    else if (msg.t === 'status') this.set({ stt: msg.stt });
    else this.set({ note: 'confirmExpired' });
  }

  private sendAudio(pcm: Int16Array, flags: number): void {
    const f = flags | (this.discontinuity ? FLAG_DISCONTINUITY : 0);
    const bytes = encodeBatch({ seq: this.seq, tsMs: this.now() - this.startedAt, flags: f, pcm });
    if (this.socket?.send(bytes) === true) {
      this.seq += 1;
      this.discontinuity = false;
      this.lastSendAt = this.now();
    } else {
      // Dropped: the next message tells the host there is a gap.
      this.discontinuity = true;
    }
  }

  private sendKeepalive(flags: number): void {
    const bytes = encodeBatch({
      seq: this.seq,
      tsMs: this.now() - this.startedAt,
      flags,
      pcm: new Int16Array(0),
    });
    if (this.socket?.send(bytes) === true) {
      this.seq += 1;
      this.lastSendAt = this.now();
    }
  }

  private tick(): void {
    if (this.state.phase !== 'ready') return;
    const now = this.now();
    if (now - this.startedAt >= MAX_SESSION_MS) return this.stop('maxSession');
    if (this.state.replay) {
      if (now - this.lastSendAt >= KEEPALIVE_MS) this.sendKeepalive(FLAG_KEEPALIVE);
      return;
    }
    if (this.mode === 'toggle' && now - this.lastSpeechAt >= SILENCE_CUTOFF_MS) {
      return this.stop('silence');
    }
    if (this.mode === 'hold') {
      if (this.held && this.state.talking && now - this.holdStartedAt >= MAX_HOLD_MS) {
        this.release();
        this.set({ note: 'maxClip' });
        return;
      }
      if (!this.held && now - this.lastActiveAt >= IDLE_DISARM_MS) return this.stop('idle');
    }
    if (!this.state.talking && now - this.lastSendAt >= KEEPALIVE_MS) {
      this.sendKeepalive(FLAG_KEEPALIVE);
    }
  }
}
