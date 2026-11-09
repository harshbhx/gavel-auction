import { describe, expect, it } from 'vitest';
import { WebSocketTransport, type SocketLike } from '../../src/net/wsTransport';

function socket(): SocketLike {
  return {
    readyState: 1,
    onopen: null,
    onclose: null,
    onerror: null,
    onmessage: null,
    send: () => {},
    close: () => {},
  };
}

describe('WebSocketTransport close code (#2231)', () => {
  it('keeps the code of the socket that closed, and clears it on the next connect', () => {
    const s = socket();
    const transport = new WebSocketTransport('ws://x/ws', () => s);
    transport.connect();
    s.onopen?.();
    s.onclose?.({ code: 4011 });
    expect(transport.lastCloseCode).toBe(4011);
    transport.connect();
    expect(transport.lastCloseCode).toBeNull();
  });

  it('has no code after an error event', () => {
    const s = socket();
    const transport = new WebSocketTransport('ws://x/ws', () => s);
    transport.connect();
    s.onerror?.();
    expect(transport.lastCloseCode).toBeNull();
  });
});
