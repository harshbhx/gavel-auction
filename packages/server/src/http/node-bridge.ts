import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import type { ExtraRoutes } from '../boot/compose';
import type { HttpApp } from './app';

/** Paths the auction HTTP app owns. Everything else is left to the other routes. */
const API_PREFIX = '/api/';

/**
 * Adapts the fetch-style auction app to the node http host: builds a Request from the incoming
 * message, runs the app and writes its Response back. Returns false for paths outside `/api/`.
 */
export function nodeRoutesFor(app: HttpApp, origin: string): ExtraRoutes {
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const target = req.url ?? '/';
    if (!(target.split('?')[0] ?? '').startsWith(API_PREFIX)) return false;
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (value === undefined) continue;
      headers.set(name, Array.isArray(value) ? value.join(', ') : value);
    }
    const method = req.method ?? 'GET';
    const hasBody = method !== 'GET' && method !== 'HEAD';
    const init: RequestInit & { duplex?: 'half' } = { method, headers };
    if (hasBody) {
      init.body = Readable.toWeb(req) as WebReadableStream as unknown as NonNullable<
        RequestInit['body']
      >;
      init.duplex = 'half';
    }
    const out = await app.fetch(new Request(new URL(target, origin), init));
    const outHeaders: Record<string, string> = {};
    out.headers.forEach((value, name) => {
      outHeaders[name] = value;
    });
    res.writeHead(out.status, outHeaders);
    res.end(Buffer.from(await out.arrayBuffer()));
    return true;
  };
}
