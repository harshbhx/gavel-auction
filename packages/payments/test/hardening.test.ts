import { describe, expect, it } from 'vitest';
import { PayPalError } from '../src/errors.js';
import { redactString } from '../src/log.js';
import { classifyError } from '../src/errorMap.js';
import { OrdersClient } from '../src/orders.js';
import { TokenManager } from '../src/oauth.js';
import { DEFAULT_LEASE_TTL_MS, SettlementError, validatePlan } from '../src/saga/create.js';
import {
  MemoryHoldStore,
  MemoryJournalStore,
  MemoryWebhookEventStore,
} from '../src/stores/memory.js';
import { Transport } from '../src/transport.js';
import { newJournal } from '../src/saga/create.js';
import { WebhookHandler } from '../src/webhooks/handler.js';
import type { SettlementPlan } from '../src/types.js';

const plan = (): SettlementPlan => ({
  auctionId: 'a1',
  reserveCents: 100,
  candidates: [{ bidderId: 'b1', priceCents: 500 }],
  holds: { b1: { holdId: 'h1', authId: 'A1', ceilingCents: 1000, createdAtMs: 1 } },
});

describe('authorizeOrder status (R2-03)', () => {
  const orders = (status: string): OrdersClient =>
    new OrdersClient({
      fake: true,
      auth: {
        send: async () => ({
          status: 201,
          headers: {},
          attempts: 1,
          text: JSON.stringify({
            id: 'O1',
            purchase_units: [
              {
                payments: {
                  authorizations: [
                    { id: 'A1', status, amount: { currency_code: 'USD', value: '10.00' } },
                  ],
                },
              },
            ],
          }),
        }),
      },
    });

  it('accepts CREATED', async () => {
    expect(await orders('CREATED').authorizeOrder('O1', 'r')).toEqual({
      authId: 'A1',
      amountCents: 1000,
    });
  });

  it('DENIED is a definite failure and PENDING an unknown outcome', async () => {
    const denied = await orders('DENIED')
      .authorizeOrder('O1', 'r')
      .catch((e: unknown) => e);
    expect(denied).toBeInstanceOf(PayPalError);
    expect((denied as PayPalError).outcome).toBe('definite');
    const pending = await orders('PENDING')
      .authorizeOrder('O1', 'r')
      .catch((e: unknown) => e);
    expect((pending as PayPalError).outcome).toBe('unknown');
  });
});

describe('webhook intake (R2-04)', () => {
  const base = {
    verifier: { verifyWebhook: async () => ({ ok: true as const }) },
    audit: { append: async () => undefined },
    clock: { nowMs: () => 1 },
  };

  it('answers 503 when the intake callback throws, so PayPal redelivers', async () => {
    const h = new WebhookHandler({
      ...base,
      onVerified: async () => {
        throw new Error('disk full');
      },
    });
    expect(await h.handle(Buffer.from('{}'), {})).toEqual({ status: 503 });
  });

  it('answers 503 when no intake callback is wired', async () => {
    const h = new WebhookHandler({ ...base } as unknown as ConstructorParameters<
      typeof WebhookHandler
    >[0]);
    expect(await h.handle(Buffer.from('{}'), {})).toEqual({ status: 503 });
  });
});

describe('token failure is not an unknown money outcome (R2-06)', () => {
  it('rewrites a failed token fetch as a definite auth_unavailable', async () => {
    const transport = new Transport({
      fetch: async (url) => {
        if (url.endsWith('/token')) {
          return { status: 503, headers: new Headers(), text: async () => '{}' };
        }
        throw new Error('the business call must not be sent');
      },
      sleep: async () => undefined,
      maxAttempts: 1,
    });
    const m = new TokenManager({
      transport,
      baseUrl: 'http://127.0.0.1:4010',
      clientId: 'id',
      clientSecret: 'secret-value-x',
    });
    const err = await m
      .send({ method: 'POST', path: '/v2/payments/authorizations/A/capture', op: 'capture' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PayPalError);
    expect((err as PayPalError).kind).toBe('auth_unavailable');
    expect((err as PayPalError).outcome).toBe('definite');
  });
});

describe('stores roll back a failed write (R2-07)', () => {
  const boom = (): never => {
    throw new Error('ENOSPC');
  };

  it('journal create and save leave memory as the disk was', async () => {
    let fail = false;
    const store = new MemoryJournalStore(undefined, () => {
      if (fail) boom();
    });
    const j = newJournal(plan());
    fail = true;
    await expect(store.create(j)).rejects.toThrow('ENOSPC');
    expect(await store.load('a1')).toBeNull();
    fail = false;
    await store.create(j);
    fail = true;
    await expect(store.save({ ...j, version: 1 }, 0)).rejects.toThrow('ENOSPC');
    expect((await store.load('a1'))?.version).toBe(0);
  });

  it('lease, webhook and hold changes are rolled back too', async () => {
    let fail = false;
    const onChange = (): void => {
      if (fail) boom();
    };
    const journals = new MemoryJournalStore(undefined, onChange);
    fail = true;
    await expect(journals.acquireLease('a1', 'r1', 1000, 0)).rejects.toThrow('ENOSPC');
    fail = false;
    expect(await journals.acquireLease('a1', 'r2', 1000, 0)).toBe(true);

    const hooks = new MemoryWebhookEventStore(undefined, onChange);
    const ev = { id: 'E1', rawBody: '{}', receivedAtMs: 1 } as Parameters<
      MemoryWebhookEventStore['insertIfAbsent']
    >[0];
    fail = true;
    await expect(hooks.insertIfAbsent(ev)).rejects.toThrow('ENOSPC');
    fail = false;
    expect(await hooks.insertIfAbsent(ev)).toBe(true);

    const holds = new MemoryHoldStore(undefined, onChange);
    const h = { holdId: 'h1', auctionId: 'a1', bidderId: 'b1', createdAtMs: 1 } as Parameters<
      MemoryHoldStore['put']
    >[0];
    fail = true;
    await expect(holds.put(h)).rejects.toThrow('ENOSPC');
    expect(await holds.get('h1')).toBeNull();
  });
});

describe('log redaction is bounded (R2-10)', () => {
  it('redacts a long letter run in linear time', () => {
    const t0 = Date.now();
    redactString('token'.repeat(4000));
    expect(Date.now() - t0).toBeLessThan(500);
  });

  it('still redacts a keyed value', () => {
    expect(redactString('{"access_token":"abc123"}')).not.toContain('abc123');
  });

  it('caps a long PayPal message', () => {
    const err = classifyError(
      400,
      {},
      JSON.stringify({ name: 'INVALID_REQUEST', message: 'x'.repeat(5000) }),
    );
    expect(err.message.length).toBeLessThanOrEqual(210);
  });
});

describe('plan shape (R2-13)', () => {
  it('rejects a plan with malformed lists as plan_invalid, not a TypeError', () => {
    const bad = (p: unknown): unknown => {
      try {
        validatePlan(p as SettlementPlan);
      } catch (e) {
        return e;
      }
      return undefined;
    };
    expect(bad({ ...plan(), candidates: null })).toBeInstanceOf(SettlementError);
    expect(bad({ ...plan(), holds: null })).toBeInstanceOf(SettlementError);
    expect(bad({ ...plan(), holds: [] })).toBeInstanceOf(SettlementError);
    const p = plan();
    expect(
      bad({ ...p, holds: { b1: { ...p.holds['b1'], createdAtMs: Number.NaN } } }),
    ).toBeInstanceOf(SettlementError);
    expect(bad(plan())).toBeUndefined();
  });
});

describe('lease ttl (R2-05)', () => {
  it('outlives one retried money call with a token refresh', () => {
    const worstSend = 4 * 10_000 + 3 * 30_000;
    expect(DEFAULT_LEASE_TTL_MS).toBeGreaterThan(2 * worstSend);
  });
});
