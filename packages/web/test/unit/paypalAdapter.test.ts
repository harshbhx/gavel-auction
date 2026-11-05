// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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
  orderBody: unknown = { orderId: 'ord-1', clientToken: 'ct' },
  holdOk = true,
  holdBody: Record<string, unknown> = {
    holdIdSuffix: 'ABC123',
    ceilingCents: 50_000,
    state: 'HELD',
  },
) {
  const urls: string[] = [];
  const fetch: FetchLike = (url) => {
    urls.push(url);
    if (url.endsWith('/orders')) {
      return Promise.resolve({
        ok: orderBody !== null,
        status: 200,
        json: () => Promise.resolve(orderBody),
      });
    }
    return Promise.resolve({
      ok: holdOk,
      status: 200,
      json: () => Promise.resolve(holdBody),
    });
  };
  return { fetch, urls };
}

function make(
  script: Script,
  orderBody?: unknown,
  holdOk = true,
  startRejects = false,
  holdBody?: Record<string, unknown>,
) {
  const { sdk, calls } = stubSdk(script, { startRejects });
  const net = fakeFetch(orderBody, holdOk, holdBody);
  const loadSdk = vi.fn(() => Promise.resolve(sdk));
  const redirect = vi.fn();
  const adapter = new PayPalV6Adapter({
    apiBase: 'http://api',
    clientId: 'client-1',
    loadSdk,
    fetch: net.fetch,
    redirect,
  });
  const states: ApprovalState[] = [];
  return { adapter, calls, loadSdk, redirect, states, urls: net.urls };
}

describe('PayPalV6Adapter (stubbed SDK)', () => {
  it('walks preparing, awaiting_buyer, confirming, held and returns the hold suffix', async () => {
    const t = make((cb) => cb.onApprove({ orderId: 'ord-1' }));
    const result = await t.adapter.start(req, (s) => t.states.push(s));
    expect(t.states).toEqual(['preparing', 'awaiting_buyer', 'confirming', 'held']);
    expect(result).toMatchObject({ state: 'held', holdIdSuffix: 'ABC123' });
    expect(t.urls).toEqual([
      'http://api/api/rooms/room%201/orders',
      'http://api/api/rooms/room%201/holds',
    ]);
    expect(t.calls[0]).toBe('createInstance:client-1:ct');
  });

  it('returns the amount the server confirmed (WEB-R2-10)', async () => {
    const t = make((cb) => cb.onApprove({ orderId: 'ord-1' }));
    const result = await t.adapter.start(req, () => {});
    expect(result.ceilingCents).toBe(50_000);
  });

  it('treats a different confirmed amount as an error (WEB-R2-10)', async () => {
    const t = make((cb) => cb.onApprove({ orderId: 'ord-1' }), undefined, true, false, {
      holdIdSuffix: 'ABC123',
      ceilingCents: 20_000,
    });
    const result = await t.adapter.start(req, () => {});
    expect(result).toMatchObject({ state: 'error', errorCode: 'hold_mismatch' });
    expect(result.holdIdSuffix).toBeUndefined();
  });

  it('retries only the confirm step with the approved order id (WEB-R2-08)', async () => {
    const failing = make((cb) => cb.onApprove({ orderId: 'ord-1' }), undefined, false);
    const first = await failing.adapter.start(req, () => {});
    expect(first).toMatchObject({ state: 'error', errorCode: 'hold_failed', orderId: 'ord-1' });

    const retry = make(() => {});
    const second = await retry.adapter.start({ ...req, approvedOrderId: 'ord-1' }, () => {});
    expect(second).toMatchObject({ state: 'held', holdIdSuffix: 'ABC123' });
    expect(retry.urls).toEqual(['http://api/api/rooms/room%201/holds']);
    expect(retry.loadSdk).not.toHaveBeenCalled();
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
    expect(t.urls).toHaveLength(1);
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

  it('cancel() while the SDK is still loading never opens the popup (WEB-R2-06)', async () => {
    const { sdk, calls } = stubSdk(() => {});
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const loadSdk = vi.fn(() => gate.then(() => sdk));
    const adapter = new PayPalV6Adapter({
      apiBase: 'http://api',
      clientId: 'client-1',
      loadSdk,
      fetch: fakeFetch().fetch,
    });
    const pending = adapter.start(req, () => {});
    await vi.waitFor(() => expect(loadSdk).toHaveBeenCalled());
    adapter.cancel();
    release();
    expect((await pending).state).toBe('cancelled');
    expect(calls).not.toContain('start');
  });

  it.each([
    'https://www.paypal.com/checkoutnow?token=ord-1',
    'javascript:alert(1)',
    'https://user:pw@www.sandbox.paypal.com/approve',
    'http://www.sandbox.paypal.com/approve',
    'https://www.sandbox.paypal.com.evil.example/approve',
  ])('refuses the redirect fallback for %s (WEB-R2-09)', async (approveUrl) => {
    const t = make(() => {}, { orderId: 'ord-1', approveUrl }, true, true);
    const result = await t.adapter.start(req, () => {});
    expect(t.redirect).not.toHaveBeenCalled();
    expect(result).toMatchObject({ state: 'error', errorCode: 'popup_failed' });
  });

  it('falls back to redirect approval when the popup fails', async () => {
    const t = make(
      () => {},
      { orderId: 'ord-1', approveUrl: 'https://www.sandbox.paypal.com/approve?token=ord-1' },
      true,
      true,
    );
    const result = await t.adapter.start(req, (s) => t.states.push(s));
    expect(t.redirect).toHaveBeenCalledWith('https://www.sandbox.paypal.com/approve?token=ord-1');
    expect(result.state).toBe('awaiting_buyer');
    expect(result.errorCode).toBe('popup_failed');
  });

  it('falls back to redirect when an SDK error is not a decline', async () => {
    const t = make((cb) => cb.onError({ code: 'AUTHORIZE_NOT_SUPPORTED' }), {
      orderId: 'ord-1',
      approveUrl: 'https://sandbox.paypal.com/approve',
    });
    const result = await t.adapter.start(req, () => {});
    expect(t.redirect).toHaveBeenCalledTimes(1);
    expect(result.errorCode).toBe('AUTHORIZE_NOT_SUPPORTED');
  });

  it('reports an error when the popup fails and there is no approval link', async () => {
    const t = make(() => {}, undefined, true, true);
    const result = await t.adapter.start(req, () => {});
    expect(result).toMatchObject({ state: 'error', errorCode: 'popup_failed' });
    expect(t.redirect).not.toHaveBeenCalled();
  });

  it('does not confirm an order the attempt did not create (WEB-RT-17)', async () => {
    const t = make((cb) => cb.onApprove({ orderId: 'someone-elses-order' }));
    const result = await t.adapter.start(req, () => {});
    expect(result).toMatchObject({ state: 'error', errorCode: 'order_mismatch' });
    expect(t.urls.some((u) => u.endsWith('/holds'))).toBe(false);
  });

  it('reports order_failed and hold_failed', async () => {
    const noOrder = make(() => {}, null);
    expect((await noOrder.adapter.start(req, () => {})).errorCode).toBe('order_failed');
    const noHold = make((cb) => cb.onApprove({ orderId: 'ord-1' }), undefined, false);
    expect((await noHold.adapter.start(req, () => {})).errorCode).toBe('hold_failed');
  });

  it('keeps the payments error code of a failed order and maps hold_exists to held', async () => {
    const withBody = (orderErr: unknown, holdErr: unknown) => {
      const { sdk } = stubSdk((cb) => cb.onApprove({ orderId: 'ord-1' }));
      const fetch: FetchLike = (url) => {
        const orders = url.endsWith('/orders');
        const err = orders ? orderErr : holdErr;
        return Promise.resolve({
          ok: err === null,
          status: err === null ? 200 : 503,
          json: () =>
            Promise.resolve(err ?? (orders ? { orderId: 'ord-1' } : { holdIdSuffix: 'Z' })),
        });
      };
      return new PayPalV6Adapter({
        apiBase: 'http://api',
        clientId: 'c',
        loadSdk: () => Promise.resolve(sdk),
        fetch,
        redirect: () => {},
      });
    };
    const killed = await withBody({ error: 'kill_switch_engaged' }, null).start(req, () => {});
    expect(killed).toMatchObject({ state: 'error', errorCode: 'kill_switch_engaged' });
    const capped = await withBody({ error: 'ceiling_out_of_range' }, null).start(req, () => {});
    expect(capped.errorCode).toBe('ceiling_out_of_range');
    const exists = await withBody(null, { error: 'hold_exists' }).start(req, () => {});
    expect(exists.state).toBe('held');
    const odd = await withBody({ error: 'nonsense' }, null).start(req, () => {});
    expect(odd.errorCode).toBe('order_failed');
  });

  it('completes a redirect approval on the return route', async () => {
    const t = make(() => {});
    const result = await t.adapter.completeRedirect('room 1', 'ord-1', 'reg-one', (s) =>
      t.states.push(s),
    );
    expect(result).toMatchObject({ state: 'held', holdIdSuffix: 'ABC123' });
    expect(t.states).toEqual(['confirming', 'held']);
    expect(t.loadSdk).not.toHaveBeenCalled();
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
      url.endsWith('/orders')
        ? Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ orderId: 'ord-1' }),
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
