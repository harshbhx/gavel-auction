import { useCallback, useEffect, useRef, useState } from 'react';
import { startMic, type AudioFrameSink, type MicCaptureState, type MicHandle } from './micCapture';

export interface MicControls {
  state: MicCaptureState;
  /** Input level 0..1. */
  level: number;
  /** Asks for the microphone. Call it from a user gesture only. */
  start: () => void;
  stop: () => void;
}

/** Holds microphone state and level. Never starts by itself; stops on unmount. */
export function useMic(sink: AudioFrameSink): MicControls {
  const [state, setState] = useState<MicCaptureState>('off');
  const [level, setLevel] = useState(0);
  const handle = useRef<MicHandle | null>(null);
  const sinkRef = useRef(sink);
  sinkRef.current = sink;

  const stop = useCallback((): void => {
    handle.current?.stop();
    handle.current = null;
  }, []);

  const start = useCallback((): void => {
    if (handle.current !== null) return;
    handle.current = startMic(
      { push: (pcm, ts) => sinkRef.current.push(pcm, ts) },
      {
        onState: (next) => {
          setState(next);
          if (next === 'denied' || next === 'error') handle.current = null;
        },
        onLevel: setLevel,
      },
    );
  }, []);

  useEffect(() => stop, [stop]);

  return { state, level, start, stop };
}
