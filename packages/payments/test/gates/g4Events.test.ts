import { describe, expect, it } from 'vitest';
import { RecordingHttp } from '../../gates/http.js';
import { g4EventsGate, type G4EventsDeps } from '../../gates/g4-events.js';
import type { GateContext } from '../../gates/runner.js';

interface Reply {
  status: number;
  body?: unknown;
}

/**
 * Builds a gate context whose HTTP layer answers from `replies`, keyed by "METHOD path".
 * An empty reply has no body, which is what PayPal sends for a 204.
 */
function ctxWith(replies: Record<string, Reply>): GateContext {
  const fetch = async (url: string, init: { method: string }): Promise<Response> => {
    const key = `${init.method} ${new URL(url).pathname}`;
    const reply = replies[key];
    if (reply === undefined) throw new Error(`no reply for ${key}`);
    if (reply.body === undefined) return new Response(null, { status: reply.status });
    return new Response(JSON.stringify(reply.body), {
      status: reply.status,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  const http = new RecordingHttp({
    baseUrl: 'https://api-m.sandbox.paypal.com',
    fake: false,
    gate: 'G4-EVENTS',
    runId: 'run1',
    scriptVersion: 'test',
    record: () => undefined,
    fetch,
  });
  const stub = {
    runId: 'run1234567890',
    config: { clientId: 'client', clientSecret: 'secret' },
    http,
    step: async <T>(_name: string, fn: () => Promise<T>): Promise<T> => fn(),
    log: (): void => undefined,
  };
  return stub as unknown as GateContext;
}

const deps: G4EventsDeps = {
  approve: async (): Promise<void> => undefined,
};

function replies(
  voidReply: Reply,
  captureReply: Reply = { status: 201, body: { id: 'C1' } },
): Record<string, Reply> {
  return {
    'POST /v1/oauth2/token': { status: 200, body: { access_token: 'tok' } },
    'POST /v2/checkout/orders': {
      status: 201,
      body: {
        id: 'ORDER1',
        links: [{ rel: 'payer-action', href: 'https://www.sandbox.paypal.com/approve' }],
      },
    },
    'POST /v2/checkout/orders/ORDER1/authorize': {
      status: 201,
      body: {
        purchase_units: [{ payments: { authorizations: [{ id: 'AUTH1' }] } }],
      },
    },
    'POST /v2/payments/authorizations/AUTH1/capture': captureReply,
    'POST /v2/payments/authorizations/AUTH1/void': voidReply,
  };
}

describe('G4 events void', () => {
  it('accepts a 204 No Content void with an empty body', async () => {
    const ctx = ctxWith(replies({ status: 204 }));
    await expect(g4EventsGate(ctx, deps)).resolves.toBeUndefined();
  });

  it('accepts a 200 void with a JSON body', async () => {
    const ctx = ctxWith(replies({ status: 200, body: { id: 'AUTH1' } }));
    await expect(g4EventsGate(ctx, deps)).resolves.toBeUndefined();
  });

  it('accepts a 201 void', async () => {
    const ctx = ctxWith(replies({ status: 201, body: { id: 'AUTH1' } }));
    await expect(g4EventsGate(ctx, deps)).resolves.toBeUndefined();
  });

  it('still fails on an unexpected void status', async () => {
    const ctx = ctxWith(replies({ status: 500, body: { name: 'INTERNAL_SERVER_ERROR' } }));
    await expect(g4EventsGate(ctx, deps)).rejects.toThrow('G4 events void: void answered HTTP 500');
  });
});

describe('G4 events capture', () => {
  it('accepts the default 201 capture', async () => {
    const ctx = ctxWith(replies({ status: 204 }));
    await expect(g4EventsGate(ctx, deps)).resolves.toBeUndefined();
  });

  it('accepts a 200 capture', async () => {
    const ctx = ctxWith(replies({ status: 204 }, { status: 200, body: { id: 'C1' } }));
    await expect(g4EventsGate(ctx, deps)).resolves.toBeUndefined();
  });

  it('rejects a capture that answers 500', async () => {
    const ctx = ctxWith(replies({ status: 204 }, { status: 500, body: {} }));
    await expect(g4EventsGate(ctx, deps)).rejects.toThrow(
      'G4 events capture: capture answered HTTP 500',
    );
  });
});
