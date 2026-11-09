import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  audioSocketUrl,
  openAudioSocket,
  problemForClose,
  type AudioFeed,
  type AudioProblem,
} from '../../src/audio/audioSocket';
import { FakeWebSocket } from '../support/fakeVoice';

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeWebSocket);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function open() {
  const feed: AudioFeed[] = [];
  const closes: Array<AudioProblem | null> = [];
  let ready = 0;
  const socket = openAudioSocket('ws://api.test/audio?auction=a&source=mic', 'tok-1', {
    onReady: () => {
      ready += 1;
    },
    onFeed: (m) => feed.push(m),
    onClose: (p) => closes.push(p),
  });
  const ws = FakeWebSocket.last as FakeWebSocket;
  return { socket, ws, feed, closes, ready: () => ready };
}

describe('audio socket url', () => {
  it('maps http to ws, https to wss, and never puts the token in the url', () => {
    expect(audioSocketUrl('http://localhost:8787/', 'room 1')).toBe(
      'ws://localhost:8787/audio?auction=room%201&source=mic',
    );
    expect(audioSocketUrl('https://api.example.com', 'r')).toBe(
      'wss://api.example.com/audio?auction=r&source=mic',
    );
  });
});

describe('audio socket', () => {
  it('sends the auth message first and audio only after ready', () => {
    const { socket, ws } = open();
    expect(ws.binaryType).toBe('arraybuffer');
    expect(socket.send(new Uint8Array(12))).toBe(false);
    ws.open();
    expect(ws.texts).toEqual([JSON.stringify({ t: 'auth', token: 'tok-1' })]);
    expect(socket.send(new Uint8Array(12))).toBe(false);
    ws.say({ t: 'ready' });
    expect(socket.ready).toBe(true);
    expect(socket.send(new Uint8Array(12))).toBe(true);
    expect(ws.binary).toHaveLength(1);
  });

  it('reports ready once and passes captions, status and expired confirms on', () => {
    const { ws, feed, ready } = open();
    ws.open();
    ws.say({ t: 'ready' });
    ws.say({ t: 'ready' });
    ws.say({ t: 'caption', text: 'paddle three', final: false });
    ws.say({ t: 'status', stt: 'degraded', llm: 'ok' });
    ws.say({ t: 'confirm_expired', promptId: 'p1' });
    ws.say({ t: 'mystery' });
    ws.onmessage?.({ data: 'not json' });
    ws.onmessage?.({ data: new ArrayBuffer(2) });
    expect(ready()).toBe(1);
    expect(feed).toEqual([
      { t: 'caption', text: 'paddle three', final: false },
      { t: 'status', stt: 'degraded', llm: 'ok' },
      { t: 'confirm_expired', promptId: 'p1' },
    ]);
  });

  it('drops audio instead of queueing it when the link is backed up', () => {
    const { socket, ws } = open();
    ws.open();
    ws.say({ t: 'ready' });
    ws.bufferedAmount = 70_000;
    expect(socket.send(new Uint8Array(12))).toBe(false);
    ws.bufferedAmount = 0;
    expect(socket.send(new Uint8Array(12))).toBe(true);
  });

  it.each([
    [4401, 'unauthorized'],
    [1008, 'badFrame'],
    [4429, 'rate'],
    [4408, 'ended'],
    [4409, 'streamBusy'],
    [4404, 'notFound'],
    [1011, 'server'],
    [1006, 'lost'],
  ] as const)('names close code %i', (code, problem) => {
    expect(problemForClose(code)).toBe(problem);
    const { ws, closes } = open();
    ws.open();
    ws.serverClose(code);
    expect(closes).toEqual([problem]);
  });

  it('closes quietly when this side ends it, once', () => {
    const { socket, ws, closes } = open();
    ws.open();
    ws.say({ t: 'ready' });
    socket.close();
    socket.close();
    expect(ws.closedWith).toBe(1000);
    expect(closes).toEqual([null]);
    expect(socket.ready).toBe(false);
  });
});
