import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';
import type { PaymentsPort } from '@gavel/shared';

/** The part of the payments port the webhook route needs (R-RT-110). */
export type WebhookPort = Pick<PaymentsPort, 'handleWebhook'>;
export type WebhookResult = Awaited<ReturnType<PaymentsPort['handleWebhook']>>;

/** The auction service's webhook entry: raw bytes in, an HTTP status out. */
export interface ServiceWebhook {
  handleWebhook(rawBody: Buffer, headers: Record<string, string>): Promise<{ status: number }>;
}

export type RawBody = { ok: true; body: Buffer } | { ok: false; reason: 'too_large' };

export interface WebhookRouteDeps {
  /** Reads the request bytes. Defaults to reading all of them; the guard adds a size limit. */
  readBody?: (req: IncomingMessage) => Promise<RawBody>;
}

/** R-RT-111: ok and duplicate are 200, a bad signature is 400, retry is 503. */
export function statusFor(result: WebhookResult): 200 | 400 | 503 {
  switch (result.kind) {
    case 'ok':
    case 'duplicate':
      return 200;
    case 'invalid_signature':
      return 400;
    case 'retry':
      return 503;
  }
}

/** Header names are lower case in Node; a repeated header is joined the way HTTP defines it. */
export function flattenHeaders(raw: IncomingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    out[name] = Array.isArray(value) ? value.join(', ') : value;
  }
  return out;
}

/** Reads the body as bytes, untouched. With `maxBytes` it stops reading once the limit is passed. */
export async function readRawBody(
  req: IncomingMessage,
  maxBytes: number = Number.POSITIVE_INFINITY,
): Promise<RawBody> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : (chunk as Buffer);
    size += buf.length;
    if (size > maxBytes) {
      req.resume();
      return { ok: false, reason: 'too_large' };
    }
    chunks.push(buf);
  }
  return { ok: true, body: Buffer.concat(chunks) };
}

/** Adapts the auction service (status in, status out) to the port shape the route maps. */
export function portFromService(service: ServiceWebhook): WebhookPort {
  return {
    async handleWebhook(req) {
      const { status } = await service.handleWebhook(Buffer.from(req.rawBody), req.headers);
      if (status === 200) return { kind: 'ok' };
      if (status === 401) return { kind: 'invalid_signature' };
      return { kind: 'retry', reason: 'service_status_' + String(status) };
    },
  };
}

function send(res: ServerResponse, status: number): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(status === 200 ? '{"ok":true}' : '{"ok":false}');
}

/** `POST /webhooks/paypal`: raw bytes and headers go to the port unchanged; the result becomes a status. */
export function createWebhookRoute(
  port: WebhookPort,
  deps: WebhookRouteDeps = {},
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const readBody = deps.readBody ?? ((req: IncomingMessage) => readRawBody(req));
  return async (req, res) => {
    if (req.method !== 'POST') {
      res.setHeader('allow', 'POST');
      send(res, 405);
      return;
    }
    let status: number;
    try {
      const body = await readBody(req);
      if (!body.ok) {
        send(res, 413);
        return;
      }
      status = statusFor(
        await port.handleWebhook({ rawBody: body.body, headers: flattenHeaders(req.headers) }),
      );
    } catch {
      status = 503;
    }
    send(res, status);
  };
}
