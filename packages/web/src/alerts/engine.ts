import { TONES, VIBRATION, type AlertType } from './rules';

export const MUTE_KEY = 'gavel.alertsMuted';

export interface AlertEnv {
  /** Returns the audio context, or null when the browser has none. Called at most once, after an interaction. */
  createContext(): AudioContext | null;
  /** Calls navigator.vibrate; returns false when unsupported. */
  vibrate(pattern: readonly number[]): boolean;
  reducedMotion(): boolean;
  readStorage(): string | null;
  writeStorage(value: string): void;
}

export interface AlertEngine {
  isMuted(): boolean;
  setMuted(muted: boolean): void;
  /** Starts listening to the mute state; returns the unsubscribe function. */
  subscribe(listener: () => void): () => void;
  /** Called from a user gesture: allows sound from now on. */
  unlock(): void;
  /** Plays and vibrates for one alert, as far as mute, unlock and motion settings allow. */
  trigger(type: AlertType): void;
}

export function createAlertEngine(env: AlertEnv): AlertEngine {
  let muted = ((): boolean => {
    try {
      return env.readStorage() === '1';
    } catch {
      return false;
    }
  })();
  let unlocked = false;
  let ctx: AudioContext | null = null;
  const listeners = new Set<() => void>();

  const context = (): AudioContext | null => {
    if (ctx === null) {
      try {
        ctx = env.createContext();
      } catch {
        ctx = null;
      }
    }
    return ctx;
  };

  const resume = (c: AudioContext): void => {
    try {
      void c.resume().catch(() => undefined);
    } catch {
      // A context that cannot resume stays silent.
    }
  };

  const play = (type: AlertType): void => {
    const c = context();
    if (c === null) return;
    if (c.state !== 'running') {
      // Still suspended: ask again, but never schedule sound the browser has not allowed.
      resume(c);
      return;
    }
    try {
      const t0 = c.currentTime;
      for (const tone of TONES[type]) {
        const start = t0 + tone.atMs / 1000;
        const end = start + tone.durMs / 1000;
        const osc = c.createOscillator();
        const gain = c.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(tone.hz, start);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(tone.gain, start + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, end);
        osc.connect(gain);
        gain.connect(c.destination);
        osc.start(start);
        osc.stop(end + 0.02);
      }
    } catch {
      // Sound is a courtesy; a failure must not break the room.
    }
  };

  return {
    isMuted: () => muted,
    setMuted(next) {
      if (next === muted) return;
      muted = next;
      try {
        env.writeStorage(next ? '1' : '0');
      } catch {
        // Storage can be blocked; the choice then lasts until reload.
      }
      listeners.forEach((l) => l());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    unlock() {
      unlocked = true;
      if (muted) return;
      const c = context();
      if (c !== null && c.state !== 'running') resume(c);
    },
    trigger(type) {
      if (muted) return;
      const pattern = VIBRATION[type];
      if (pattern.length > 0 && !env.reducedMotion()) {
        try {
          env.vibrate(pattern);
        } catch {
          // Haptics are optional.
        }
      }
      if (unlocked) play(type);
    },
  };
}

/** The browser wiring. Every access is guarded so a blocked API only silences the alert. */
export function browserEnv(): AlertEnv {
  return {
    createContext() {
      const Ctor = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
      return Ctor === undefined ? null : new Ctor();
    },
    vibrate(pattern) {
      const nav = globalThis.navigator as Navigator | undefined;
      if (nav === undefined || typeof nav.vibrate !== 'function') return false;
      return nav.vibrate([...pattern]);
    },
    reducedMotion() {
      try {
        return globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;
      } catch {
        return false;
      }
    },
    readStorage() {
      try {
        return globalThis.localStorage.getItem(MUTE_KEY);
      } catch {
        return null;
      }
    },
    writeStorage(value) {
      try {
        globalThis.localStorage.setItem(MUTE_KEY, value);
      } catch {
        // Blocked storage: not persisted.
      }
    },
  };
}

let shared: AlertEngine | null = null;

/** One engine per page. */
export function alertEngine(): AlertEngine {
  shared ??= createAlertEngine(browserEnv());
  return shared;
}
