import { createLevelMeter } from './levelMeter';
import { floatToPcm16, resampleTo16k, WORKLET_NAME, workletModuleUrl } from './worklet';

export type MicCaptureState = 'off' | 'requesting' | 'live' | 'error' | 'denied';

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

/** Asks for the microphone and streams PCM chunks to `sink`. Denial is reported, never thrown. */
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

  callbacks.onState('requesting');
  const meter = createLevelMeter(callbacks.onLevel);

  const run = async (): Promise<void> => {
    const media = await navigator.mediaDevices.getUserMedia({ audio: true });
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
    const source = audio.createMediaStreamSource(media);
    const node = new AudioWorkletNode(audio, WORKLET_NAME);
    const started = performance.now();
    node.port.onmessage = (ev: MessageEvent<Float32Array>) => {
      if (stopped) return;
      const pcm = floatToPcm16(resampleTo16k(ev.data, audio.sampleRate));
      meter.push(pcm, performance.now());
      sink.push(pcm, Math.round(performance.now() - started));
    };
    source.connect(node);
    callbacks.onState('live');
  };

  run().catch((err: unknown) => {
    if (stopped) return;
    release();
    const denied = err instanceof DOMException && err.name === 'NotAllowedError';
    callbacks.onState(denied ? 'denied' : 'error');
  });

  return {
    stop() {
      stopped = true;
      release();
      callbacks.onLevel(0);
      callbacks.onState('off');
    },
  };
}
