import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { DEFAULT_FAKE_WEBHOOK_ID } from '@gavel/payments/fake';
import { WebhookEmitter } from '../../../payments/src/fake/webhooks';
import { createGuardedWebhookRoute } from '@gavel/server/src/http/webhook-guard';
import { portFromService } from '@gavel/server/src/http/webhook';
import { makeRig } from '../../test/flow/rig';
import type { Check } from './run';

// L4 webhook storm (R-QA-030, T-QA-063): one signed PayPal event delivered many times at once, as
// PayPal does when it retries. Every delivery is answered without a server error and exactly one
// event is stored. The real staging host cannot be used for this: a delivery there must carry a
// signature PayPal made, so the storm runs against the real webhook route in process, signed with
// the fake verifier key.
// Run it with src/load/cli.ts.

export const STORM_DELIVERIES = 50;

export interface StormReport {
  scenario: 'L4';
  deliveries: number;
  statuses: Record<string, number>;
  stored: number;
  checks: Check[];
  ok: boolean;
}

const quietLog = { info: () => undefined, warn: () => undefined };

export async function runL4(deliveries: number = STORM_DELIVERIES): Promise<StormReport> {
  const rig = await makeRig();
  const route = createGuardedWebhookRoute(portFromService(rig.service()), { log: quietLog });
  const server: Server = createServer((req, res) => void route(req, res));
  try {
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
    const order = rig.paypal.core.createOrder(
      { holdId: 'hold-storm', amountCents: 5000, description: 'sandbox' },
      'req-storm',
    );
    rig.paypal.core.approveOrder(order.id);
    const event = rig.paypal.core.events.at(-1);
    if (event === undefined) throw new Error('no event emitted');
    const emitter = new WebhookEmitter({
      webhookId: DEFAULT_FAKE_WEBHOOK_ID,
      nowMs: () => rig.paypal.core.clock.nowMs(),
    });
    const signed = emitter.sign(event);
    const codes = await Promise.all(
      Array.from({ length: deliveries }, async () => {
        const res = await fetch(`${base}/webhooks/paypal`, {
          method: 'POST',
          body: signed.rawBody,
          headers: signed.headers,
        });
        await res.arrayBuffer();
        return res.status;
      }),
    );
    const statuses: Record<string, number> = {};
    for (const c of codes) statuses[String(c)] = (statuses[String(c)] ?? 0) + 1;
    const stored = Object.keys(rig.stores.webhookEvents.snapshot().events).length;
    const serverErrors = codes.filter((c) => c >= 500).length;
    const checks: Check[] = [
      {
        name: 'every delivery answered',
        ok: codes.length === deliveries,
        detail: `${String(codes.length)} of ${String(deliveries)}`,
      },
      { name: 'no server error', ok: serverErrors === 0, detail: JSON.stringify(statuses) },
      {
        name: 'at least one accepted',
        ok: (statuses['200'] ?? 0) > 0,
        detail: JSON.stringify(statuses),
      },
      { name: 'exactly one event stored', ok: stored === 1, detail: `${String(stored)} stored` },
    ];
    return { scenario: 'L4', deliveries, statuses, stored, checks, ok: checks.every((c) => c.ok) };
  } finally {
    await new Promise((r) => server.close(r));
    await rig.paypal.stop();
  }
}
