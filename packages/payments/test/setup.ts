// Unit tests must not reach the network (R-PAY-151). Any socket connection to a
// non-loopback host fails the test; loopback is allowed for the fake server.
import net from 'node:net';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '::ffff:127.0.0.1']);

function hostOf(args: unknown[]): string | undefined {
  const first = args[0];
  if (typeof first === 'object' && first !== null) {
    const o = first as { host?: unknown; path?: unknown };
    if (typeof o.path === 'string') return '127.0.0.1';
    return typeof o.host === 'string' ? o.host : 'localhost';
  }
  if (typeof first === 'number' || (typeof first === 'string' && /^\d+$/.test(first))) {
    return typeof args[1] === 'string' ? args[1] : 'localhost';
  }
  return undefined;
}

const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function patchedConnect(this: net.Socket, ...args: unknown[]) {
  const host = hostOf(args);
  if (host !== undefined && !LOOPBACK.has(host)) {
    throw new Error(`network access forbidden in unit tests: ${host}`);
  }
  return (originalConnect as (...a: unknown[]) => net.Socket).apply(this, args);
} as typeof net.Socket.prototype.connect;
