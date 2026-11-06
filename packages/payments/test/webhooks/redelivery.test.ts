import { describe, expect, it } from 'vitest';
import type { TransportResult } from '../../src/transport.js';
import type { PaymentAudit } from '../../src/types.js';
import { WebhookHandler, type VerifiedWebhook } from '../../src/webhooks/handler.js';
import {
  WebhookVerifier,
  type VerifyAuth,
  type WebhookVerifierOptions,
} from '../../src/webhooks/verify.js';

/**
 * R12-P04: the webhook route answers 503 so that PayPal sends the event again, and PayPal
 * retries for days. Whether a retry keeps the original transmission time is not recorded
 * (G4, ASSUMPTIONS W06), so a transmission time older than ten minutes must still reach
 * PayPal's verify endpoint; only its answer and the event id decide.
 */

const NOW = Date.parse('2026-11-05T12:00:00.000Z');
const MIN = 60_000;
const DAY = 86_400_000;
const BODY = '{"id":"WH-R12-1","event_type":"PAYMENT.AUTHORIZATION.VOIDED","resource":{}}';

function headersAt(sentMs: number, transmissionId = 'TX-R12-1'): Record<string, string> {
  return {
    'PAYPAL-AUTH-ALGO': 'SHA256withRSA',
    'PAYPAL-CERT-URL': 'https://api.paypal.com/v1/notifications/certs/CERT-R12',
    'PAYPAL-TRANSMISSION-ID': transmissionId,
    'PAYPAL-TRANSMISSION-SIG': 'c2lnbmF0dXJlLXIxMg==',
    'PAYPAL-TRANSMISSION-TIME': new Date(sentMs).toISOString(),
  };
}

/** PayPal's verify endpoint: SUCCESS for the genuine transmission ids, FAILURE otherwise. */
function verifyEndpoint(genuine: ReadonlySet<string>): { auth: VerifyAuth; calls: () => number } {
  let calls = 0;
  const auth: VerifyAuth = {
    send: async (req): Promise<TransportResult> => {
      calls += 1;
      const sent = JSON.parse(String(req.body)) as { transmission_id?: unknown };
      const ok = typeof sent.transmission_id === 'string' && genuine.has(sent.transmission_id);
      return {
        status: 200,
        headers: {},
        text: JSON.stringify({ verification_status: ok ? 'SUCCESS' : 'FAILURE' }),
        attempts: 1,
      };
    },
  };
  return { auth, calls: () => calls };
}

function verifier(
  auth: VerifyAuth,
  now: () => number,
  extra: Partial<WebhookVerifierOptions> = {},
): WebhookVerifier {
  return new WebhookVerifier({ auth, webhookId: 'WH-LIVE', nowMs: now, ...extra });
}

describe('R12-P04 PayPal redeliveries older than ten minutes', () => {
  it('a redelivery 20 minutes after the first transmission is verified by PayPal and accepted', async () => {
    const paypal = verifyEndpoint(new Set(['TX-R12-1']));
    const v = verifier(paypal.auth, () => NOW);
    expect(await v.verifyWebhook(BODY, headersAt(NOW - 20 * MIN))).toEqual({ ok: true });
    expect(paypal.calls()).toBe(1);
  });

  it('the handler answers 503 during an intake outage and 200 to the same delivery 20 minutes later', async () => {
    const paypal = verifyEndpoint(new Set(['TX-R12-1']));
    let now = NOW;
    let intakeUp = false;
    const stored: VerifiedWebhook[] = [];
    const audits: PaymentAudit[] = [];
    const handler = new WebhookHandler({
      verifier: verifier(paypal.auth, () => now),
      audit: { append: async (e) => void audits.push(e) },
      clock: { nowMs: () => now },
      onVerified: async (e) => {
        if (!intakeUp) throw new Error('store down');
        stored.push(e);
      },
    });
    const headers = headersAt(NOW);
    expect(await handler.handle(Buffer.from(BODY), headers)).toEqual({ status: 503 });
    // PayPal retries the transmission unchanged, 20 minutes later.
    intakeUp = true;
    now = NOW + 20 * MIN;
    expect(await handler.handle(Buffer.from(BODY), headers)).toEqual({ status: 200 });
    expect(stored).toHaveLength(1);
    expect(audits.filter((a) => a.label === 'webhook_rejected')).toEqual([]);
  });

  it('a forged old delivery is still refused by PayPal and answered 401', async () => {
    const paypal = verifyEndpoint(new Set());
    const v = verifier(paypal.auth, () => NOW);
    expect(await v.verifyWebhook(BODY, headersAt(NOW - 2 * DAY))).toEqual({
      ok: false,
      reason: 'verification_failed',
    });
    expect(paypal.calls()).toBe(1);
  });

  it('old transmissions get a quarter of the verify window; fresh ones keep the rest', async () => {
    const paypal = verifyEndpoint(new Set());
    const v = verifier(paypal.auth, () => NOW, { maxCallsPerWindow: 8, windowMs: 60_000 });
    const old: string[] = [];
    for (let i = 1; i <= 5; i += 1) {
      const o = await v.verifyWebhook(BODY, headersAt(NOW - DAY, `TX-OLD-${i}`));
      old.push(o.ok ? 'ok' : o.reason);
    }
    expect(old).toEqual([
      'verification_failed',
      'verification_failed',
      'rate_limited',
      'rate_limited',
      'rate_limited',
    ]);
    for (let i = 1; i <= 6; i += 1) {
      expect(await v.verifyWebhook(BODY, headersAt(NOW, `TX-NEW-${i}`))).toEqual({
        ok: false,
        reason: 'verification_failed',
      });
    }
    expect(paypal.calls()).toBe(8);
  });

  it('a time past the redelivery horizon or ahead of the clock is refused without a call', async () => {
    const paypal = verifyEndpoint(new Set(['TX-R12-1']));
    const v = verifier(paypal.auth, () => NOW);
    for (const sent of [NOW - 8 * DAY, NOW + 20 * MIN]) {
      expect(await v.verifyWebhook(BODY, headersAt(sent))).toEqual({
        ok: false,
        reason: 'precheck_failed',
      });
    }
    expect(paypal.calls()).toBe(0);
  });

  it('a redelivery two hours old is accepted once, and a tampered copy of it is refused', async () => {
    let calls = 0;
    const auth: VerifyAuth = {
      send: async (req): Promise<TransportResult> => {
        calls += 1;
        const genuine = String(req.body).includes('"resource":{}}}');
        return {
          status: 200,
          headers: {},
          text: JSON.stringify({ verification_status: genuine ? 'SUCCESS' : 'FAILURE' }),
          attempts: 1,
        };
      },
    };
    const v = verifier(auth, () => NOW);
    const headers = headersAt(NOW - 120 * MIN);
    expect(await v.verifyWebhook(BODY, headers)).toEqual({ ok: true });
    const tampered = BODY.replace('"resource":{}', '"resource":{"amount":"1.00"}');
    expect(await v.verifyWebhook(tampered, headers)).toEqual({
      ok: false,
      reason: 'verification_failed',
    });
    expect(calls).toBe(2);
  });
});
