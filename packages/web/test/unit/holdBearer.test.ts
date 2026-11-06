import { describe, expect, it } from 'vitest';
import { FakeApprovalAdapter, type FetchLike } from '../../src/payments/fakeAdapter';
import type { ApprovalRequest } from '../../src/payments/port';

const req: ApprovalRequest = {
  roomId: 'room-1',
  bidderId: 'b-1',
  ceilingCents: 50_000,
  clientRegistrationId: 'reg-0001-abcd',
};

function recorder(): { fetch: FetchLike; seen: Array<Record<string, string>> } {
  const seen: Array<Record<string, string>> = [];
  const fetch: FetchLike = (url, init) => {
    seen.push(init.headers);
    const body = url.endsWith('/approve')
      ? { holdId: 'hold-xxa1b2c3', status: 'HELD', ceilingCents: 50_000 }
      : { holdId: 'hold-xxa1b2c3', orderId: 'ord-1' };
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  };
  return { fetch, seen };
}

describe('hold requests carry the session bearer', () => {
  it('sends the authorization header on create and approve', async () => {
    const { fetch, seen } = recorder();
    const a = new FakeApprovalAdapter({
      apiBase: 'http://api.test',
      token: 'plainly-fake-session',
      fetch,
      sleep: () => Promise.resolve(),
    });
    await a.start(req, () => undefined);
    expect(seen).toHaveLength(2);
    for (const h of seen) expect(h['authorization']).toBe('Bearer plainly-fake-session');
  });

  it('sends no authorization header without a session', async () => {
    const { fetch, seen } = recorder();
    const a = new FakeApprovalAdapter({
      apiBase: 'http://api.test',
      fetch,
      sleep: () => Promise.resolve(),
    });
    await a.start(req, () => undefined);
    for (const h of seen) expect(h['authorization']).toBeUndefined();
  });
});
