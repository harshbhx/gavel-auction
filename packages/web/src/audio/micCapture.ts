import { createLevelMeter } from './levelMeter';
import { createResampler } from './resample';
import { floatToPcm16, WORKLET_NAME, workletModuleUrl } from './worklet';

/**
 * Where microphone capture stands. `denied` is a refused permission, `nomic` no input device
 * (or one that was unplugged), `busy` a device another app holds, `unsupported` a browser without
 * the audio APIs, `insecure` a page that is not served over HTTPS.
 */
export type MicCaptureState =
  | 'off'
  | 'requesting'
  | 'live'
  | 'error'
  | 'denied'
  | 'nomic'
  | 'busy'
  | 'unsupported'
  | 'insecure';

/** Local shape of the voice package frame sink: one call per PCM chunk (16 kHz, mono, 16 bit). */
export interface AudioFrameSink {
  push(pcm: Int16Array, audioTsMs: number): void;
}

export interface MicHandle {
  stop(): void;
}

export interface MicCallbacks {
  onState(state: MicCaptureState): void;
  onLevel(level: number): void;
}

/** The state a browser cannot start in, or null when the audio APIs are there. */
export function micSupport(): 'insecure' | 'unsupported' | null {
  if ((globalThis as { isSecureContext?: boolean }).isSecureContext === false) return 'insecure';
  const gum = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices?.getUserMedia;
  if (typeof gum !== 'function') return 'unsupported';
  if (typeof AudioContext !== 'function' || typeof AudioWorkletNode !== 'function') {
    return 'unsupported';
  }
  return null;
}

/** The state a getUserMedia failure maps to. */
export function stateForError(err: unknown): MicCaptureState {
  const name = typeof err === 'object' && err !== null ? (err as { name?: unknown }).name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (
    name === 'NotFoundError' ||
    name === 'OverconstrainedError' ||
    name === 'DevicesNotFoundError'
  )
    return 'nomic';
  if (name === 'NotReadableError' || name === 'AbortError') return 'busy';
  return 'error';
}

/** Asks for the microphone and streams PCM chunks to `sink`. A refusal is reported, never thrown. */
export function startMic(sink: AudioFrameSink, callbacks: MicCallbacks): MicHandle {
  let stopped = false;
  let stream: MediaStream | null = null;
  let ctx: AudioContext | null = null;

  const release = (): void => {
    stream?.getTracks().forEach((track) => track.stop());
    void ctx?.close();
    stream = null;
    ctx = null;
  };

  const unsupported = micSupport();
  if (unsupported !== null) {
    callbacks.onState(unsupported);
    return { stop: () => undefined };
  }

  callbacks.onState('requesting');
  const meter = createLevelMeter(callbacks.onLevel);

  const run = async (): Promise<void> => {
    const media = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    if (stopped) {
      media.getTracks().forEach((track) => track.stop());
      return;
    }
    stream = media;
    const audio = new AudioContext();
    ctx = audio;
    const url = workletModuleUrl();
    try {
      await audio.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    // A context made after an await can start suspended; the click that began this allows it.
    if (audio.state === 'suspended') await audio.resume();
    if (stopped) return;
    const source = audio.createMediaStreamSource(media);
    const node = new AudioWorkletNode(audio, WORKLET_NAME);
    const resampler = createResampler(audio.sampleRate);
    const started = performance.now();
    node.port.onmessage = (ev: MessageEvent<Float32Array>) => {
      if (stopped) return;
      const pcm = floatToPcm16(resampler.process(ev.data));
      if (pcm.length === 0) return;
      meter.push(pcm, performance.now());
      sink.push(pcm, Math.round(performance.now() - started));
    };
    // An unplugged device ends its track; say so instead of listening to silence.
    for (const track of media.getTracks()) {
      track.addEventListener?.('ended', () => {
        if (stopped) return;
        release();
        callbacks.onLevel(0);
        callbacks.onState('nomic');
      });
    }
    source.connect(node);
    callbacks.onState('live');
  };

  run().catch((err: unknown) => {
    if (stopped) return;
    release();
    callbacks.onState(stateForError(err));
  });

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      release();
      callbacks.onLevel(0);
      callbacks.onState('off');
    },
  };
}
