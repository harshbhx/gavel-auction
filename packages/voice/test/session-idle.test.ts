import { describe, expect, it } from 'vitest';
import { AUDIO_IDLE_MS, createVoiceSession } from '../src/index.js';

describe('audio idle timeout (HRD-14)', () => {
  const clock = { t: 5_000_000 };
  const mk = () =>
    createVoiceSession({
      now: () => clock.t,
      verifyToken: () => true,
    });

  it('frees slots of silent streams so a third bidder can open one', () => {
    const session = mk();
    const open = (token: string, source: string) => session.open({ roomId: 'r1', source }, token);
    expect(open('tok-x', 'a')).toMatchObject({ ok: true });
    expect(open('tok-x', 'b')).toMatchObject({ ok: true });
    expect(open('tok-y', 'c')).toMatchObject({ ok: true });
    expect(open('tok-y', 'd')).toMatchObject({ ok: true });
    expect(open('tok-z', 'e')).toEqual({ ok: false, error: 'AUDIO_STREAM_BUSY' });
    clock.t += AUDIO_IDLE_MS;
    const z = open('tok-z', 'e');
    expect(z.ok).toBe(true);
    expect(session.activeStreams()).toBe(1);
  });

  it('keeps a stream alive while frames arrive and ends a swept one', () => {
    const session = mk();
    const a = session.open({ roomId: 'r2', source: 'a' }, 'tok-x');
    const b = session.open({ roomId: 'r2', source: 'b' }, 'tok-x');
    if (!a.ok || !b.ok) throw new Error('open failed');
    clock.t += AUDIO_IDLE_MS - 1;
    expect(a.stream.accept(new Uint8Array(10)).ok).toBe(true);
    clock.t += AUDIO_IDLE_MS - 1;
    expect(a.stream.accept(new Uint8Array(10)).ok).toBe(true);
    expect(session.open({ roomId: 'r2', source: 'c' }, 'tok-x')).toMatchObject({ ok: true });
    expect(b.stream.accept(new Uint8Array(10))).toMatchObject({ ok: false, closed: true });
  });
});
