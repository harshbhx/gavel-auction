/** Keeps replay audio within 150 ms of event time (R-WEB-102). Falls back to captions only. */

export const MAX_DRIFT_MS = 150;

/** The slice of an HTMLMediaElement the sync needs, so tests can pass a stub. */
export interface MediaLike {
  currentTime: number;
  playbackRate: number;
  paused: boolean;
  play(): Promise<void> | void;
  pause(): void;
  addEventListener(type: 'error', fn: () => void): void;
  removeEventListener(type: 'error', fn: () => void): void;
}

export type AudioStatus = 'ready' | 'captions-only';

export interface AudioSync {
  /** Event time `t` in ms moved (seek, tick, speed change): re-align when the drift is too big. */
  sync(tMs: number): void;
  setPlaying(playing: boolean): void;
  setSpeed(speed: number): void;
  /** Drift in ms between the audio position and event time, 0 once captions only. */
  drift(tMs: number): number;
  status(): AudioStatus;
  dispose(): void;
}

export function createAudioSync(
  media: MediaLike,
  onStatus: (status: AudioStatus) => void = () => undefined,
): AudioSync {
  let state: AudioStatus = 'ready';

  const fail = (): void => {
    if (state === 'captions-only') return;
    state = 'captions-only';
    onStatus(state);
  };
  media.addEventListener('error', fail);

  const safePlay = (): void => {
    try {
      const result = media.play();
      if (result !== undefined) result.catch(fail);
    } catch {
      fail();
    }
  };

  const gap = (tMs: number): number => Math.abs(media.currentTime * 1000 - tMs);

  return {
    sync(tMs) {
      if (state !== 'ready') return;
      if (gap(tMs) > MAX_DRIFT_MS) media.currentTime = tMs / 1000;
    },
    setPlaying(playing) {
      if (state !== 'ready') return;
      if (playing) safePlay();
      else media.pause();
    },
    setSpeed(speed) {
      if (state === 'ready') media.playbackRate = speed;
    },
    drift(tMs) {
      return state === 'ready' ? gap(tMs) : 0;
    },
    status: () => state,
    dispose() {
      media.removeEventListener('error', fail);
      if (state === 'ready') media.pause();
    },
  };
}
