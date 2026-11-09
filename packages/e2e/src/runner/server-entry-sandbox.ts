import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { HoldRecord } from '@gavel/payments';
import type { AuctionService, AuctionServiceDeps } from '@gavel/server';
import { adminKeyMatches } from '@gavel/server/src/http/ops';
import type { AuctionId, BidderId } from '@gavel/shared';

/**
 * Server entry for stack runs against the real PayPal sandbox (PAYMENTS=sandbox). It boots the
 * same composition as src/main.ts and adds one test-only route, POST /__e2e/enrol-sandbox (admin
 * key). The product registers a bidder through the web SDK popup, which needs a browser on the
 * hold order the server created; this harness approves a sandbox order of its own instead, so
 * the route takes an order and authorization that already exist at PayPal (created and approved
 * by the harness, authorized, id and authorization id passed in), writes the hold as HELD in the
 * server's hold store and registers the bidder in the room. Everything after that is the real
 * server: bids, hammer, settlement saga, PayPal capture and void calls, ledger and journal.
 * The route refuses to exist in production.
 */

const ENROL_PATH = '/__e2e/enrol-sandbox';
const MAX_BODY_BYTES = 65_536;

interface EnrolBody {
  auctionId: string;
  bidderId: string;
  name: string;
  ceilingCents: number;
  orderId: string;
  authId: string;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(text),
  });
  res.end(text);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > MAX_BODY_BYTES) throw new Error('request too large');
    chunks.push(buf);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

function isEnrolBody(v: unknown): v is EnrolBody {
  if (typeof v !== 'object' || v === null) return false;
  const b = v as Record<string, unknown>;
  return (
    typeof b['auctionId'] === 'string' &&
    typeof b['bidderId'] === 'string' &&
    typeof b['name'] === 'string' &&
    typeof b['ceilingCents'] === 'number' &&
    typeof b['orderId'] === 'string' &&
    typeof b['authId'] === 'string'
  );
}

async function main(): Promise<void> {
  if (process.env['NODE_ENV'] === 'production') throw new Error('refused in production');
  if (process.env['PAYMENTS'] !== 'sandbox') throw new Error('PAYMENTS must be sandbox');
  const adminKey = process.env['ADMIN_KEY'] ?? '';
  if (adminKey === '') throw new Error('ADMIN_KEY is required');

  const { composeServer } = await import('@gavel/server/src/boot/compose');
  const app = await composeServer(process.env, {
    extraRoutes: (service: AuctionService) => async (req, res) => {
      const path = (req.url ?? '').split('?')[0];
      if (path !== ENROL_PATH) return false;
      if (req.method !== 'POST' || !adminKeyMatches(req, adminKey)) {
        send(res, 401, { error: 'unauthorized' });
        return true;
      }
      try {
        const body = await readJson(req);
        if (!isEnrolBody(body)) {
          send(res, 400, { error: 'bad_request' });
          return true;
        }
        const deps = (service as unknown as { deps: AuctionServiceDeps }).deps;
        const record: HoldRecord = {
          holdId: `HOLD-${randomUUID()}`,
          auctionId: body.auctionId,
          bidderId: body.bidderId,
          orderId: body.orderId,
          authId: body.authId,
          ceilingCents: body.ceilingCents,
          status: 'HELD',
          createdAtMs: deps.clock.now(),
        };
        await deps.holds.put(record);
        await service.registerBidder({
          auctionId: body.auctionId as AuctionId,
          bidderId: body.bidderId as BidderId,
          name: body.name,
          holdId: record.holdId,
        });
        send(res, 200, { holdId: record.holdId });
      } catch (e) {
        send(res, 500, { error: e instanceof Error ? e.message : String(e) });
      }
      return true;
    },
  });
  const listening = await app.listen();
  process.stdout.write(`${JSON.stringify({ msg: 'listening', port: listening })}\n`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
