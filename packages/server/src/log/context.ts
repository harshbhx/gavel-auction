import type { IncomingMessage } from 'node:http';
import type { Logger } from '@gavel/shared';

/** Log context propagation (R-RT-133): reqId, connId, auctionId and seq where applicable. */

export interface LogContext {
  reqId?: string;
  connId?: string;
  auctionId?: string;
  seq?: number;
}

export const REQUEST_ID_HEADER = 'x-request-id';

const SAFE_REQ_ID = /^[A-Za-z0-9._-]{1,64}$/;

/** Keep only the fields that are set, so absent context never logs as undefined. */
function pick(ctx: LogContext): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  if (ctx.reqId !== undefined) out.reqId = ctx.reqId;
  if (ctx.connId !== undefined) out.connId = ctx.connId;
  if (ctx.auctionId !== undefined) out.auctionId = ctx.auctionId;
  if (ctx.seq !== undefined) out.seq = ctx.seq;
  return out;
}

/** Child logger that stamps every line with the given context. */
export function withLogContext(base: Logger, ctx: LogContext): Logger {
  return base.child(pick(ctx));
}

/** Use the caller's request id when it is well formed, otherwise mint one. */
export function requestIdFrom(req: IncomingMessage, mint: () => string): string {
  const raw = req.headers[REQUEST_ID_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value !== undefined && SAFE_REQ_ID.test(value) ? value : mint();
}

/** Request id helper for HTTP handlers: returns the id and a logger bound to it. */
export function requestContext(
  base: Logger,
  req: IncomingMessage,
  mint: () => string,
): { reqId: string; log: Logger } {
  const reqId = requestIdFrom(req, mint);
  return { reqId, log: withLogContext(base, { reqId }) };
}
