import type { IncomingMessage, ServerResponse } from 'node:http';
import type { WebhookOutcome } from '../ops/metrics';
import {
  createWebhookRoute,
  readRawBody,
  type RawBody,
  type WebhookPort,
  type WebhookResult,
} from './webhook';

/** R-RT-112: the largest webhook body accepted. */
export const WEBHOOK_MAX_BYTES = 256 * 1024;

type LogFields = Record<string, string | number | boolean>;

/** Only an event id and an outcome are ever logged: never a body or a header. */
export interface WebhookLog {
  info(message: string, fields: LogFields): void;
  warn(message: string, fields: LogFields): void;
}

export interface WebhookGuardDeps {
  log: WebhookLog;
  /** True when the auction exists. Without it every auction id is taken as known. */
  knownAuction?: (auctionId: string) => Promise<boolean>;
  maxBytes?: number;
  /** Reverse proxies in front of the host, so the source is the client address (R12-S03). */
  trustedProxyHops?: number;
  /** Counts every outcome, including too_large (R-RT-122, R-RT-135). */
  metrics?: { webhookOutcome(outcome: WebhookOutcome): void };
}

const MAX_ID_CHARS = 64;

/** The event id for the log line, or "unknown"; nothing else from the body. */
function eventIdOf(rawBody: Uint8Array): string {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(rawBody).toString('utf8'));
    if (parsed !== null && typeof parsed === 'object') {
      const id = (parsed as Record<string, unknown>)['id'];
      if (typeof id === 'string' && /^[A-Za-z0-9_.-]+$/.test(id)) return id.slice(0, MAX_ID_CHARS);
    }
  } catch {
    // Not JSON: the verifier decides what to do with it.
  }
  return 'unknown';
}

/**
 * Wraps the port: logs event id and outcome, and answers ok for an event about an
 * auction we do not have so the sender stops retrying (R-RT-114).
 */
export function guardWebhookPort(port: WebhookPort, deps: WebhookGuardDeps): WebhookPort {
  return {
    async handleWebhook(req) {
      const eventId = eventIdOf(req.rawBody);
      let result: WebhookResult;
      try {
        result = await port.handleWebhook(req);
      } catch (err) {
        deps.log.warn('webhook failed', { eventId, outcome: 'error' });
        deps.metrics?.webhookOutcome('retry');
        throw err;
      }
      if (result.kind === 'retry' && result.reason === 'unknown_auction') {
        deps.log.warn('webhook for unknown auction', { eventId, outcome: 'unknown_auction' });
        deps.metrics?.webhookOutcome('ok');
        return { kind: 'ok' };
      }
      if (result.kind === 'ok' && result.auctionId !== undefined && deps.knownAuction) {
        if (!(await deps.knownAuction(result.auctionId))) {
          deps.log.warn('webhook for unknown auction', {
            eventId,
            outcome: 'unknown_auction',
            auctionId: result.auctionId,
          });
          deps.metrics?.webhookOutcome('ok');
          return { kind: 'ok' };
        }
      }
      deps.log.info('webhook handled', { eventId, outcome: result.kind });
      deps.metrics?.webhookOutcome(result.kind);
      return result;
    },
  };
}

/** The webhook route with the body limit and the guarded port. */
export function createGuardedWebhookRoute(
  port: WebhookPort,
  deps: WebhookGuardDeps,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const max = deps.maxBytes ?? WEBHOOK_MAX_BYTES;
  return createWebhookRoute(guardWebhookPort(port, deps), {
    ...(deps.trustedProxyHops !== undefined ? { trustedProxyHops: deps.trustedProxyHops } : {}),
    readBody: async (req: IncomingMessage): Promise<RawBody> => {
      const declared = Number(req.headers['content-length']);
      const body: RawBody =
        Number.isFinite(declared) && declared > max
          ? { ok: false, reason: 'too_large' }
          : await readRawBody(req, max);
      if (!body.ok) {
        req.resume();
        deps.log.warn('webhook body too large', { outcome: 'too_large' });
        deps.metrics?.webhookOutcome('too_large');
      }
      return body;
    },
  });
}
