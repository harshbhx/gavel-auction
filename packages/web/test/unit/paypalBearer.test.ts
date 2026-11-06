import { describe, expect, it } from 'vitest';
import type { FetchLike } from '../../src/payments/fakeAdapter';
import { PayPalV6Adapter, type PayPalSdkV6 } from '../../src/payments/paypalV6Adapter';
import type { ApprovalRequest } from '../../src/payments/port';

const req: ApprovalRequest = {
  roomId: 'room-1',
  bidderId: 'b-1',
  ceilingCents: 50_000,
  clientRegistrationId: 'reg-0001-abcd',
};

interface Seen {
  method: string | undefined;
  url: string;
  authorization: string | undefined;
}

function run(buyer: 'approve' | 'cancel', token: string | undefined) {
  const seen: Seen[] = [];
  const fetch: FetchLike = (url, init) => {
    seen.push({ method: init.method, url, authorization: init.headers['authorization'] });
    if (init.method === 'DELETE') {
      return Promise.resolve({ ok: true, status: 204, json: () => Promise.resolve(null) });
    }
    const body = url.endsWith('/approve')
      ? { holdId: 'hold-ABC123', status: 'HELD', ceilingCents: 50_000 }
      : { holdId: 'hold-ABC123', orderId: 'ord-1' };
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  };
  const sdk: PayPalSdkV6 = {
    createInstance: () =>
      Promise.resolve({
        createOneTimePaymentSession: (cb) => ({
          start: () => {
            queueMicrotask(() => {
              if (buyer === 'approve') cb.onApprove({ orderId: 'ord-1' });
              else cb.onCancel();
            });
            return Promise.resolve();
          },
          cancel: () => cb.onCancel(),
        }),
      }),
  };
  const adapter = new PayPalV6Adapter({
    apiBase: 'http://api.test',
    clientId: 'client-1',
    ...(token === undefined ? {} : { token }),
    loadSdk: () => Promise.resolve(sdk),
    fetch,
  });
  return { adapter, seen };
}

describe('PayPal adapter hold requests carry the session bearer', () => {
  it('sends it on create and approve', async () => {
    const { adapter, seen } = run('approve', 'plainly-fake-session');
    const result = await adapter.start(req, () => undefined);
    expect(result.state).toBe('held');
    expect(seen.map((s) => `${s.method} ${s.url}`)).toEqual([
      'POST http://api.test/api/holds',
      'POST http://api.test/api/holds/hold-ABC123/approve',
    ]);
    for (const s of seen) expect(s.authorization).toBe('Bearer plainly-fake-session');
  });

  it('sends it on the abandon request when the buyer walks away', async () => {
    const { adapter, seen } = run('cancel', 'plainly-fake-session');
    const result = await adapter.start(req, () => undefined);
    expect(result.state).toBe('cancelled');
    const abandon = seen.find((s) => s.method === 'DELETE');
    expect(abandon?.url).toBe('http://api.test/api/holds/hold-ABC123');
    expect(abandon?.authorization).toBe('Bearer plainly-fake-session');
  });

  it('sends no authorization header without a session', async () => {
    const { adapter, seen } = run('approve', undefined);
    await adapter.start(req, () => undefined);
    expect(seen).toHaveLength(2);
    for (const s of seen) expect(s.authorization).toBeUndefined();
  });
});
