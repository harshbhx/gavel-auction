import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  InMemoryLedgerStore,
  genesisHead,
  sealBatch,
  verifyChain,
  type LedgerEvent,
  type Ulid,
} from '@gavel/engine';
import { describe, expect, it } from 'vitest';
import { createExportHandler, parseNdjson, redactSecrets, toNdjson } from '../src/admin/export';

const ID = 'A1' as Ulid;

async function seeded(): Promise<InMemoryLedgerStore> {
  const store = new InMemoryLedgerStore();
  const events = [
    { type: 'AUCTION_CREATED', payload: { note: 'x' } },
    { type: 'AUCTION_CLOSED', payload: { headHash: 'h' } },
  ] as unknown as LedgerEvent[];
  await store.append(ID, sealBatch(events, genesisHead(ID), 1000, null), 0);
  return store;
}

async function call(
  handler: ReturnType<typeof createExportHandler>,
  url: string,
  key?: string,
): Promise<{ status: number; body: string }> {
  const req = {
    method: 'GET',
    url,
    headers: key === undefined ? {} : { 'x-admin-key': key },
  } as unknown as IncomingMessage;
  return new Promise((resolve) => {
    let status = 0;
    const res = {
      setHeader: () => undefined,
      writeHead: (s: number) => {
        status = s;
      },
      end: (b: string) => resolve({ status, body: b }),
    } as unknown as ServerResponse;
    handler(req, res);
  });
}

describe('admin export (T-QA-085)', () => {
  it('requires the admin token', async () => {
    const h = createExportHandler({ adminKey: 'k', ledger: await seeded() });
    expect((await call(h, '/admin/export?auctionId=A1')).status).toBe(401);
    expect((await call(h, '/admin/export?auctionId=A1', 'wrong')).status).toBe(401);
  });

  it('rejects a bad auction id', async () => {
    const h = createExportHandler({ adminKey: 'k', ledger: await seeded() });
    expect((await call(h, '/admin/export?auctionId=a/b', 'k')).status).toBe(400);
  });

  it('accepts the spec query name and answers 404 for an unknown auction (R12-S12)', async () => {
    const h = createExportHandler({ adminKey: 'k', ledger: await seeded() });
    expect((await call(h, '/admin/export?auction=A1', 'k')).status).toBe(200);
    expect((await call(h, '/admin/export?auction=NOPE', 'k')).status).toBe(404);
  });

  it('verifyChain accepts the export', async () => {
    const h = createExportHandler({ adminKey: 'k', ledger: await seeded() });
    const out = await call(h, '/admin/export?auctionId=A1', 'k');
    expect(out.status).toBe(200);
    const parsed = parseNdjson(out.body);
    expect(parsed).not.toBeNull();
    const { entries, head } = parsed ?? { entries: [], head: null };
    expect(head).not.toBeNull();
    expect(verifyChain(entries, head ? { expectedHead: head } : {}).ok).toBe(true);
  });

  it('rejects a truncated export', async () => {
    const store = await seeded();
    const all = await store.read(ID, 1);
    const parsed = parseNdjson(toNdjson(all));
    const head = parsed?.head;
    expect(head).toBeTruthy();
    const short = all.slice(0, 1);
    expect(verifyChain(short, head ? { expectedHead: head } : {}).ok).toBe(false);
  });

  it('lists every stored auction id, not only loaded rooms', async () => {
    const h = createExportHandler({
      adminKey: 'k',
      ledger: await seeded(),
      listAuctions: async () => ['B2', 'A1'],
    });
    expect((await call(h, '/admin/export?list=1')).status).toBe(401);
    const out = await call(h, '/admin/export?list=1', 'k');
    expect(out.status).toBe(200);
    expect(JSON.parse(out.body)).toEqual({ auctions: ['A1', 'B2'] });
  });
});

describe('admin export of payment state (HRD-79)', () => {
  const journal = {
    auctionId: 'A1',
    version: 3,
    state: 'SETTLING',
    holds: { h1: { holdId: 'h1', authId: 'AUTH-1', ceilingCents: 5000 } },
    clientSecret: 'must-not-leave',
  };
  const hold = {
    holdId: 'h1',
    auctionId: 'A1',
    bidderId: 'b1',
    authId: 'AUTH-1',
    accessToken: 'tok',
    password: 'pw',
  };
  async function make(): Promise<ReturnType<typeof createExportHandler>> {
    return createExportHandler({
      adminKey: 'k',
      ledger: await seeded(),
      payments: {
        journal: async (id) => (id === 'A1' ? journal : null),
        holds: async () => [hold],
        webhooks: async () => [
          {
            id: 'WH-2',
            eventType: 'PAYMENT.AUTHORIZATION.VOIDED',
            receivedAtMs: 2,
            body: '{"secret":"x"}',
          },
          {
            id: 'WH-1',
            eventType: 'CHECKOUT.ORDER.APPROVED',
            receivedAtMs: 1,
            result: 'ok',
            body: '{}',
          },
        ],
        kill: async () => ({ engaged: true, reason: 'drill' }),
      },
      roomLog: async (_id, from, limit) =>
        [
          { seq: 1, type: 'bid', inviteToken: 'abc' },
          { seq: 2, type: 'close' },
        ].slice(from - 1, from - 1 + limit),
    });
  }

  it('requires the admin key and a known kind', async () => {
    const h = await make();
    expect((await call(h, '/admin/export?kind=payments&auction=A1')).status).toBe(401);
    expect((await call(h, '/admin/export?kind=nope&auction=A1', 'k')).status).toBe(400);
    expect((await call(h, '/admin/export?kind=payments&auction=a/b', 'k')).status).toBe(400);
  });

  it('exports the journal and holds of an auction with the shape a restore needs', async () => {
    const out = await call(await make(), '/admin/export?kind=payments&auction=A1', 'k');
    expect(out.status).toBe(200);
    const body = JSON.parse(out.body) as {
      auctionId: string;
      journal: { holds: Record<string, { authId: string }> };
      holds: { holdId: string; authId: string }[];
    };
    expect(body.auctionId).toBe('A1');
    expect(body.journal.holds.h1?.authId).toBe('AUTH-1');
    expect(body.holds[0]).toMatchObject({ holdId: 'h1', authId: 'AUTH-1' });
  });

  it('exports webhook ids sorted, without bodies, and the kill state', async () => {
    const out = await call(await make(), '/admin/export?kind=payments-global', 'k');
    const body = JSON.parse(out.body) as {
      webhooks: Record<string, unknown>[];
      kill: { engaged: boolean };
    };
    expect(body.webhooks.map((w) => w.id)).toEqual(['WH-1', 'WH-2']);
    expect(body.webhooks[0]).toMatchObject({ result: 'ok', bodyBytes: 2 });
    expect(body.webhooks.every((w) => !('body' in w))).toBe(true);
    expect(body.kill.engaged).toBe(true);
  });

  it('exports the room log as NDJSON ending with a count line', async () => {
    const out = await call(await make(), '/admin/export?kind=roomlog&auction=A1', 'k');
    const lines = out.body
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(lines).toHaveLength(3);
    expect(lines[2]).toEqual({ end: { count: 2, lastSeq: 2 } });
  });

  it('leaks no secret, token or password in any payment export', async () => {
    const h = await make();
    for (const url of [
      '/admin/export?kind=payments&auction=A1',
      '/admin/export?kind=payments-global',
      '/admin/export?kind=roomlog&auction=A1',
    ]) {
      const { body } = await call(h, url, 'k');
      for (const leak of ['must-not-leave', '"tok"', '"pw"', 'abc', '{"secret"']) {
        expect(body).not.toContain(leak);
      }
      expect(body).not.toMatch(/clientSecret":"(?!\[redacted\])/);
    }
  });

  it('redactSecrets replaces nested secret-looking keys only', () => {
    expect(
      redactSecrets({ a: { client_secret: 's', authId: 'x' }, l: [{ Password: 'p' }] }),
    ).toEqual({
      a: { client_secret: '[redacted]', authId: 'x' },
      l: [{ Password: '[redacted]' }],
    });
  });

  it('redactSecrets also covers webhook signatures, session ids and emails', () => {
    expect(
      redactSecrets({
        'paypal-transmission-sig': 'g',
        payerEmail: 'e',
        sessionId: 'i',
        holdId: 'h1',
        orderId: 'O-1',
      }),
    ).toEqual({
      'paypal-transmission-sig': '[redacted]',
      payerEmail: '[redacted]',
      sessionId: '[redacted]',
      holdId: 'h1',
      orderId: 'O-1',
    });
  });
});
