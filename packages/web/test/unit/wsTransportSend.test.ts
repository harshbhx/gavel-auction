import { Cents } from '@gavel/shared';
import { describe, expect, it } from 'vitest';
import { WebSocketTransport, type SocketLike } from '../../src/net/wsTransport';
import { msgId } from '../../src/testing/builders';

function fakeSocket(readyState: number): SocketLike & { frames: string[] } {
  const frames: string[] = [];
  return {
    readyState,
    onopen: null,
    onclose: null,
    onerror: null,
    onmessage: null,
    frames,
    send: (data) => {
      frames.push(data);
    },
    close: () => undefined,
  };
}

const bid = { v: 1, t: 'bid', mid: msgId(1), amount: Cents(5000), source: 'qr' } as const;

describe('WebSocketTransport.send result (#1657)', () => {
  it('says false when the socket is not open and true when the frame went out', () => {
    const closed = fakeSocket(3);
    const closedTransport = new WebSocketTransport('ws://x', () => closed);
    expect(closedTransport.send(bid)).toBe(false);
    closedTransport.connect();
    expect(closedTransport.send(bid)).toBe(false);
    expect(closed.frames).toEqual([]);

    const open = fakeSocket(1);
    const openTransport = new WebSocketTransport('ws://x', () => open);
    openTransport.connect();
    expect(openTransport.send(bid)).toBe(true);
    expect(open.frames).toHaveLength(1);
  });
});
