import type { WsFactory, WsLike } from '@gavel/voice';

/** The slice of the platform WebSocket the Deepgram provider drives. */
type PlatformSocket = WsLike & { binaryType: string };
type PlatformSocketCtor = new (url: string, protocols: string[]) => PlatformSocket;

/**
 * Socket factory over the runtime's WebSocket (Node 22). The credential travels as the
 * `['token', key]` sub-protocol pair the provider passes in, so no header support is needed.
 * Returns undefined when the runtime has no WebSocket, so Deepgram is simply not offered.
 */
export function platformSocketFactory(): WsFactory | undefined {
  const ctor = (globalThis as { WebSocket?: PlatformSocketCtor }).WebSocket;
  if (ctor === undefined) return undefined;
  return (url, protocols) => {
    const ws = new ctor(url, protocols);
    ws.binaryType = 'arraybuffer';
    return ws;
  };
}
