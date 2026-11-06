import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { composeServer, type Composed } from '../src/boot/compose';
import {
  ADMIN_KEY_HEADER,
  OPS_ACTOR,
  OPS_SETTLEMENT_PATH,
  createOpsSettlementHandler,
  type OpsSettlementDeps,
} from '../src/http/ops';

const KEY = 'test-admin-key-placeholder-0000';

interface Reply {
  status: number;
  body: string;
}

async function call(
  deps: OpsSettlementDeps,
  method: string,
  path: string,
  headers: Record<string, string>,
): Promise<Reply> {
  const reply: Reply = { status: 0, body: '' };
  const req = { method, headers } as unknown as IncomingMessage;
  const res = {
    setHeader() {
      return undefined;
    },
    writeHead(status: number) {
      reply.status = status;
    },
    end(text: string) {
      reply.body = text;
    },
  } as unknown as ServerResponse;
  await createOpsSettlementHandler(deps)(req, res, path);
  return reply;
}

function deps(over: Partial<OpsSettlementDeps> = {}): {
  deps: OpsSettlementDeps;
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    deps: {
      adminKey: KEY,
      exists: async (id) => id === 'a1' || id === 'a2',
      hasSettlement: async (id) => id === 'a1',
      voidAll: async (id, actor) => {
        calls.push(`voidAll ${id} ${actor}`);
        return { status: 'done', holds: { b1: 'voided', b2: 'captured' } };
      },
      releaseReviewHolds: async (id, actor) => {
        calls.push(`release ${id} ${actor}`);
        return 'released';
      },
      ...over,
    },
  };
}

const admin = { [ADMIN_KEY_HEADER]: KEY };

describe('operator release routes (RT4-saga-03, R-PAY-112)', () => {
  it('matches only the two release paths', () => {
    expect(OPS_SETTLEMENT_PATH.test('/ops/auctions/a1/void-all')).toBe(true);
    expect(OPS_SETTLEMENT_PATH.test('/ops/auctions/a1/release-review')).toBe(true);
    expect(OPS_SETTLEMENT_PATH.test('/ops/auctions/a1/capture')).toBe(false);
    expect(OPS_SETTLEMENT_PATH.test('/ops/auctions/a1/b/void-all')).toBe(false);
  });

  it('refuses a missing or wrong key and any method but POST, before touching money', async () => {
    const d = deps();
    expect((await call(d.deps, 'POST', '/ops/auctions/a1/void-all', {})).status).toBe(401);
    const wrong = { [ADMIN_KEY_HEADER]: 'nope' };
    expect((await call(d.deps, 'POST', '/ops/auctions/a1/void-all', wrong)).status).toBe(401);
    expect((await call(d.deps, 'GET', '/ops/auctions/a1/void-all', admin)).status).toBe(405);
    const open = deps({ adminKey: '' });
    const empty = { [ADMIN_KEY_HEADER]: '' };
    expect((await call(open.deps, 'POST', '/ops/auctions/a1/void-all', empty)).status).toBe(401);
    expect([...d.calls, ...open.calls]).toEqual([]);
  });

  it('voids every live hold of a hammered auction with the admin as actor', async () => {
    const d = deps();
    const r = await call(d.deps, 'POST', '/ops/auctions/a1/void-all', admin);
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({
      status: 'done',
      holds: { b1: 'voided', b2: 'captured' },
    });
    expect(d.calls).toEqual([`voidAll a1 ${OPS_ACTOR}`]);
  });

  it('releases the holds a review keeps', async () => {
    const d = deps();
    const r = await call(d.deps, 'POST', '/ops/auctions/a1/release-review', admin);
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ status: 'released' });
    expect(d.calls).toEqual([`release a1 ${OPS_ACTOR}`]);
  });

  it('answers 404 for an unknown auction and 409 before the hammer, a busy run or no review', async () => {
    const d = deps({
      voidAll: async () => ({ status: 'busy' }),
      releaseReviewHolds: async () => 'not_in_review',
    });
    expect((await call(d.deps, 'POST', '/ops/auctions/zz/void-all', admin)).status).toBe(404);
    const bad = await call(d.deps, 'POST', '/ops/auctions/%E0%A4%A/void-all', admin);
    expect(bad.status).toBe(404);
    const early = await call(d.deps, 'POST', '/ops/auctions/a2/void-all', admin);
    expect(early).toEqual({ status: 409, body: '{"error":"no_settlement"}' });
    const busy = await call(d.deps, 'POST', '/ops/auctions/a1/void-all', admin);
    expect(busy).toEqual({ status: 409, body: '{"error":"busy"}' });
    const none = await call(d.deps, 'POST', '/ops/auctions/a1/release-review', admin);
    expect(none).toEqual({ status: 409, body: '{"error":"not_in_review"}' });
  });
});

describe('operator release routes in the composed server', () => {
  const running: Composed[] = [];
  afterEach(async () => {
    for (const app of running.splice(0)) await app.close();
  });

  it('are mounted behind the admin key', async () => {
    const app = await composeServer(
      {
        PUBLIC_URL: 'http://localhost:8080',
        TOKEN_SECRET: 'test-secret-test-secret-test-secret-0123',
        ADMIN_KEY: KEY,
        PAYMENTS: 'fake',
        LOG_LEVEL: 'info',
      },
      { sink: () => undefined },
    );
    running.push(app);
    const url = `http://127.0.0.1:${String(await app.listen(0))}`;
    const target = `${url}/ops/auctions/no-such-auction/void-all`;
    expect((await fetch(target, { method: 'POST' })).status).toBe(401);
    const res = await fetch(target, { method: 'POST', headers: admin });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });
});
