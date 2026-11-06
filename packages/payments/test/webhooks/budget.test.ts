import { describe, expect, it } from 'vitest';
import type { AuditSink, Clock } from '../../src/ports.js';
import { WebhookHandler } from '../../src/webhooks/handler.js';
import { WebhookVerifier, sourceKey, type VerifyAuth } from '../../src/webhooks/verify.js';

const NOW = Date.parse('2026-11-04T10:00:00.000Z');
const PAYPAL = '198.51.100.7';

function headers(id: string): Record<string, string> {
  return {
    'PAYPAL-AUTH-ALGO': 'SHA256withRSA',
    'PAYPAL-CERT-URL': 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1',
    'PAYPAL-TRANSMISSION-ID': id,
    'PAYPAL-TRANSMISSION-SIG': 'c2ln',
    'PAYPAL-TRANSMISSION-TIME': new Date(NOW).toISOString(),
  };
}

/** PayPal answers SUCCESS only for bodies that carry `"real"`. */
function rig(opts: { maxCallsPerWindow?: number } = {}): {
  verifier: WebhookVerifier;
  calls: () => number;
} {
  let calls = 0;
  const auth: VerifyAuth = {
    send: async (req) => {
      calls += 1;
      const real = (req.body ?? '').includes('"real"');
      return {
        status: 200,
        headers: {},
        text: real ? '{"verification_status":"SUCCESS"}' : '{"verification_status":"FAILURE"}',
        attempts: 1,
      };
    },
  };
  const verifier = new WebhookVerifier({
    auth,
    webhookId: 'WH',
    nowMs: () => NOW,
    maxCallsPerWindow: opts.maxCallsPerWindow ?? 120,
  });
  return { verifier, calls: () => calls };
}

const forged = '{"id":"WH-F"}';
const real = '{"id":"WH-R","real":true}';

describe('sourceKey', () => {
  it('keys an IPv6 address on its /64', () => {
    expect(sourceKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).toBe(sourceKey('2001:db8:1:2::1'));
    expect(sourceKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).not.toBe(sourceKey('2001:db8:1:3::1'));
    expect(sourceKey('2001:DB8:1:2::1%eth0')).toBe(sourceKey('2001:db8:1:2:0:0:0:9'));
  });

  it('keeps IPv4 as is and maps IPv4-in-IPv6 to IPv4', () => {
    expect(sourceKey('203.0.113.9')).toBe('203.0.113.9');
    expect(sourceKey('::ffff:203.0.113.9')).toBe('203.0.113.9');
  });
});

describe('HRD-65 verify budget', () => {
  it('one IPv6 /64 counts as one source whatever the low bits are', async () => {
    const { verifier, calls } = rig();
    for (let i = 0; i < 100; i += 1) {
      await verifier.verifyWebhook(forged, headers(`tx-${i}`), `2001:db8:5:5::${i.toString(16)}`);
    }
    expect(calls()).toBe(30);
  });

  it('four flooding sources cannot starve a verified PayPal source', async () => {
    const { verifier, calls } = rig();
    // PayPal's address has had one delivery verified before the flood.
    expect(await verifier.verifyWebhook(real, headers('tx-first'), PAYPAL)).toEqual({ ok: true });
    for (let i = 0; i < 200; i += 1) {
      const src = `203.0.113.${(i % 4) + 1}`;
      await verifier.verifyWebhook(forged, headers(`tx-f-${i}`), src);
    }
    // The forgers used at most half of the window between them.
    expect(calls()).toBeLessThanOrEqual(1 + 60);
    // More than a per-source share of real events still gets verified.
    for (let i = 0; i < 40; i += 1) {
      const body = `{"id":"WH-R${i}","real":true}`;
      expect(await verifier.verifyWebhook(body, headers(`tx-r-${i}`), PAYPAL)).toEqual({
        ok: true,
      });
    }
  });

  it('a forging source never becomes proven and stays on its share', async () => {
    const { verifier, calls } = rig();
    for (let i = 0; i < 60; i += 1) {
      await verifier.verifyWebhook(forged, headers(`tx-${i}`), '203.0.113.50');
    }
    expect(calls()).toBe(30);
  });
});

describe('HRD-65 event types the intake ignores', () => {
  const clock: Clock = { nowMs: () => NOW };
  const audit: AuditSink = { append: async () => undefined };

  function handlerRig(): { handler: WebhookHandler; verifyCalls: () => number; seen: string[] } {
    const r = rig();
    const seen: string[] = [];
    const handler = new WebhookHandler({
      verifier: r.verifier,
      audit,
      clock,
      onVerified: async (e) => {
        seen.push(e.rawBody.toString('utf8'));
      },
      acceptsEventType: (t) => t === 'PAYMENT.AUTHORIZATION.VOIDED',
    });
    return { handler, verifyCalls: r.calls, seen };
  }

  it('answers an ignored type 200 without a verify call or intake', async () => {
    const { handler, verifyCalls, seen } = handlerRig();
    const body = Buffer.from('{"id":"WH-1","event_type":"CHECKOUT.ORDER.APPROVED"}');
    for (let i = 0; i < 10; i += 1) {
      expect(await handler.handle(body, headers(`tx-${i}`), PAYPAL)).toEqual({ status: 200 });
    }
    expect(verifyCalls()).toBe(0);
    expect(seen).toEqual([]);
  });

  it('still verifies and takes in a type the intake uses', async () => {
    const { handler, verifyCalls, seen } = handlerRig();
    const body = Buffer.from(
      '{"id":"WH-2","event_type":"PAYMENT.AUTHORIZATION.VOIDED","real":true}',
    );
    expect(await handler.handle(body, headers('tx-ok'), PAYPAL)).toEqual({ status: 200 });
    expect(verifyCalls()).toBe(1);
    expect(seen).toHaveLength(1);
  });

  it('keeps verification mandatory for a forged event of a used type', async () => {
    const { handler, verifyCalls, seen } = handlerRig();
    const body = Buffer.from('{"id":"WH-3","event_type":"PAYMENT.AUTHORIZATION.VOIDED"}');
    expect(await handler.handle(body, headers('tx-bad'), PAYPAL)).toEqual({ status: 401 });
    expect(verifyCalls()).toBe(1);
    expect(seen).toEqual([]);
  });

  it('a body without an event type still goes to verification', async () => {
    const { handler, verifyCalls } = handlerRig();
    expect(await handler.handle(Buffer.from('{"id":"WH-4"}'), headers('tx-n'), PAYPAL)).toEqual({
      status: 401,
    });
    expect(verifyCalls()).toBe(1);
  });
});
