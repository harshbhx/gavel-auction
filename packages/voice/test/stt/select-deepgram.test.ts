import { describe, expect, it } from 'vitest';
import type { WsFactory, WsLike } from '../../src/stt/deepgram.js';
import { SttConfigError, selectProvider } from '../../src/stt/select.js';

const socket: WsFactory = () => {
  const ws: WsLike = {
    bufferedAmount: 0,
    send: () => undefined,
    close: () => undefined,
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
  };
  return ws;
};

describe('deepgram in the provider selection (R-VOX-014)', () => {
  it('builds the reconnecting provider when the key and a socket are given', () => {
    const named = selectProvider({ VOICE_STT: 'deepgram', DEEPGRAM_API_KEY: 'k' }, { socket });
    expect(named.name).toBe('deepgram');
    const dflt = selectProvider({ DEEPGRAM_API_KEY: 'k' }, { socket });
    expect(dflt.name).toBe('deepgram');
  });

  it('stays unavailable without a socket, as before', () => {
    expect(() => selectProvider({ VOICE_STT: 'deepgram', DEEPGRAM_API_KEY: 'k' })).toThrow(
      SttConfigError,
    );
  });
});
