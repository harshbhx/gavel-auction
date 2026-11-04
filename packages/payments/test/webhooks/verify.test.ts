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
import { WebhookVerifier, readRawEvent } from '../../src/webhooks/verify.js';

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
  verifier = new WebhookVerifier({ auth, webhookId: DEFAULT_FAKE_WEBHOOK_ID });
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
    const tampered = d.rawBody.replace('hold-1', 'hold-2');
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
    const raw = '{"id":"WH-U","summary":"café \\u00e9 \\" ☃"}';
    const d = signedText(raw);
    expect(await verifier.verifyWebhook(Buffer.from(raw, 'utf8'), d.headers)).toEqual({ ok: true });
    expect(verifyBodies[0]).toContain(`"webhook_event":${raw}`);
  });

  it('readRawEvent returns the input text unchanged', () => {
    for (const s of RAW_BODY_SAMPLES) expect(readRawEvent(Buffer.from(s, 'utf8'))).toBe(s);
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
    const res = await handler.handle(Buffer.from(d.rawBody.replace('hold-1', 'hold-9')), d.headers);
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
