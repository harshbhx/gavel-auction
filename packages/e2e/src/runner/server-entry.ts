import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { HoldService } from '@gavel/payments';
import { FakePayPalServer } from '@gavel/payments/fake';
import type { AuctionServiceDeps, AuctionService } from '@gavel/server';
import { adminKeyMatches } from '@gavel/server/src/http/ops';
import type { AuctionId, BidderId } from '@gavel/shared';

/**
 * Server entry for stack runs whose fake PayPal is a separate process (see fake-process.ts).
 * It boots the same composition as src/main.ts with two differences, both test-only:
 *
 *  - the fake PayPal adapter the composition builds is pointed at the process named by
 *    GAVEL_E2E_FAKE_URL instead of listening in this process, so a SIGKILL of this process
 *    leaves the fake and its state alone;
 *  - POST /__e2e/enrol (admin key) creates a hold, approves it at the fake, registers the bidder
 *    and answers the hold and authorization ids, because the product has no HTTP route that
 *    registers a bidder with a hold yet.
 */

const ENROL_PATH = '/__e2e/enrol';
const MAX_BODY_BYTES = 65_536;

interface EnrolBody {
  auctionId: string;
  bidderId: string;
  name: string;
  ceilingCents: number;
  presetsCents: number[];
}

function need(name: string): string {
  const v = process.env[name];
  if (v === undefined || v === '') throw new Error(`${name} is required`);
  return v;
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
    Array.isArray(b['presetsCents'])
  );
}

/** The fake PayPal adapter talks to the external process; nothing listens in this one. */
function pointFakeAtExternalProcess(url: string): void {
  const proto = FakePayPalServer.prototype as unknown as {
    start(this: { baseUrl?: string }): Promise<void>;
    stop(): Promise<void>;
  };
  proto.start = function start(this: { baseUrl?: string }): Promise<void> {
    this.baseUrl = url;
    return Promise.resolve();
  };
  proto.stop = (): Promise<void> => Promise.resolve();
}

async function main(): Promise<void> {
  const fakeUrl = need('GAVEL_E2E_FAKE_URL');
  const controlUrl = need('GAVEL_E2E_FAKE_CONTROL_URL');
  const adminKey = need('ADMIN_KEY');
  pointFakeAtExternalProcess(fakeUrl);

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
        // The service keeps its dependencies; the hold service needs the same gateway and store.
        const deps = (service as unknown as { deps: AuctionServiceDeps }).deps;
        const holdsApi = new HoldService({
          gateway: deps.gateway,
          holds: deps.holds,
          audit: deps.audit,
          clock: { nowMs: (): number => deps.clock.now() },
          maxCeilingCents: Number.MAX_SAFE_INTEGER,
          newId: () => `HOLD-${randomUUID()}`,
        });
        const auctionId = body.auctionId as AuctionId;
        const bidderId = body.bidderId as BidderId;
        const created = await holdsApi.createHoldOrder({
          auctionId,
          bidderId,
          ceilingCents: body.ceilingCents,
          presetsCents: body.presetsCents,
        });
        const approved = await fetch(
          `${controlUrl}/__fake/approve/${encodeURIComponent(created.orderId)}`,
          { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
        );
        if (!approved.ok) throw new Error(`fake approve answered ${approved.status}`);
        await holdsApi.completeApproval({ holdId: created.holdId, orderId: created.orderId });
        await service.registerBidder({
          auctionId,
          bidderId,
          name: body.name,
          holdId: created.holdId,
        });
        const hold = await deps.holds.get(created.holdId);
        send(res, 200, { holdId: created.holdId, authId: hold?.authId ?? null });
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
