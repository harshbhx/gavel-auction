import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PayPalError } from '../../src/errors.js';
import { FakePayPalServer, DEFAULT_FAKE_WEBHOOK_ID } from '../../src/fake/server.js';
import {
  FAKE_AUTH_ALGO,
  FAKE_CERT_URL,
  WebhookEmitter,
  signWebhook,
} from '../../src/fake/webhooks.js';
import { TokenManager } from '../../src/oauth.js';
import type { AuditSink, Clock } from '../../src/ports.js';
import { Transport, type FetchLike } from '../../src/transport.js';
import type { PaymentAudit } from '../../src/types.js';
import {
  RAW_BODY_SAMPLES,
  WebhookHandler,
  assertRawBodyCapture,
  type VerifiedWebhook,
} from '../../src/webhooks/handler.js';
import {
  WebhookVerifier,
  readRawEvent,
  type VerifyAuth,
  type WebhookVerifierOptions,
} from '../../src/webhooks/verify.js';

let server: FakePayPalServer;
let verifier: WebhookVerifier;
let auth: TokenManager;
let verifyBodies: string[];
let emitter: WebhookEmitter;

const noSleep = async (): Promise<void> => undefined;

beforeEach(async () => {
  server = new FakePayPalServer({ timers: { sleep: noSleep } });
  await server.start();
  verifyBodies = [];
  const recording: FetchLike = async (url, init) => {
    if (url.endsWith('/v1/notifications/verify-webhook-signature') && init.body !== undefined) {
      verifyBodies.push(init.body);
    }
    return fetch(url, init);
  };
  const transport = new Transport({ fetch: recording, sleep: noSleep });
  auth = new TokenManager({
    transport,
    baseUrl: server.url,
    clientId: 'fake-client',
    clientSecret: 'fake-secret-value',
  });
  verifier = new WebhookVerifier({ auth, webhookId: DEFAULT_FAKE_WEBHOOK_ID, fake: true });
  emitter = new WebhookEmitter({
    webhookId: DEFAULT_FAKE_WEBHOOK_ID,
    nowMs: () => server.core.clock.nowMs(),
  });
});

afterEach(async () => {
  await server.stop();
});

function signedEvent(): { rawBody: string; headers: Record<string, string> } {
  const orderId = server.core.createOrder(
    { holdId: 'hold-1', amountCents: 5000, description: 'd' },
    'req-o',
  ).id;
  server.core.approveOrder(orderId);
  const event = server.core.events[0];
  if (event === undefined) throw new Error('no event emitted');
  return emitter.sign(event);
}

function withoutHeader(headers: Record<string, string>, name: string): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).filter(([k]) => k !== name));
}

/** A delivery whose body has the given exact text, signed as the fake would. */
function signedText(rawBody: string): { rawBody: string; headers: Record<string, string> } {
  const transmissionId = 'TX-custom';
  const transmissionTime = new Date(server.core.clock.nowMs()).toISOString();
  const sig = signWebhook({
    transmissionId,
    transmissionTime,
    webhookId: DEFAULT_FAKE_WEBHOOK_ID,
    rawBody,
  });
  return {
    rawBody,
    headers: {
      'PAYPAL-AUTH-ALGO': FAKE_AUTH_ALGO,
      'PAYPAL-CERT-URL': FAKE_CERT_URL,
      'PAYPAL-TRANSMISSION-ID': transmissionId,
      'PAYPAL-TRANSMISSION-SIG': sig,
      'PAYPAL-TRANSMISSION-TIME': transmissionTime,
    },
  };
}

describe('T-PAY-060 verifyWebhook', () => {
  it('accepts a correctly signed event', async () => {
    const d = signedEvent();
    expect(await verifier.verifyWebhook(Buffer.from(d.rawBody), d.headers)).toEqual({ ok: true });
  });

  it('reads header names case-insensitively and from a Headers object', async () => {
    const d = signedEvent();
    const lower: Record<string, string> = {};
    for (const [k, v] of Object.entries(d.headers)) lower[k.toLowerCase()] = v;
    expect(await verifier.verifyWebhook(d.rawBody, lower)).toEqual({ ok: true });
    expect(await verifier.verifyWebhook(d.rawBody, new Headers(d.headers))).toEqual({ ok: true });
  });

  it('rejects a tampered body', async () => {
    const d = signedEvent();
    const tampered = d.rawBody.replace('APPROVED', 'APPROVEE');
    expect(tampered).not.toBe(d.rawBody);
    expect(await verifier.verifyWebhook(Buffer.from(tampered), d.headers)).toEqual({
      ok: false,
      reason: 'verification_failed',
    });
  });

  it('rejects a wrong signature and a wrong webhook id', async () => {
    const d = signedEvent();
    const badSig = { ...d.headers, 'PAYPAL-TRANSMISSION-SIG': '00'.repeat(32) };
    expect(await verifier.verifyWebhook(d.rawBody, badSig)).toMatchObject({ ok: false });
    const other = new WebhookVerifier({
      auth,
      webhookId: 'WH-OTHER',
      fake: true,
    });
    expect(await other.verifyWebhook(d.rawBody, d.headers)).toMatchObject({ ok: false });
  });

  it.each([
    'PAYPAL-AUTH-ALGO',
    'PAYPAL-CERT-URL',
    'PAYPAL-TRANSMISSION-ID',
    'PAYPAL-TRANSMISSION-SIG',
    'PAYPAL-TRANSMISSION-TIME',
  ])('rejects a delivery without %s and does not call PayPal', async (name) => {
    const d = signedEvent();
    const rest = withoutHeader(d.headers, name);
    expect(await verifier.verifyWebhook(d.rawBody, rest)).toEqual({
      ok: false,
      reason: 'missing_header',
    });
    expect(verifyBodies).toHaveLength(0);
  });

  it('rejects bodies that are not exactly one JSON object', async () => {
    const d = signedEvent();
    const inject = '{"id":"X"}, "webhook_id":"WH-FAKE"';
    for (const body of [inject, '[]', 'null', '', '{"a":', '{"a":1} {"b":2}']) {
      expect(await verifier.verifyWebhook(body, d.headers)).toEqual({
        ok: false,
        reason: 'malformed_body',
      });
    }
    expect(await verifier.verifyWebhook(Buffer.from([0x7b, 0xff, 0x7d]), d.headers)).toEqual({
      ok: false,
      reason: 'malformed_body',
    });
    expect(verifyBodies).toHaveLength(0);
  });

  it('throws a PayPalError when PayPal cannot be asked', async () => {
    const d = signedEvent();
    server.faults.add({ kind: 'http_500', op: 'verify', times: 10 });
    const err = await verifier.verifyWebhook(d.rawBody, d.headers).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PayPalError);
    expect((err as PayPalError).outcome).toBe('unknown');
  });
});

describe('T-PAY-061 raw body splicing', () => {
  it('sends the original bytes of an event with unusual whitespace and key order', async () => {
    const raw =
      '{\n  "resource" : {"id":"CAP-1",\t"amount":{"value":"10.00","currency_code":"USD"}},\n' +
      '  "event_type":"PAYMENT.CAPTURE.COMPLETED",   "id" :"WH-ODD",\n  "create_time":"2026-01-01T00:00:00.000Z"\n}';
    const d = signedText(raw);
    expect(await verifier.verifyWebhook(Buffer.from(raw, 'utf8'), d.headers)).toEqual({
      ok: true,
    });
    expect(verifyBodies).toHaveLength(1);
    const sent = verifyBodies[0] ?? '';
    expect(sent).toContain(`"webhook_event":${raw}}`);
    expect(sent.endsWith(`"webhook_event":${raw}}`)).toBe(true);
    const envelope = JSON.parse(sent) as Record<string, unknown>;
    expect(envelope['webhook_id']).toBe(DEFAULT_FAKE_WEBHOOK_ID);
    expect(envelope['transmission_id']).toBe('TX-custom');
  });

  it('keeps non-ASCII text and escapes untouched', async () => {
    const raw = '{"id":"WH-U","summary":"caf\u00e9 \\u00e9 \\" \u2603"}';
    const d = signedText(raw);
    expect(await verifier.verifyWebhook(Buffer.from(raw, 'utf8'), d.headers)).toEqual({ ok: true });
    expect(verifyBodies[0]).toContain(`"webhook_event":${raw}`);
  });

  it('readRawEvent returns the input text unchanged', () => {
    for (const s of RAW_BODY_SAMPLES) expect(readRawEvent(Buffer.from(s, 'utf8'))).toBe(s);
  });
});

describe('verifyWebhook prechecks and call limit', () => {
  const NOW = Date.parse('2026-11-04T10:00:00.000Z');
  const good: Record<string, string> = {
    'PAYPAL-AUTH-ALGO': 'SHA256withRSA',
    'PAYPAL-CERT-URL': 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1',
    'PAYPAL-TRANSMISSION-ID': 'T1',
    'PAYPAL-TRANSMISSION-SIG': 'c2ln',
    'PAYPAL-TRANSMISSION-TIME': '2026-11-04T09:59:00.000Z',
  };
  const body = '{"id":"WH-1"}';
  let calls: number;
  const counting: VerifyAuth = {
    send: async () => {
      calls += 1;
      return {
        status: 200,
        headers: {},
        text: '{"verification_status":"FAILURE"}',
        attempts: 1,
      };
    },
  };
  const live = (extra: Partial<WebhookVerifierOptions> = {}): WebhookVerifier =>
    new WebhookVerifier({ auth: counting, webhookId: 'WH', nowMs: () => NOW, ...extra });

  beforeEach(() => {
    calls = 0;
  });

  it('sends a well-formed delivery to PayPal', async () => {
    expect(await live().verifyWebhook(body, good)).toEqual({
      ok: false,
      reason: 'verification_failed',
    });
    expect(calls).toBe(1);
  });

  it.each([
    ['an unknown algorithm', { 'PAYPAL-AUTH-ALGO': 'none' }],
    ['a certificate url on another host', { 'PAYPAL-CERT-URL': 'https://paypal.com.evil.test/c' }],
    ['a plain http certificate url', { 'PAYPAL-CERT-URL': 'http://api.paypal.com/c' }],
    ['a stale transmission time', { 'PAYPAL-TRANSMISSION-TIME': '2026-11-04T08:00:00.000Z' }],
    ['an unreadable transmission time', { 'PAYPAL-TRANSMISSION-TIME': 'yesterday' }],
  ])('rejects %s without calling PayPal', async (_name, override) => {
    expect(await live().verifyWebhook(body, { ...good, ...override })).toEqual({
      ok: false,
      reason: 'precheck_failed',
    });
    expect(calls).toBe(0);
  });

  it('caps calls to PayPal per window and starts again after it', async () => {
    let now = NOW;
    const v = live({ nowMs: () => now, maxCallsPerWindow: 2, windowMs: 1000 });
    const headers = { ...good, 'PAYPAL-TRANSMISSION-TIME': new Date(NOW).toISOString() };
    const tx = (i: number): Record<string, string> => ({
      ...headers,
      'PAYPAL-TRANSMISSION-ID': `tx-${i}`,
    });
    await v.verifyWebhook(body, tx(1));
    await v.verifyWebhook(body, tx(2));
    expect(await v.verifyWebhook(body, tx(3))).toEqual({ ok: false, reason: 'rate_limited' });
    expect(calls).toBe(2);
    now += 1000;
    expect(await v.verifyWebhook(body, tx(3))).toMatchObject({ reason: 'verification_failed' });
    expect(calls).toBe(3);
  });

  it('R8-P07 quoting the public certificate url does not reserve or buy any call slots', async () => {
    const realCert = 'https://api.paypal.com/v1/notifications/certs/CERT-REAL';
    const auth2: VerifyAuth = {
      send: async (req) => {
        calls += 1;
        const real = typeof req.body === 'string' && req.body.includes('tx-real');
        return {
          status: 200,
          headers: {},
          text: real ? '{"verification_status":"SUCCESS"}' : '{"verification_status":"FAILURE"}',
          attempts: 1,
        };
      },
    };
    const v = new WebhookVerifier({
      auth: auth2,
      webhookId: 'WH',
      nowMs: () => NOW,
      maxCallsPerWindow: 8,
      windowMs: 60_000,
    });
    const headers = {
      ...good,
      'PAYPAL-TRANSMISSION-TIME': new Date(NOW).toISOString(),
      'PAYPAL-CERT-URL': realCert,
    };
    expect(await v.verifyWebhook(body, { ...headers, 'PAYPAL-TRANSMISSION-ID': 'tx-real' })).toEqual({
      ok: true,
    });
    const used = calls;
    // Forged deliveries naming the real certificate url use the same slots as any other.
    for (let i = 0; i < 20; i += 1) {
      await v.verifyWebhook(body, { ...headers, 'PAYPAL-TRANSMISSION-ID': `tx-forged-${i}` });
    }
    expect(calls - used).toBe(7);
    expect(
      await v.verifyWebhook(body, { ...headers, 'PAYPAL-TRANSMISSION-ID': 'tx-forged-next' }),
    ).toEqual({ ok: false, reason: 'rate_limited' });
  });

  it('R8-P07 an identical delivery is answered locally, a real retry costs no call', async () => {
    const auth2: VerifyAuth = {
      send: async () => {
        calls += 1;
        return {
          status: 200,
          headers: {},
          text: '{"verification_status":"SUCCESS"}',
          attempts: 1,
        };
      },
    };
    const v = new WebhookVerifier({
      auth: auth2,
      webhookId: 'WH',
      nowMs: () => NOW,
      maxCallsPerWindow: 2,
    });
    const headers = { ...good, 'PAYPAL-TRANSMISSION-TIME': new Date(NOW).toISOString() };
    expect(await v.verifyWebhook(body, headers)).toEqual({ ok: true });
    for (let i = 0; i < 10; i += 1) expect(await v.verifyWebhook(body, headers)).toEqual({ ok: true });
    expect(calls).toBe(1);
    // The same transmission id with another body is a different delivery: PayPal is asked.
    const other = body.replace('WH-', 'XX-');
    expect(await v.verifyWebhook(other === body ? `${body} ` : other, headers)).toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  it('R8-P07 a repeated forged request is answered locally and costs one call', async () => {
    const v = live({ maxCallsPerWindow: 4 });
    const headers = { ...good, 'PAYPAL-TRANSMISSION-TIME': new Date(NOW).toISOString() };
    for (let i = 0; i < 50; i += 1) {
      expect(await v.verifyWebhook(body, headers)).toEqual({
        ok: false,
        reason: 'verification_failed',
      });
    }
    expect(calls).toBe(1);
  });

  it('R8-P07 one source cannot take more than its share of the window', async () => {
    const v = live({ maxCallsPerWindow: 8 });
    const headers = { ...good, 'PAYPAL-TRANSMISSION-TIME': new Date(NOW).toISOString() };
    const tx = (i: number): Record<string, string> => ({
      ...headers,
      'PAYPAL-TRANSMISSION-ID': `tx-${i}`,
    });
    for (let i = 0; i < 6; i += 1) await v.verifyWebhook(body, tx(i), '203.0.113.9');
    expect(calls).toBe(2);
    expect(await v.verifyWebhook(body, tx(100), '203.0.113.9')).toEqual({
      ok: false,
      reason: 'rate_limited',
    });
    // Another source still has the rest of the window.
    expect(await v.verifyWebhook(body, tx(101), '198.51.100.4')).toMatchObject({
      reason: 'verification_failed',
    });
  });

  it('rejects a signature or transmission id of the wrong shape without a slot', async () => {
    const v = live({ maxCallsPerWindow: 1 });
    const headers = { ...good, 'PAYPAL-TRANSMISSION-TIME': new Date(NOW).toISOString() };
    for (const bad of [
      { 'PAYPAL-TRANSMISSION-SIG': 'not a signature!' },
      { 'PAYPAL-TRANSMISSION-ID': 'id with spaces' },
    ]) {
      expect(await v.verifyWebhook(body, { ...headers, ...bad })).toEqual({
        ok: false,
        reason: 'precheck_failed',
      });
    }
    expect(calls).toBe(0);
    expect(await v.verifyWebhook(body, headers)).toMatchObject({ reason: 'verification_failed' });
  });

  it('fake mode accepts a local certificate url', async () => {
    const v = live({ fake: true });
    const fakeHeaders = { ...good, 'PAYPAL-CERT-URL': FAKE_CERT_URL, 'PAYPAL-AUTH-ALGO': 'X' };
    expect(await v.verifyWebhook(body, fakeHeaders)).toMatchObject({
      reason: 'verification_failed',
    });
    expect(calls).toBe(1);
  });

  it('the handler answers 503 without a row when the limit is hit, and samples reject rows', async () => {
    const audits: PaymentAudit[] = [];
    let t = 5000;
    const handler = new WebhookHandler({
      verifier: live({ maxCallsPerWindow: 0 }),
      audit: {
        append: async (e) => {
          audits.push(e);
        },
      },
      clock: { nowMs: () => t },
      onVerified: async () => undefined,
    });
    expect(await handler.handle(Buffer.from(body), good)).toEqual({ status: 503 });
    expect(audits).toEqual([]);
    const bad = { ...good, 'PAYPAL-AUTH-ALGO': 'none' };
    expect(await handler.handle(Buffer.from(body), bad)).toEqual({ status: 401 });
    expect(await handler.handle(Buffer.from(body), bad)).toEqual({ status: 401 });
    expect(audits).toHaveLength(1);
    t += 1000;
    await handler.handle(Buffer.from(body), bad);
    expect(audits).toHaveLength(2);
  });
});

describe('WebhookHandler', () => {
  let audits: PaymentAudit[];
  let verified: VerifiedWebhook[];
  let handler: WebhookHandler;

  beforeEach(() => {
    audits = [];
    verified = [];
    const audit: AuditSink = {
      append: async (e) => {
        audits.push(e);
      },
    };
    const clock: Clock = { nowMs: () => 1234 };
    handler = new WebhookHandler({
      verifier,
      audit,
      clock,
      onVerified: async (e) => {
        verified.push(e);
      },
    });
  });

  it('answers 200 for a valid event and passes it on', async () => {
    const d = signedEvent();
    const res = await handler.handle(Buffer.from(d.rawBody), d.headers);
    expect(res).toEqual({ status: 200 });
    expect(verified).toHaveLength(1);
    expect(verified[0]?.rawBody.toString('utf8')).toBe(d.rawBody);
    expect(audits).toEqual([]);
  });

  it('answers 401 and stores a webhook_rejected audit row for a tampered body', async () => {
    const d = signedEvent();
    const res = await handler.handle(
      Buffer.from(d.rawBody.replace('APPROVED', 'APPROVEE')),
      d.headers,
    );
    expect(res).toEqual({ status: 401 });
    expect(verified).toEqual([]);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      kind: 'state_change',
      label: 'webhook_rejected',
      tsMs: 1234,
    });
    expect(JSON.stringify(audits)).not.toContain(d.headers['PAYPAL-TRANSMISSION-SIG'] ?? 'x');
  });

  it('answers 401 with an audit row when a header is missing', async () => {
    const d = signedEvent();
    const rest = withoutHeader(d.headers, 'PAYPAL-TRANSMISSION-SIG');
    expect(await handler.handle(Buffer.from(d.rawBody), rest)).toEqual({ status: 401 });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ label: 'webhook_rejected', from: 'missing_header' });
    expect(verified).toEqual([]);
  });

  it('answers 503 and does not reject when PayPal is unavailable', async () => {
    const d = signedEvent();
    server.faults.add({ kind: 'http_500', op: 'verify', times: 10 });
    expect(await handler.handle(Buffer.from(d.rawBody), d.headers)).toEqual({ status: 503 });
    expect(audits.map((a) => a.label)).toEqual(['webhook_verify_unavailable']);
    expect(verified).toEqual([]);
  });

  it('refuses a body that is not a Buffer', async () => {
    const d = signedEvent();
    await expect(handler.handle(d.rawBody as unknown as Buffer, d.headers)).rejects.toThrow(
      TypeError,
    );
    await expect(
      handler.handle(JSON.parse(d.rawBody) as unknown as Buffer, d.headers),
    ).rejects.toThrow(TypeError);
  });
});

describe('raw-body route contract', () => {
  let http: Server;
  let url: string;

  /** A route that records what it hands to the handler. `parse` mimics a JSON body parser. */
  async function serve(
    parse: boolean,
  ): Promise<(body: Buffer, h: Record<string, string>) => Promise<Buffer>> {
    let last: Buffer = Buffer.alloc(0);
    http = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const raw = Buffer.concat(chunks);
        last = parse ? Buffer.from(JSON.stringify(JSON.parse(raw.toString('utf8'))), 'utf8') : raw;
        res.writeHead(200);
        res.end();
      });
    });
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(http.address() as AddressInfo).port}/webhooks/paypal`;
    return async (body, headers) => {
      await fetch(url, { method: 'POST', headers, body: new Uint8Array(body) });
      return last;
    };
  }

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      http.close(() => resolve());
      http.closeAllConnections();
    });
  });

  it('passes for a route that captures the raw bytes', async () => {
    const roundTrip = await serve(false);
    await expect(assertRawBodyCapture({ roundTrip })).resolves.toBeUndefined();
  });

  it('fails for a route that parses and re-serializes the body', async () => {
    const roundTrip = await serve(true);
    await expect(assertRawBodyCapture({ roundTrip })).rejects.toThrow(/byte for byte/);
  });
});
