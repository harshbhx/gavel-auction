import { describe, expect, it } from 'vitest';
import { FRAME_SAMPLES } from '../../src/audio/frame.js';
import type { WsFactory } from '../../src/stt/deepgram.js';
import {
  DEFAULT_KEYTERMS,
  DEFAULT_RECONNECT_POLICY,
  ReconnectTracker,
  ReconnectingDeepgramStt,
  keytermPairs,
  type ReconnectingDeepgramOptions,
} from '../../src/stt/deepgram-reconnect.js';
import { runConformance } from './conformance.js';
import { FakeScheduler, MockWs, flush, mockFactory, record } from './deepgram-mock.js';

const START = { keyterms: [...DEFAULT_KEYTERMS], language: 'en' as const };

/** Sockets open when `opens(index)` says so and otherwise close at once, like a refused handshake. */
function scripted(clock: FakeScheduler, opens: (index: number) => boolean) {
  const sockets: MockWs[] = [];
  const times: number[] = [];
  const factory: WsFactory = (url, protocols) => {
    const index = sockets.length;
    const ok = opens(index);
    const ws = new MockWs(url, protocols, { autoOpen: ok });
    if (!ok) queueMicrotask(() => ws.serverClose(1006));
    sockets.push(ws);
    times.push(clock.t);
    return ws;
  };
  return { factory, sockets, times };
}

function make(opts: Partial<ReconnectingDeepgramOptions> = {}) {
  const clock = new FakeScheduler();
  const { factory, sockets } = mockFactory();
  const provider = new ReconnectingDeepgramStt({
    apiKey: 'test-key-not-real',
    socket: factory,
    scheduler: clock,
    ...opts,
  });
  return { clock, sockets, provider };
}

runConformance('ReconnectingDeepgramStt', () => {
  const { clock, provider } = make();
  return { provider, advance: (ms) => clock.advance(ms) };
});

describe('keyterms (T-VOX-015)', () => {
  it('writes one keyterm param per term', async () => {
    const { provider, sockets } = make();
    await provider.start(START);
    const q = new URL(sockets[0]?.url ?? '').searchParams;
    expect(q.getAll('keyterm')).toEqual([...DEFAULT_KEYTERMS]);
    expect(q.get('model')).toBe('nova-3');
    await provider.stop();
  });

  it('with keyterms off there is no keyterm param', async () => {
    const { provider, sockets } = make({ useKeyterms: false });
    await provider.start(START);
    const q = new URL(sockets[0]?.url ?? '').searchParams;
    expect(q.has('keyterm')).toBe(false);
    await provider.stop();
  });

  it('keytermPairs skips blanks and repeats and honours a renamed param', () => {
    expect(keytermPairs(['a', ' a ', '', 'b'], true, 'kt')).toEqual([
      ['kt', 'a'],
      ['kt', 'b'],
    ]);
    expect(keytermPairs(['a'], false)).toEqual([]);
  });

  it('a smart_format param can be switched on through the config alone', async () => {
    const { provider, sockets } = make({ config: { params: { smart_format: true } } });
    await provider.start(START);
    expect(new URL(sockets[0]?.url ?? '').searchParams.get('smart_format')).toBe('true');
    await provider.stop();
  });
});

describe('reconnect backoff (T-VOX-020)', () => {
  it('tracker hands out 250, 500, 1000 then null, and reset starts over', () => {
    const t = new ReconnectTracker();
    expect([t.next(), t.next(), t.next(), t.next()]).toEqual([250, 500, 1000, null]);
    expect(t.attempts).toBe(3);
    t.reset();
    expect(t.next()).toBe(250);
    expect(DEFAULT_RECONNECT_POLICY.delaysMs).toEqual([250, 500, 1000]);
  });

  it('three failed attempts wait 250, 500, 1000 ms, then error and closed', async () => {
    const clock = new FakeScheduler();
    const s = scripted(clock, (i) => i === 0);
    const provider = new ReconnectingDeepgramStt({
      apiKey: 'k',
      socket: s.factory,
      scheduler: clock,
    });
    const rec = record(provider);
    await provider.start(START);
    s.sockets[0]?.serverClose(1006);
    await flush();
    await clock.advance(250);
    await clock.advance(500);
    await clock.advance(1000);
    await rec.done;
    expect(s.times).toEqual([0, 250, 750, 1750]);
    expect(s.sockets).toHaveLength(4);
    const types = rec.events.map((e) => (e.type === 'state' ? e.state : e.type));
    expect(types).toEqual([
      'connecting',
      'open',
      'reconnecting',
      'reconnecting',
      'reconnecting',
      'error',
      'closed',
    ]);
    expect(provider.stats.counters.reconnects).toBe(3);
  });

  it('success on the second attempt resets the counters for the next outage', async () => {
    const clock = new FakeScheduler();
    // sockets: 0 opens, 1 fails, 2 opens, 3 fails, 4 fails, 5 fails
    const s = scripted(clock, (i) => i === 0 || i === 2);
    const provider = new ReconnectingDeepgramStt({
      apiKey: 'k',
      socket: s.factory,
      scheduler: clock,
    });
    const rec = record(provider);
    await provider.start(START);
    s.sockets[0]?.serverClose(1006);
    await flush();
    await clock.advance(250);
    await clock.advance(500);
    expect(s.times).toEqual([0, 250, 750]);
    const opens = rec.events.filter((e) => e.type === 'state' && e.state === 'open');
    expect(opens).toHaveLength(2);
    // Second outage starts from 250 ms again, not 1000.
    s.sockets[2]?.serverClose(1006);
    await flush();
    await clock.advance(250);
    expect(s.times).toEqual([0, 250, 750, 1000]);
    await provider.stop();
    await rec.done;
  });

  it('an auth close code does not reconnect', async () => {
    const { provider, sockets, clock } = make();
    const rec = record(provider);
    await provider.start(START);
    sockets[0]?.serverClose(1008);
    await clock.advance(5000);
    await rec.done;
    expect(sockets).toHaveLength(1);
    expect(rec.events).toContainEqual({ type: 'error', code: 'auth', retryable: false });
  });

  it('stop while waiting to reconnect cancels the attempt', async () => {
    const clock = new FakeScheduler();
    const s = scripted(clock, (i) => i === 0);
    const provider = new ReconnectingDeepgramStt({
      apiKey: 'k',
      socket: s.factory,
      scheduler: clock,
    });
    const rec = record(provider);
    await provider.start(START);
    s.sockets[0]?.serverClose(1006);
    await flush();
    await provider.stop();
    await clock.advance(5000);
    await rec.done;
    expect(s.sockets).toHaveLength(1);
    expect(rec.events[rec.events.length - 1]).toEqual({ type: 'state', state: 'closed' });
  });

  it('audio written during the outage is dropped and counted, then flows after reconnect', async () => {
    const clock = new FakeScheduler();
    const s = scripted(clock, (i) => i === 0 || i === 1);
    const provider = new ReconnectingDeepgramStt({
      apiKey: 'k',
      socket: s.factory,
      scheduler: clock,
    });
    await provider.start(START);
    s.sockets[0]?.serverClose(1006);
    await flush();
    const b = { seq: 1, tsMs: 0, flags: 0, pcm: new Int16Array(FRAME_SAMPLES) };
    provider.write(b);
    expect(provider.stats.counters.droppedBatches).toBe(1);
    await clock.advance(250);
    provider.write(b);
    expect(s.sockets[1]?.binaries).toHaveLength(1);
    await provider.stop();
  });
});
