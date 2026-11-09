import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BATCH_SAMPLES, HEADER_BYTES } from '../../src/audio/frame';
import {
  IDLE_DISARM_MS,
  KEEPALIVE_MS,
  MAX_HOLD_MS,
  MAX_SESSION_MS,
  SILENCE_CUTOFF_MS,
  VoiceController,
  type VoiceState,
} from '../../src/audio/voiceController';
import { FakeWebSocket, installFakeAudio, tone, type FakeAudio } from '../support/fakeVoice';

let audio: FakeAudio;
let latest: VoiceState;
const made: VoiceController[] = [];

beforeEach(() => {
  // The level meter reads performance.now, so it moves with the fake clock.
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'],
  });
  audio = installFakeAudio();
});
afterEach(() => {
  for (const c of made.splice(0)) c.dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function make(): VoiceController {
  const c = new VoiceController({
    apiBase: 'http://api.test',
    roomId: 'room-1',
    token: 'tok-1',
    onChange: (s) => {
      latest = s;
    },
  });
  c.attach();
  made.push(c);
  return c;
}

/** Runs the start-up: the microphone is granted and the server says ready. */
async function ready(): Promise<FakeWebSocket> {
  await vi.advanceTimersByTimeAsync(0);
  const ws = FakeWebSocket.last as FakeWebSocket;
  ws.open();
  ws.say({ t: 'ready' });
  await vi.advanceTimersByTimeAsync(0);
  return ws;
}

/** One full batch of speech: 1600 samples at a level above the speech line. */
function speak(): void {
  audio.block(tone(BATCH_SAMPLES, 0.2));
}

describe('voice controller: tap mode', () => {
  it('asks for the microphone only when started, then streams after ready', async () => {
    const c = make();
    expect(audio.getUserMedia).not.toHaveBeenCalled();
    expect(FakeWebSocket.instances).toHaveLength(0);
    c.toggle();
    expect(latest.phase).toBe('asking');
    const ws = await ready();
    expect(latest.phase).toBe('ready');
    expect(latest.talking).toBe(true);
    expect(ws.url).toBe('ws://api.test/audio?auction=room-1&source=mic');
    expect(ws.texts).toEqual([JSON.stringify({ t: 'auth', token: 'tok-1' })]);
    speak();
    expect(ws.binary).toHaveLength(1);
    const first = ws.binary[0] as Uint8Array;
    expect(first.length).toBe(HEADER_BYTES + BATCH_SAMPLES * 2);
    expect(first[0]).toBe(0x56);
    speak();
    expect(new DataView((ws.binary[1] as Uint8Array).buffer).getUint32(4, true)).toBe(1);
    c.dispose();
  });

  it('sends nothing before the host says ready', async () => {
    const c = make();
    c.toggle();
    await vi.advanceTimersByTimeAsync(0);
    const ws = FakeWebSocket.last as FakeWebSocket;
    ws.open();
    speak();
    expect(ws.binary).toHaveLength(0);
    expect(latest.phase).toBe('connecting');
    c.dispose();
  });

  it('shows captions and the speech service status from the host', async () => {
    const c = make();
    c.toggle();
    const ws = await ready();
    ws.say({ t: 'caption', text: 'paddle three two hundred', final: false });
    expect(latest.caption).toEqual({ text: 'paddle three two hundred', final: false });
    ws.say({ t: 'caption', text: 'paddle three two hundred', final: true });
    expect(latest.caption?.final).toBe(true);
    ws.say({ t: 'status', stt: 'down', llm: 'off' });
    expect(latest.stt).toBe('down');
    ws.say({ t: 'confirm_expired', promptId: 'p' });
    expect(latest.note).toBe('confirmExpired');
    c.dispose();
  });

  it('publishes the input level and counts speech', async () => {
    const c = make();
    c.toggle();
    await ready();
    audio.block(tone(320, 0.2));
    expect(latest.level).toBeCloseTo(0.2, 2);
    c.dispose();
  });

  it('stops after the silence cutoff and says why', async () => {
    const c = make();
    c.toggle();
    const ws = await ready();
    await vi.advanceTimersByTimeAsync(SILENCE_CUTOFF_MS + 600);
    expect(latest.phase).toBe('off');
    expect(latest.problem).toBe('silence');
    expect(audio.stopTrack).toHaveBeenCalled();
    expect(ws.closedWith).toBe(1000);
  });

  it('keeps going while someone speaks', async () => {
    const c = make();
    c.toggle();
    await ready();
    for (let i = 0; i < 6; i += 1) {
      await vi.advanceTimersByTimeAsync(SILENCE_CUTOFF_MS / 2);
      audio.block(tone(320, 0.2));
    }
    expect(latest.phase).toBe('ready');
    c.dispose();
  });

  it('ends the session at the longest allowed time', async () => {
    const c = make();
    c.toggle();
    await ready();
    const steps = Math.ceil(MAX_SESSION_MS / 10_000);
    for (let i = 0; i < steps + 1; i += 1) {
      await vi.advanceTimersByTimeAsync(10_000);
      audio.block(tone(320, 0.2));
    }
    expect(latest.problem).toBe('maxSession');
    expect(latest.phase).toBe('off');
  });

  it('releases the microphone and socket on a plain stop, after the held audio is sent', async () => {
    const c = make();
    c.toggle();
    const ws = await ready();
    audio.block(tone(400, 0.2));
    c.toggle();
    expect(latest.phase).toBe('off');
    expect(latest.problem).toBeNull();
    expect(audio.stopTrack).toHaveBeenCalled();
    expect(audio.closeContext).toHaveBeenCalled();
    expect(ws.closedWith).toBe(1000);
    // The partial batch went out padded, with the end-of-stream flag.
    const last = ws.binary.at(-1) as Uint8Array;
    expect((last[2] ?? 0) & 4).toBe(4);
  });

  it('releases everything when the tab is hidden', async () => {
    const c = make();
    c.toggle();
    await ready();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    expect(latest.problem).toBe('hidden');
    expect(audio.stopTrack).toHaveBeenCalled();
  });

  it('releases everything on dispose', async () => {
    const c = make();
    c.toggle();
    const ws = await ready();
    c.dispose();
    expect(audio.stopTrack).toHaveBeenCalled();
    expect(ws.closedWith).toBe(1000);
  });
});

describe('voice controller: refusals', () => {
  it('reports a refused permission and closes the socket', async () => {
    audio.getUserMedia.mockRejectedValueOnce(new DOMException('no', 'NotAllowedError'));
    const c = make();
    c.toggle();
    await vi.advanceTimersByTimeAsync(0);
    expect(latest.phase).toBe('off');
    expect(latest.problem).toBe('denied');
    expect((FakeWebSocket.last as FakeWebSocket).closedWith).toBe(1000);
  });

  it('reports no microphone, and a microphone another app holds', async () => {
    audio.getUserMedia.mockRejectedValueOnce(new DOMException('none', 'NotFoundError'));
    const c = make();
    c.toggle();
    await vi.advanceTimersByTimeAsync(0);
    expect(latest.problem).toBe('nomic');
    audio.getUserMedia.mockRejectedValueOnce(new DOMException('held', 'NotReadableError'));
    c.toggle();
    await vi.advanceTimersByTimeAsync(0);
    expect(latest.problem).toBe('busy');
  });

  it('reports a browser without the audio APIs, without opening a socket', () => {
    vi.stubGlobal('AudioWorkletNode', undefined);
    FakeWebSocket.instances = [];
    const c = make();
    c.toggle();
    expect(latest.problem).toBe('unsupported');
    expect(latest.phase).toBe('off');
    expect(audio.getUserMedia).not.toHaveBeenCalled();
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it('reports a page that is not secure', () => {
    vi.stubGlobal('isSecureContext', false);
    const c = make();
    c.toggle();
    expect(latest.problem).toBe('insecure');
  });

  it('says so when the device is unplugged while listening', async () => {
    const c = make();
    c.toggle();
    await ready();
    audio.endTrack();
    expect(latest.problem).toBe('nomic');
    expect(latest.phase).toBe('off');
  });

  it.each([
    [4401, 'unauthorized'],
    [4409, 'streamBusy'],
    [4408, 'ended'],
    [4429, 'rate'],
  ] as const)('stops with a plain problem when the host closes with %i', async (code, problem) => {
    const c = make();
    c.toggle();
    const ws = await ready();
    ws.serverClose(code);
    expect(latest.problem).toBe(problem);
    expect(latest.phase).toBe('off');
    expect(audio.stopTrack).toHaveBeenCalled();
  });

  it('stops with "lost" when the connection drops before ready', async () => {
    const c = make();
    c.toggle();
    await vi.advanceTimersByTimeAsync(0);
    (FakeWebSocket.last as FakeWebSocket).serverClose(1006);
    expect(latest.problem).toBe('lost');
    expect(audio.stopTrack).toHaveBeenCalled();
  });

  it('does not open a second stream while one is running', async () => {
    const c = make();
    c.toggle();
    await ready();
    c.press();
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(audio.getUserMedia).toHaveBeenCalledTimes(1);
    c.dispose();
  });
});

describe('voice controller: hold mode', () => {
  it('sends audio only while held, then ends the utterance', async () => {
    const c = make();
    c.setMode('hold');
    c.press();
    const ws = await ready();
    expect(latest.talking).toBe(true);
    speak();
    expect(ws.binary).toHaveLength(1);
    audio.block(tone(400, 0.2));
    c.release();
    expect(latest.talking).toBe(false);
    // The held part went out padded, then a keepalive that ends the utterance.
    const flush = ws.binary.at(-2) as Uint8Array;
    const eou = ws.binary.at(-1) as Uint8Array;
    expect(flush.length).toBe(HEADER_BYTES + BATCH_SAMPLES * 2);
    expect(eou.length).toBe(HEADER_BYTES);
    expect(eou[2]).toBe(2 | 8);
    const count = ws.binary.length;
    speak();
    expect(ws.binary).toHaveLength(count);
    c.dispose();
  });

  it('flags a gap when talking starts again', async () => {
    const c = make();
    c.setMode('hold');
    c.press();
    const ws = await ready();
    c.release();
    c.press();
    speak();
    const msg = ws.binary.at(-1) as Uint8Array;
    expect((msg[2] ?? 0) & 1).toBe(1);
    c.dispose();
  });

  it('sends a keepalive while armed and silent, and frees the microphone when idle', async () => {
    const c = make();
    c.setMode('hold');
    c.press();
    const ws = await ready();
    c.release();
    const before = ws.binary.length;
    await vi.advanceTimersByTimeAsync(KEEPALIVE_MS + 600);
    const added = ws.binary.slice(before);
    expect(added.length).toBeGreaterThan(0);
    expect(added.every((m) => m.length === HEADER_BYTES && m[2] === 2)).toBe(true);
    await vi.advanceTimersByTimeAsync(IDLE_DISARM_MS);
    expect(latest.phase).toBe('off');
    expect(latest.problem).toBe('idle');
  });

  it('cuts a clip held past the longest allowed time', async () => {
    const c = make();
    c.setMode('hold');
    c.press();
    await ready();
    await vi.advanceTimersByTimeAsync(MAX_HOLD_MS + 600);
    expect(latest.talking).toBe(false);
    expect(latest.note).toBe('maxClip');
    expect(latest.phase).toBe('ready');
    c.dispose();
  });

  it('lets go when the window loses focus mid-press', async () => {
    const c = make();
    c.setMode('hold');
    c.press();
    await ready();
    window.dispatchEvent(new Event('blur'));
    expect(latest.talking).toBe(false);
    c.dispose();
  });

  it('ignores press in tap mode and toggle in hold mode', () => {
    const c = make();
    c.press();
    expect(FakeWebSocket.instances).toHaveLength(0);
    c.setMode('hold');
    c.toggle();
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it('stops a running session when the mode changes', async () => {
    const c = make();
    c.toggle();
    await ready();
    c.setMode('hold');
    expect(latest.phase).toBe('off');
    expect(audio.stopTrack).toHaveBeenCalled();
  });
});
