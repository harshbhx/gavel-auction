import { describe, expect, it } from 'vitest';
import {
  FLAG_DISCONTINUITY,
  FLAG_END_OF_UTTERANCE,
  FLAG_KEEPALIVE,
  FRAME_SAMPLES,
  type AudioBatch,
} from '../../src/audio/frame.js';
import {
  MuteController,
  type IntervalScheduler,
  type MuteControllerOptions,
} from '../../src/browser/mute.js';

class FakeClock implements IntervalScheduler {
  t = 0;
  private timers: Array<{ fn: () => void; ms: number; next: number; live: boolean }> = [];

  every(fn: () => void, ms: number): () => void {
    const timer = { fn, ms, next: this.t + ms, live: true };
    this.timers.push(timer);
    return () => {
      timer.live = false;
    };
  }

  advance(ms: number): void {
    const end = this.t + ms;
    for (;;) {
      const due = this.timers
        .filter((x) => x.live && x.next <= end)
        .sort((a, b) => a.next - b.next)[0];
      if (!due) break;
      this.t = due.next;
      due.next += due.ms;
      due.fn();
    }
    this.t = end;
  }
}

function audio(tsMs: number): AudioBatch {
  return { seq: 0, tsMs, flags: 0, pcm: new Int16Array(FRAME_SAMPLES) };
}

function setup(extra: Partial<MuteControllerOptions> = {}) {
  const clock = new FakeClock();
  const out: AudioBatch[] = [];
  const states: string[] = [];
  const ctl = new MuteController({
    sink: (b) => out.push(b),
    scheduler: clock,
    now: () => clock.t,
    onState: (s, r) => states.push(r ? `${s}:${r}` : s),
    ...extra,
  });
  return { clock, out, states, ctl };
}

describe('MuteController', () => {
  it('T-VOX-012: mute stops audio and sends keepalives every 5000 ms', () => {
    const { clock, out, ctl } = setup();
    ctl.attach();
    ctl.push(audio(0));
    expect(out).toHaveLength(1);
    ctl.mute();
    expect(ctl.state).toBe('muted');
    ctl.push(audio(20));
    expect(out).toHaveLength(1);
    clock.advance(4999);
    expect(out).toHaveLength(1);
    clock.advance(1);
    clock.advance(5000);
    const keep = out.slice(1);
    expect(keep.map((b) => b.tsMs)).toEqual([5000, 10000]);
    for (const b of keep) {
      expect(b.flags & FLAG_KEEPALIVE).toBe(FLAG_KEEPALIVE);
      expect(b.pcm.length).toBe(0);
    }
    expect(out.map((b) => b.seq)).toEqual([0, 1, 2]);
  });

  it('unmute resumes audio with a discontinuity flag once and stops keepalives', () => {
    const { clock, out, ctl } = setup();
    ctl.attach();
    ctl.mute();
    ctl.unmute();
    expect(ctl.state).toBe('running');
    clock.advance(20000);
    expect(out).toHaveLength(0);
    ctl.push(audio(100));
    ctl.push(audio(120));
    expect(out[0]?.flags).toBe(FLAG_DISCONTINUITY);
    expect(out[1]?.flags).toBe(0);
  });

  it('AudioContext suspended moves to muted(suspended) within 1 s', () => {
    let ctxState = 'running';
    const { clock, states, ctl } = setup({ contextState: () => ctxState });
    ctl.attach();
    clock.advance(300);
    ctxState = 'suspended';
    clock.advance(1000);
    expect(ctl.state).toBe('muted');
    expect(ctl.reason).toBe('suspended');
    expect(states).toContain('muted:suspended');
    ctl.gesture();
    expect(ctl.state).toBe('running');
  });

  it('push-to-talk starts silent, talk start and end gate audio', () => {
    const { clock, out, ctl } = setup({ mode: 'push_to_talk' });
    ctl.attach();
    expect(ctl.state).toBe('muted');
    ctl.push(audio(0));
    expect(out).toHaveLength(0);
    clock.advance(5000);
    expect(out).toHaveLength(1);
    ctl.talkStart();
    ctl.push(audio(5100));
    expect(out).toHaveLength(2);
    expect(out[1]?.flags).toBe(FLAG_DISCONTINUITY);
    ctl.talkEnd();
    // Releasing the key sends one end-of-utterance marker; later audio is still gated.
    expect(out).toHaveLength(3);
    ctl.push(audio(5200));
    expect(out).toHaveLength(3);
  });

  it('push-to-talk release ends the utterance (R12-V06)', () => {
    const { out, ctl } = setup({ mode: 'push_to_talk' });
    ctl.attach();
    expect(out).toHaveLength(0);
    ctl.talkStart();
    ctl.talkEnd();
    const last = out[out.length - 1];
    expect(last?.flags).toBe(FLAG_KEEPALIVE | FLAG_END_OF_UTTERANCE);
    expect(last?.pcm.length).toBe(0);
  });

  it('a user mute ends the utterance too (R12-V06)', () => {
    const { out, ctl } = setup();
    ctl.attach();
    ctl.mute();
    expect(out[out.length - 1]?.flags).toBe(FLAG_KEEPALIVE | FLAG_END_OF_UTTERANCE);
  });

  it('setMode switches between open-mic and push-to-talk; talk keys are inert in open-mic', () => {
    const { ctl } = setup();
    ctl.attach();
    ctl.talkEnd();
    expect(ctl.state).toBe('running');
    ctl.setMode('push_to_talk');
    expect(ctl.state).toBe('muted');
    ctl.setMode('open_mic');
    expect(ctl.state).toBe('running');
    ctl.mute();
    ctl.setMode('push_to_talk');
    ctl.setMode('open_mic');
    expect(ctl.state).toBe('muted');
  });

  it('track end errors at once and restarts exactly once', async () => {
    let restarts = 0;
    const { clock, states, ctl } = setup({
      restart: () => {
        restarts += 1;
        return Promise.resolve(true);
      },
    });
    ctl.attach();
    ctl.trackEnded();
    expect(states).toContain('error');
    expect(ctl.state).toBe('requesting');
    await Promise.resolve();
    await Promise.resolve();
    expect(ctl.state).toBe('running');
    expect(restarts).toBe(1);
    ctl.trackEnded();
    expect(ctl.state).toBe('error');
    clock.advance(10000);
    expect(restarts).toBe(1);
  });

  it('failed restart leaves no running state', async () => {
    const { ctl } = setup({ restart: () => Promise.resolve(false) });
    ctl.attach();
    ctl.trackEnded();
    await Promise.resolve();
    await Promise.resolve();
    expect(ctl.state).toBe('no_device');
  });

  it('a throwing sink does not break capture', () => {
    const { ctl } = setup({
      sink: () => {
        throw new Error('boom');
      },
    });
    ctl.attach();
    expect(() => ctl.push(audio(0))).not.toThrow();
  });
});
