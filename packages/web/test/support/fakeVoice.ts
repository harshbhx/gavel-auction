import { vi } from 'vitest';

/** A WebSocket the test drives by hand: it records what is sent and plays the server's side. */
export class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static get last(): FakeWebSocket | undefined {
    return FakeWebSocket.instances.at(-1);
  }
  readyState = 0;
  binaryType = 'blob';
  bufferedAmount = 0;
  sent: Array<string | Uint8Array> = [];
  closedWith: number | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }
  send(data: string | Uint8Array): void {
    this.sent.push(data);
  }
  close(code = 1000): void {
    if (this.readyState === 3) return;
    this.closedWith = code;
    this.readyState = 3;
    this.onclose?.({ code });
  }
  /** The server accepted the connection. */
  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }
  /** The server says something in JSON. */
  say(msg: unknown): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  /** The server closes the socket. */
  serverClose(code: number): void {
    this.readyState = 3;
    this.onclose?.({ code });
  }
  get binary(): Uint8Array[] {
    return this.sent.filter((m): m is Uint8Array => typeof m !== 'string');
  }
  get texts(): string[] {
    return this.sent.filter((m): m is string => typeof m === 'string');
  }
}

export interface FakeAudio {
  getUserMedia: ReturnType<typeof vi.fn>;
  stopTrack: ReturnType<typeof vi.fn>;
  closeContext: ReturnType<typeof vi.fn>;
  /** Ends the microphone track, as an unplugged device does. */
  endTrack(): void;
  /** Delivers one block of float samples from the worklet. */
  block(samples: Float32Array): void;
}

/** Installs a fake MediaStream, AudioContext, AudioWorkletNode and WebSocket. Undo with vi.unstubAllGlobals(). */
export function installFakeAudio(sampleRate = 16000): FakeAudio {
  FakeWebSocket.instances = [];
  const stopTrack = vi.fn();
  const closeContext = vi.fn(() => Promise.resolve());
  let ended: (() => void) | null = null;
  type Port = { onmessage: ((ev: { data: Float32Array }) => void) | null };
  const nodes: { last: { port: Port } | null } = { last: null };
  const track = {
    stop: stopTrack,
    addEventListener: (type: string, cb: () => void) => {
      if (type === 'ended') ended = cb;
    },
  };
  const getUserMedia = vi.fn(() => Promise.resolve({ getTracks: () => [track] }));

  class FakeAudioContext {
    sampleRate = sampleRate;
    state = 'running';
    audioWorklet = { addModule: vi.fn(() => Promise.resolve()) };
    createMediaStreamSource = vi.fn(() => ({ connect: vi.fn() }));
    close = closeContext;
  }
  class FakeWorkletNode {
    port: Port = { onmessage: null };
    constructor() {
      nodes.last = { port: this.port };
    }
  }
  vi.stubGlobal('AudioContext', FakeAudioContext);
  vi.stubGlobal('AudioWorkletNode', FakeWorkletNode);
  vi.stubGlobal('WebSocket', FakeWebSocket);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  });
  URL.createObjectURL = vi.fn(() => 'blob:fake');
  URL.revokeObjectURL = vi.fn();
  return {
    getUserMedia,
    stopTrack,
    closeContext,
    endTrack: () => ended?.(),
    block: (samples) => nodes.last?.port.onmessage?.({ data: samples }),
  };
}

/** A block of `n` samples with a steady value, for level and framing checks. */
export function tone(n: number, value = 0.2): Float32Array {
  return new Float32Array(n).fill(value);
}
