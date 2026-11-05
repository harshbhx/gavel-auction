import { describe, expect, it } from 'vitest';
import { createVoiceSession, type AudioStream } from '../src/index.js';

function setup() {
  const clock = { t: 1_000_000 };
  const session = createVoiceSession({
    now: () => clock.t,
    verifyToken: (token, roomId) =>
      token === `ok-${roomId}` ? 'auctioneer' : token === `bid-${roomId}` ? 'bidder' : null,
  });
  const open = (source = 'mic', room = 'r1'): AudioStream => {
    const res = session.open({ roomId: room, source }, `ok-${room}`);
    if (!res.ok) throw new Error(res.error);
    return res.stream;
  };
  return { clock, session, open };
}

describe('T-VOX-105 audio websocket limits (R-VOX-097)', () => {
  it('rejects a valid token whose role may not stream audio', () => {
    const { session } = setup();
    expect(session.open({ roomId: 'r1', source: 'mic' }, 'bid-r1')).toEqual({
      ok: false,
      error: 'AUDIO_UNAUTHORIZED',
    });
    expect(session.activeStreams()).toBe(0);
  });

  it('rejects a missing or wrong token', () => {
    const { session } = setup();
    expect(session.open({ roomId: 'r1', source: 'mic' }, undefined)).toEqual({
      ok: false,
      error: 'AUDIO_UNAUTHORIZED',
    });
    expect(session.open({ roomId: 'r1', source: 'mic' }, 'bad')).toEqual({
      ok: false,
      error: 'AUDIO_UNAUTHORIZED',
    });
    expect(session.activeStreams()).toBe(0);
  });

  it('accepts binary frames and rejects text or empty frames', () => {
    const { open, session } = setup();
    const s = open();
    expect(s.accept(new Uint8Array(640))).toEqual({ ok: true, bytes: 640 });
    expect(s.accept('hello')).toEqual({ ok: false, error: 'AUDIO_BAD_FRAME', closed: true });
    expect(session.activeStreams()).toBe(0);
    const s2 = open();
    expect(s2.accept(new ArrayBuffer(0))).toMatchObject({ error: 'AUDIO_BAD_FRAME' });
  });

  it('closes on 70 KiB inside one second but allows 64 KiB per second', () => {
    const { open, clock } = setup();
    const ok = open('a');
    for (let i = 0; i < 64; i++) expect(ok.accept(new Uint8Array(1024)).ok).toBe(true);
    expect(ok.accept(new Uint8Array(1))).toMatchObject({ error: 'AUDIO_RATE_LIMIT' });

    const burst = open('b');
    expect(burst.accept(new Uint8Array(40 * 1024)).ok).toBe(true);
    expect(burst.accept(new Uint8Array(30 * 1024))).toMatchObject({ error: 'AUDIO_RATE_LIMIT' });

    const paced = open('c');
    for (let i = 0; i < 10; i++) {
      expect(paced.accept(new Uint8Array(60 * 1024)).ok).toBe(true);
      clock.t += 1000;
    }
  });

  it('closes a session after 30 minutes', () => {
    const { open, clock } = setup();
    const s = open();
    expect(s.expiresAtMs).toBe(1_000_000 + 30 * 60 * 1000);
    clock.t += 30 * 60 * 1000 - 1;
    expect(s.accept(new Uint8Array(10)).ok).toBe(true);
    clock.t += 1;
    expect(s.accept(new Uint8Array(10))).toMatchObject({ error: 'AUDIO_SESSION_LIMIT' });
  });

  it('allows one stream per (room, source) and frees the slot on close', () => {
    const { session, open } = setup();
    const s = open('mic', 'r1');
    expect(session.open({ roomId: 'r1', source: 'mic' }, 'ok-r1')).toEqual({
      ok: false,
      error: 'AUDIO_STREAM_BUSY',
    });
    expect(open('cam', 'r1')).toBeDefined();
    expect(open('mic', 'r2')).toBeDefined();
    s.close();
    s.close();
    expect(session.open({ roomId: 'r1', source: 'mic' }, 'ok-r1').ok).toBe(true);
  });

  it('caps streams per token and per room, however many sources are chosen (R6-C06)', () => {
    const { session } = setup();
    const tryOpen = (source: string, room = 'r1', token = `ok-${room}`) =>
      session.open({ roomId: room, source }, token);
    expect(tryOpen('a').ok).toBe(true);
    expect(tryOpen('b').ok).toBe(true);
    expect(tryOpen('c')).toEqual({ ok: false, error: 'AUDIO_STREAM_BUSY' });
    expect(session.activeStreams()).toBe(2);
  });

  it('caps streams per room across tokens', () => {
    const clock = { t: 1_000_000 };
    const session = createVoiceSession({
      now: () => clock.t,
      verifyToken: () => 'auctioneer',
      maxStreamsPerToken: 1,
      maxStreamsPerRoom: 2,
    });
    expect(session.open({ roomId: 'r', source: 'a' }, 't1').ok).toBe(true);
    expect(session.open({ roomId: 'r', source: 'b' }, 't2').ok).toBe(true);
    expect(session.open({ roomId: 'r', source: 'c' }, 't3')).toEqual({
      ok: false,
      error: 'AUDIO_STREAM_BUSY',
    });
  });

  it('reclaims a slot whose session cap passed without close()', () => {
    const { session, clock } = setup();
    expect(session.open({ roomId: 'r1', source: 'mic' }, 'ok-r1').ok).toBe(true);
    clock.t += 30 * 60 * 1000;
    expect(session.open({ roomId: 'r1', source: 'mic' }, 'ok-r1').ok).toBe(true);
    expect(session.activeStreams()).toBe(1);
  });
});
