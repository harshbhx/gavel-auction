import { useCallback, useEffect, useMemo, useState } from 'react';
import { VoiceController, type VoiceMode, type VoiceState } from './voiceController';

export interface VoiceControls {
  state: VoiceState;
  mode: VoiceMode;
  setMode: (mode: VoiceMode) => void;
  toggle: () => void;
  press: () => void;
  release: () => void;
  stop: () => void;
}

const OFF: VoiceState = {
  phase: 'off',
  talking: false,
  level: 0,
  caption: null,
  stt: null,
  problem: null,
  note: null,
};

/**
 * Holds one voice controller for a room. Nothing starts by itself; the controller is disposed
 * (microphone and socket released) on unmount, and stopped as soon as `closed` turns true.
 */
export function useVoice(input: {
  apiBase: string;
  roomId: string;
  token: string;
  closed: boolean;
}): VoiceControls {
  const { apiBase, roomId, token, closed } = input;
  const [state, setState] = useState<VoiceState>(OFF);
  const [mode, setModeState] = useState<VoiceMode>('toggle');
  const controller = useMemo(
    () => new VoiceController({ apiBase, roomId, token, onChange: setState }),
    [apiBase, roomId, token],
  );
  useEffect(() => {
    controller.attach();
    return () => controller.dispose();
  }, [controller]);
  useEffect(() => {
    if (closed && controller.current.phase !== 'off') controller.stop('closed');
  }, [closed, controller]);
  const setMode = useCallback(
    (next: VoiceMode) => {
      controller.setMode(next);
      setModeState(next);
    },
    [controller],
  );
  return {
    state,
    mode,
    setMode,
    toggle: () => controller.toggle(),
    press: () => controller.press(),
    release: () => controller.release(),
    stop: () => controller.stop(),
  };
}
