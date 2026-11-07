import { describe, expect, it, vi } from 'vitest';

import { createAlertEngine, MUTE_KEY, type AlertEnv } from '../../src/alerts/engine';
import { alertForHammer, alertForStatus, TONES, VIBRATION } from '../../src/alerts/rules';

function fakeContext(state: 'running' | 'suspended') {
  const started: number[] = [];
  const ctx = {
    state,
    currentTime: 0,
    destination: {},
    resume: vi.fn(() => Promise.resolve()),
    createOscillator: vi.fn(() => ({
      type: 'sine',
      frequency: { setValueAtTime: vi.fn() },
      connect: vi.fn(),
      start: (at: number) => started.push(at),
      stop: vi.fn(),
    })),
    createGain: vi.fn(() => ({
      gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      connect: vi.fn(),
    })),
  };
  return { ctx, started };
}

function makeEnv(over: Partial<AlertEnv> & { stored?: string | null } = {}) {
  const store = { value: over.stored ?? null };
  const vibrate = vi.fn(() => true);
  const env: AlertEnv = {
    createContext: () => null,
    vibrate,
    reducedMotion: () => false,
    readStorage: () => store.value,
    writeStorage: (v) => {
      store.value = v;
    },
    ...over,
  };
  return { env, store, vibrate };
}

describe('alert rules', () => {
  it('outbid only when a leader is passed', () => {
    expect(alertForStatus('leading', 'outbid')).toBe('outbid');
    expect(alertForStatus('leading', 'atCeiling')).toBe('outbid');
    expect(alertForStatus('none', 'outbid')).toBeNull();
    expect(alertForStatus('outbid', 'outbid')).toBeNull();
  });

  it('win and sold on the final result', () => {
    expect(alertForStatus('leading', 'won')).toBe('win');
    expect(alertForStatus('leading', 'lost')).toBe('sold');
    expect(alertForStatus('won', 'won')).toBeNull();
  });

  it('stays quiet before the bidder has joined', () => {
    expect(alertForStatus('watching', 'won')).toBeNull();
    expect(alertForStatus('watching', 'leading')).toBeNull();
  });

  it('hammer alert fires once on arrival', () => {
    expect(alertForHammer(false, true)).toBe('hammer');
    expect(alertForHammer(true, true)).toBeNull();
    expect(alertForHammer(false, false)).toBeNull();
  });

  it('tones are small and quiet', () => {
    for (const tones of Object.values(TONES)) {
      for (const tone of tones) expect(tone.gain).toBeLessThanOrEqual(0.2);
    }
    expect(VIBRATION.hammer).toEqual([]);
  });
});

describe('mute state', () => {
  it('defaults to unmuted and persists the choice', () => {
    const { env, store } = makeEnv();
    const engine = createAlertEngine(env);
    expect(engine.isMuted()).toBe(false);
    const listener = vi.fn();
    engine.subscribe(listener);
    engine.setMuted(true);
    expect(store.value).toBe('1');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(createAlertEngine(makeEnv({ stored: '1' }).env).isMuted()).toBe(true);
  });

  it('survives blocked storage', () => {
    const { env } = makeEnv({
      readStorage: () => {
        throw new Error('blocked');
      },
      writeStorage: () => {
        throw new Error('blocked');
      },
    });
    const engine = createAlertEngine(env);
    expect(engine.isMuted()).toBe(false);
    expect(() => engine.setMuted(true)).not.toThrow();
    expect(engine.isMuted()).toBe(true);
  });

  it('muted means no sound and no vibration', () => {
    const { ctx } = fakeContext('running');
    const { env, vibrate } = makeEnv({ createContext: () => ctx as unknown as AudioContext });
    const engine = createAlertEngine(env);
    engine.unlock();
    engine.setMuted(true);
    engine.trigger('outbid');
    expect(vibrate).not.toHaveBeenCalled();
    expect(ctx.createOscillator).not.toHaveBeenCalled();
    expect(MUTE_KEY).toBe('gavel.alertsMuted');
  });
});

describe('autoplay and motion', () => {
  it('plays no sound before a user gesture', () => {
    const { ctx } = fakeContext('running');
    const create = vi.fn(() => ctx as unknown as AudioContext);
    const engine = createAlertEngine(makeEnv({ createContext: create }).env);
    engine.trigger('win');
    expect(create).not.toHaveBeenCalled();
    expect(ctx.createOscillator).not.toHaveBeenCalled();
  });

  it('plays after the gesture when the context runs', () => {
    const { ctx, started } = fakeContext('running');
    const engine = createAlertEngine(
      makeEnv({ createContext: () => ctx as unknown as AudioContext }).env,
    );
    engine.unlock();
    engine.trigger('win');
    expect(started).toHaveLength(TONES.win.length);
  });

  it('schedules nothing while the context is still suspended', () => {
    const { ctx } = fakeContext('suspended');
    const engine = createAlertEngine(
      makeEnv({ createContext: () => ctx as unknown as AudioContext }).env,
    );
    engine.unlock();
    engine.trigger('outbid');
    expect(ctx.resume).toHaveBeenCalled();
    expect(ctx.createOscillator).not.toHaveBeenCalled();
  });

  it('skips vibration under reduced motion but still plays sound', () => {
    const { ctx, started } = fakeContext('running');
    const { env, vibrate } = makeEnv({
      createContext: () => ctx as unknown as AudioContext,
      reducedMotion: () => true,
    });
    const engine = createAlertEngine(env);
    engine.unlock();
    engine.trigger('outbid');
    expect(vibrate).not.toHaveBeenCalled();
    expect(started).toHaveLength(TONES.outbid.length);
  });

  it('vibrates with the alert pattern otherwise', () => {
    const { env, vibrate } = makeEnv();
    createAlertEngine(env).trigger('win');
    expect(vibrate).toHaveBeenCalledWith(VIBRATION.win);
  });
});
