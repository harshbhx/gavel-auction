import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PayPalError } from '../src/errors.js';
import { OrdersClient } from '../src/orders.js';
import { PaymentsApiClient } from '../src/paymentsApi.js';
import { parseEvent } from '../src/webhooks/dedupe.js';
import { toHint } from '../src/webhooks/merge.js';
import { placeholderize, tokenFindings } from '../fixtures/sandbox/redact.mjs';

// Redacted real sandbox responses (QA-25, R-QA-028, R-QA-035). Ids are placeholders; the tests
// put synthetic ids in and parse the result with the real clients.
const sandboxDir = join(import.meta.dirname, '..', 'fixtures', 'sandbox');
const webhookDir = join(import.meta.dirname, '..', '..', 'e2e', 'fixtures', 'webhooks');

const IDS = { ORDER_ID: 'ORD0000000001', AUTH_ID: 'AUTH000000001', CAPTURE_ID: 'CAP0000000001' };

function raw(path: string): string {
  return readFileSync(path, 'utf8');
}

function fill(text: string): string {
  return text
    .replace(/\{\{ORDER_ID\}\}/g, IDS.ORDER_ID)
    .replace(/\{\{AUTH_ID\}\}/g, IDS.AUTH_ID)
    .replace(/\{\{CAPTURE_ID\}\}/g, IDS.CAPTURE_ID)
    .replace(/\{\{EVENT_ID\}\}/g, 'WH-EVENT0000001')
    .replace(/\{\{DEBUG_ID\}\}/g, 'debug0000001');
}

interface Fixture {
  status: number;
  body: unknown;
}

function load(name: string): { status: number; text: string; body: Record<string, unknown> } {
  const f = JSON.parse(fill(raw(join(sandboxDir, name)))) as Fixture;
  return {
    status: f.status,
    text: JSON.stringify(f.body),
    body: f.body as Record<string, unknown>,
  };
}

/** An auth whose send() answers with one stored response, so the real client parses it. */
function authReturning(name: string) {
  const f = load(name);
  return {
    async send() {
      return { status: f.status, headers: {}, text: f.text, attempts: 1 };
    },
  };
}

const jsonFiles = (dir: string): string[] => readdirSync(dir).filter((n) => n.endsWith('.json'));

describe('sandbox response fixtures', () => {
  it('holds the expected files', () => {
    expect(jsonFiles(sandboxDir).length).toBeGreaterThanOrEqual(8);
    expect(jsonFiles(webhookDir).length).toBeGreaterThanOrEqual(6);
  });

  it('has no token or secret substrings and no real ids', () => {
    for (const dir of [sandboxDir, webhookDir]) {
      for (const f of jsonFiles(dir)) {
        const text = raw(join(dir, f));
        expect(tokenFindings(text), f).toEqual([]);
        expect(text, f).not.toMatch(/WH-[A-Z0-9]/);
        expect(text, f).toMatch(/\{\{[A-Z_]+\}\}/);
        // Every file is plain ASCII.
        // eslint-disable-next-line no-control-regex
        expect(/^[\x00-\x7f]*$/.test(text), f).toBe(true);
      }
    }
  });

  it('parses the order responses with the real orders client', async () => {
    const approved = await new OrdersClient({
      auth: authReturning('order-approved.json'),
      fake: false,
    }).getOrder(IDS.ORDER_ID);
    expect(approved.status).toBe('APPROVED');

    const after = await new OrdersClient({
      auth: authReturning('order-after-capture.json'),
      fake: false,
    }).getOrder(IDS.ORDER_ID);
    expect(after.authId).toBe(IDS.AUTH_ID);
    expect(after.authAmountCents).toBe(50000);

    const authorized = await new OrdersClient({
      auth: authReturning('order-authorized.json'),
      fake: false,
    }).authorizeOrder(IDS.ORDER_ID, 'req-1');
    expect(authorized).toEqual({ authId: IDS.AUTH_ID, amountCents: 50000 });
  });

  it('parses the authorization responses with the real payments client', async () => {
    const created = await new PaymentsApiClient({
      auth: authReturning('authorization-created.json'),
    }).getAuthorization(IDS.AUTH_ID);
    expect(created).toEqual({ authId: IDS.AUTH_ID, status: 'CREATED', amountCents: 50000 });

    const afterCapture = await new PaymentsApiClient({
      auth: authReturning('authorization-after-capture.json'),
    }).getAuthorization(IDS.AUTH_ID);
    expect(afterCapture.authId).toBe(IDS.AUTH_ID);
    expect(afterCapture.amountCents).toBe(50000);
  });

  it('maps the rejected void with the real error mapper', async () => {
    const f = load('void-rejected.json');
    expect(f.status).toBe(422);
    const auth = authReturning('void-rejected.json');
    let err: unknown;
    try {
      await new PaymentsApiClient({ auth }).voidAuthorization(IDS.AUTH_ID, 'req-2');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(PayPalError);
    expect(JSON.stringify(f.body)).toContain('PREVIOUSLY_CAPTURED');
  });

  it('keeps the final capture response readable', () => {
    const f = load('capture-final.json');
    expect(f.status).toBe(201);
    expect(f.body['id']).toBe(IDS.CAPTURE_ID);
    expect(f.body['status']).toBe('COMPLETED');
  });

  it('parses every webhook event and maps the known types to a hint', () => {
    for (const f of jsonFiles(webhookDir)) {
      const text = fill(raw(join(webhookDir, f)));
      const ev = parseEvent(text);
      expect(ev.id, f).toBe('WH-EVENT0000001');
      expect(ev.eventType, f).not.toBe('UNKNOWN');
      expect(ev.resource, f).not.toBeNull();
      const hint = toHint(ev.eventType, ev.resource);
      expect(hint, f).not.toBeNull();
    }
  });

  it('placeholderize swaps ids found in links and leaves other text alone', () => {
    const out = placeholderize({
      id: 'A1B2C3D4E5F6',
      links: [{ href: 'https://api.sandbox.paypal.com/v2/payments/authorizations/A1B2C3D4E5F6' }],
      note: 'keep',
    }) as { id: string; links: { href: string }[]; note: string };
    expect(out.id).toBe('{{AUTH_ID}}');
    expect(out.links[0]?.href).toContain('{{AUTH_ID}}');
    expect(out.note).toBe('keep');
  });

  it('flags text that looks like a token', () => {
    const bearer = `Bearer ${'q'.repeat(30)}`;
    expect(tokenFindings(JSON.stringify({ h: bearer })).length).toBeGreaterThan(0);
    expect(tokenFindings('{"access_token":"[REDACTED]"}')).toEqual([]);
  });
});
