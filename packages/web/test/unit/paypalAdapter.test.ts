// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ApproveHoldRequest, CreateHoldRequest } from '@gavel/shared';
import { describe, expect, it, vi } from 'vitest';
import type { FetchLike } from '../../src/payments/fakeAdapter';
import {
  PayPalV6Adapter,
  type PayPalSdkV6,
  type PayPalSessionCallbacks,
} from '../../src/payments/paypalV6Adapter';
import type { ApprovalRequest, ApprovalState } from '../../src/payments/port';

const req: ApprovalRequest = {
  roomId: 'room 1',
  bidderId: 'b1',
  ceilingCents: 50_000,
  clientRegistrationId: 'reg-one',
};

type Script = (cb: PayPalSessionCallbacks) => void;

/** A stub SDK. `script` plays the buyer's actions once the session starts. */
function stubSdk(script: Script, opts: { startRejects?: boolean } = {}) {
  const calls: string[] = [];
  const sdk: PayPalSdkV6 = {
    createInstance: (o) => {
      calls.push(`createInstance:${o.clientId}:${o.clientToken ?? ''}`);
      return Promise.resolve({
        createOneTimePaymentSession: (cb) => ({
          start: () => {
            calls.push('start');
            if (opts.startRejects === true) return Promise.reject(new Error('blocked'));
            queueMicrotask(() => script(cb));
            return Promise.resolve();
          },
          cancel: () => {
            calls.push('cancel');
            cb.onCancel();
          },
        }),
      });
    },
  };
  return { sdk, calls };
}

function fakeFetch(
  orderBody: unknown = { holdId: 'hold-ABC123', orderId: 'ord-1', clientToken: 'ct' },
  holdOk = true,
) {
  const urls: string[] = [];
  const bodies: unknown[] = [];
  const fetch: FetchLike = (url, init) => {
    urls.push(`${init.method} ${url}`);
    if (init.body !== undefined) bodies.push(JSON.parse(init.body));
    if (init.method === 'DELETE') {
      return Promise.resolve({ ok: true, status: 204, json: () => Promise.resolve(null) });
    }
    if (url.endsWith('/api/holds')) {
      return Promise.resolve({
        ok: orderBody !== null,
        status: 200,
        json: () => Promise.resolve(orderBody),
      });
    }
    return Promise.resolve({
      ok: holdOk,
      status: 200,
      json: () => Promise.resolve({ holdId: 'hold-ABC123', status: 'HELD', ceilingCents: 50_000 }),
    });
  };
  return { fetch, urls, bodies };
}

function make(script: Script, orderBody?: unknown, holdOk = true, startRejects = false) {
  const { sdk, calls } = stubSdk(script, { startRejects });
  const net = fakeFetch(orderBody, holdOk);
  const loadSdk = vi.fn(() => Promise.resolve(sdk));
  const adapter = new PayPalV6Adapter({
    apiBase: 'http://api',
    clientId: 'client-1',
    loadSdk,
    fetch: net.fetch,
  });
  const states: ApprovalState[] = [];
  return { adapter, calls, loadSdk, states, urls: net.urls, bodies: net.bodies };
}

describe('PayPalV6Adapter (stubbed SDK)', () => {
  it('walks preparing, awaiting_buyer, confirming, held and returns the hold suffix', async () => {
    const t = make((cb) => cb.onApprove({ orderId: 'ord-1' }));
    const result = await t.adapter.start(req, (s) => t.states.push(s));
    expect(t.states).toEqual(['preparing', 'awaiting_buyer', 'confirming', 'held']);
    expect(result).toMatchObject({ state: 'held', holdIdSuffix: 'ABC123' });
    expect(t.urls).toEqual([
      'POST http://api/api/holds',
      'POST http://api/api/holds/hold-ABC123/approve',
    ]);
    expect(t.bodies).toEqual([{ auctionId: 'room 1', ceilingCents: 50_000 }, { orderId: 'ord-1' }]);
    expect(t.calls[0]).toBe('createInstance:client-1:ct');
  });

  it('sends bodies the shared hold contract accepts and names no bidder (WEB-RT-03)', async () => {
    const t = make((cb) => cb.onApprove({ orderId: 'ord-1' }));
    await t.adapter.start(req, () => {});
    expect(CreateHoldRequest.safeParse(t.bodies[0]).success).toBe(true);
    expect(ApproveHoldRequest.safeParse(t.bodies[1]).success).toBe(true);
  });

  it('loads the SDK only on the approval step', async () => {
    const failed = make(() => {}, null);
    await failed.adapter.start(req, () => {});
    expect(failed.loadSdk).not.toHaveBeenCalled();

    const t = make((cb) => cb.onApprove({ orderId: 'ord-1' }));
    expect(t.loadSdk).not.toHaveBeenCalled();
    await t.adapter.start(req, () => {});
    expect(t.loadSdk).toHaveBeenCalledTimes(1);
  });

  it('reports cancelled when the buyer closes the popup', async () => {
    const t = make((cb) => cb.onCancel());
    const result = await t.adapter.start(req, (s) => t.states.push(s));
    expect(result.state).toBe('cancelled');
    expect(t.states).toEqual(['preparing', 'awaiting_buyer', 'cancelled']);
    expect(t.urls).toEqual([
      'POST http://api/api/holds',
      'DELETE http://api/api/holds/hold-ABC123',
    ]);
  });

  it('reports declined when the SDK says the instrument was declined', async () => {
    const t = make((cb) => cb.onError({ code: 'INSTRUMENT_DECLINED' }));
    const result = await t.adapter.start(req, () => {});
    expect(result).toMatchObject({ state: 'declined', errorCode: 'INSTRUMENT_DECLINED' });
  });

  it('cancel() abandons the attempt while the buyer is in the window', async () => {
    const t = make(() => {});
    const pending = t.adapter.start(req, () => {});
    await vi.waitFor(() => expect(t.calls).toContain('start'));
    t.adapter.cancel();
    expect((await pending).state).toBe('cancelled');
  });

  it('reports an error when the popup fails and there is the hold is dropped', async () => {
    const t = make(() => {}, undefined, true, true);
    const result = await t.adapter.start(req, () => {});
    expect(result).toMatchObject({ state: 'error', errorCode: 'popup_failed' });
    expect(t.urls).toContain('DELETE http://api/api/holds/hold-ABC123');
  });

  it('does not confirm an order the attempt did not create (WEB-RT-17)', async () => {
    const t = make((cb) => cb.onApprove({ orderId: 'someone-elses-order' }));
    const result = await t.adapter.start(req, () => {});
    expect(result).toMatchObject({ state: 'error', errorCode: 'order_mismatch' });
    expect(t.urls.some((u) => u.endsWith('/approve'))).toBe(false);
  });

  it('reports order_failed and hold_failed', async () => {
    const noOrder = make(() => {}, null);
    expect((await noOrder.adapter.start(req, () => {})).errorCode).toBe('order_failed');
    const noHold = make((cb) => cb.onApprove({ orderId: 'ord-1' }), undefined, false);
    expect((await noHold.adapter.start(req, () => {})).errorCode).toBe('hold_failed');
  });

  it('never puts the order id or tokens in an error code', async () => {
    const t = make(() => {}, undefined, true, true);
    const result = await t.adapter.start(req, () => {});
    expect(JSON.stringify(result)).not.toContain('ord-1');
  });
});

describe('import boundary (T-WEB-022)', () => {
  const srcDir = fileURLToPath(new URL('../../src', import.meta.url));

  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = `${dir}/${name}`;
      return statSync(full).isDirectory() ? files(full) : [full];
    });
  }

  it('lets only paypalV6Adapter.ts reference the PayPal SDK', () => {
    const offenders = files(srcDir)
      .filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith('payments/paypalV6Adapter.ts'))
      .filter((f) => /@paypal\/|paypal\.com\/web-sdk/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('lets only the adapter and the approval factory import the adapter module', () => {
    const importers = files(srcDir)
      .filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith('payments/paypalV6Adapter.ts'))
      .filter((f) => /paypalV6Adapter/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(srcDir.length + 1));
    expect(importers).toEqual(['payments/useApproval.ts']);
  });

  it('never names the live PayPal host in source (WEB-RT-03)', () => {
    const offenders = files(srcDir)
      .filter((f) => /\.(ts|tsx)$/.test(f))
      .filter((f) => /\/\/(www\.|api-m\.)?paypal\.com/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});

describe('PayPalV6Adapter request timeouts (R-WEB-045)', () => {
  const hang: FetchLike = () => new Promise(() => {});

  it('gives up on an order request that never answers and lets the buyer retry', async () => {
    const adapter = new PayPalV6Adapter({
      apiBase: 'http://api',
      clientId: 'c',
      fetch: hang,
      requestTimeoutMs: 20,
    });
    const states: ApprovalState[] = [];
    const result = await adapter.start(req, (s) => states.push(s));
    expect(result).toMatchObject({ state: 'error', errorCode: 'order_timeout' });
    expect(states).toEqual(['preparing', 'error']);
  });

  it('cancel() ends a pending request instead of doing nothing', async () => {
    const adapter = new PayPalV6Adapter({ apiBase: 'http://api', clientId: 'c', fetch: hang });
    const pending = adapter.start(req, () => {});
    adapter.cancel();
    expect((await pending).state).toBe('cancelled');
  });

  it('reports hold_timeout when the hold request stalls after approval', async () => {
    const { sdk } = stubSdk((cb) => cb.onApprove({ orderId: 'ord-1' }));
    const fetch: FetchLike = (url) =>
      url.endsWith('/api/holds')
        ? Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ holdId: 'hold-ABC123', orderId: 'ord-1' }),
          })
        : new Promise(() => {});
    const adapter = new PayPalV6Adapter({
      apiBase: 'http://api',
      clientId: 'c',
      loadSdk: () => Promise.resolve(sdk),
      fetch,
      requestTimeoutMs: 20,
    });
    const result = await adapter.start(req, () => {});
    expect(result).toMatchObject({ state: 'error', errorCode: 'hold_timeout' });
  });
});
