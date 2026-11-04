import { describe, expect, it, vi } from 'vitest';
import {
  CaptureController,
  type CaptureContext,
  type CaptureEnv,
  type CaptureNode,
  type CaptureStream,
} from '../../src/browser/capture.js';
import { messageFor } from '../../src/browser/capture-state.js';

function fakeEnv(over: Partial<CaptureEnv> = {}) {
  const stop = vi.fn();
  const stream: CaptureStream = { getTracks: () => [{ stop, addEventListener: () => undefined }] };
  const node: CaptureNode = { port: { onmessage: null }, disconnect: () => undefined };
  const ctx: CaptureContext = {
    sampleRate: 16000,
    audioWorklet: { addModule: () => Promise.resolve() },
    createMediaStreamSource: () => ({ connect: () => undefined, disconnect: () => undefined }),
    resume: () => Promise.resolve(),
    close: () => Promise.resolve(),
  };
  const getUserMedia = vi.fn(() => Promise.resolve(stream));
  const env: CaptureEnv = {
    isSecureContext: true,
    getUserMedia,
    createContext: () => ctx,
    createNode: () => node,
    ...over,
  };
  return { env, getUserMedia, node };
}

describe('CaptureController', () => {
  it('T-VOX-001: requests the four constraint keys', async () => {
    const { env, getUserMedia } = fakeEnv();
    const c = new CaptureController({}, env);
    await c.start();
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    expect(c.current).toBe('running');
  });

  it('T-VOX-001: config overrides pass through', async () => {
    const { env, getUserMedia } = fakeEnv();
    await new CaptureController({ noiseSuppression: false }, env).start();
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: false,
        autoGainControl: true,
      },
    });
  });

  it('T-VOX-002: no AudioWorklet is unsupported with the section 7.1 message', async () => {
    const { env, getUserMedia } = fakeEnv({ createContext: null });
    const c = new CaptureController({}, env);
    const seen: string[] = [];
    c.onState((_s, m) => seen.push(m));
    await c.start();
    expect(c.current).toBe('unsupported');
    expect(seen).toContain('This browser cannot capture audio. Use manual entry.');
    expect(messageFor(c.current)).toBe('This browser cannot capture audio. Use manual entry.');
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('no mediaDevices is unsupported and insecure context is reported', async () => {
    const a = new CaptureController({}, fakeEnv({ getUserMedia: null }).env);
    await a.start();
    expect(a.current).toBe('unsupported');
    const b = new CaptureController({}, fakeEnv({ isSecureContext: false }).env);
    await b.start();
    expect(b.current).toBe('insecure_context');
  });

  it('permission errors map to denied and no_device', async () => {
    const denied = fakeEnv({
      getUserMedia: () =>
        Promise.reject(Object.assign(new Error('x'), { name: 'NotAllowedError' })),
    });
    const a = new CaptureController({}, denied.env);
    await a.start();
    expect(a.current).toBe('denied');
    const missing = fakeEnv({
      getUserMedia: () => Promise.reject(Object.assign(new Error('x'), { name: 'NotFoundError' })),
    });
    const b = new CaptureController({}, missing.env);
    await b.start();
    expect(b.current).toBe('no_device');
  });

  it('frames worklet blocks into batches and flushes on stop', async () => {
    const { env, node } = fakeEnv();
    const c = new CaptureController({}, env);
    const batches: number[] = [];
    c.onBatch((b) => batches.push(b.flags));
    await c.start();
    const block = new Float32Array(1024).fill(0.1);
    for (let i = 0; i < 2; i++) node.port.onmessage?.({ data: block });
    expect(batches).toEqual([0]);
    c.stop();
    expect(batches).toEqual([0, 4]);
    expect(c.current).toBe('idle');
  });
});
