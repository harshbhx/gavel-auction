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
  clientRegistrationId: 'reg-12345678',
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

function fakeFetch(orderBody: unknown = { orderId: 'ord-1', clientToken: 'ct' }, holdOk = true) {
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
      json: () => Promise.resolve({ holdIdSuffix: 'ABC123', state: 'HELD' }),
    });
  };
  return { fetch, urls };
}

function make(script: Script, orderBody?: unknown, holdOk = true, startRejects = false) {
  const { sdk, calls } = stubSdk(script, { startRejects });
  const net = fakeFetch(orderBody, holdOk);
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

  it('falls back to redirect approval when the popup fails', async () => {
    const t = make(
      () => {},
      { orderId: 'ord-1', approveUrl: 'https://paypal.example/approve?token=ord-1' },
      true,
      true,
    );
    const result = await t.adapter.start(req, (s) => t.states.push(s));
    expect(t.redirect).toHaveBeenCalledWith('https://paypal.example/approve?token=ord-1');
    expect(result.state).toBe('awaiting_buyer');
    expect(result.errorCode).toBe('popup_failed');
  });

  it('falls back to redirect when an SDK error is not a decline', async () => {
    const t = make((cb) => cb.onError({ code: 'AUTHORIZE_NOT_SUPPORTED' }), {
      orderId: 'ord-1',
      approveUrl: 'https://paypal.example/approve',
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

  it('reports order_failed and hold_failed', async () => {
    const noOrder = make(() => {}, null);
    expect((await noOrder.adapter.start(req, () => {})).errorCode).toBe('order_failed');
    const noHold = make((cb) => cb.onApprove({ orderId: 'ord-1' }), undefined, false);
    expect((await noHold.adapter.start(req, () => {})).errorCode).toBe('hold_failed');
  });

  it('completes a redirect approval on the return route', async () => {
    const t = make(() => {});
    const result = await t.adapter.completeRedirect('room 1', 'ord-1', 'reg-12345678', (s) =>
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
      .filter((f) =>
        /@paypal\/|paypal\.com\/web-sdk|paypalV6Adapter/.test(readFileSync(f, 'utf8')),
      );
    expect(offenders).toEqual([]);
  });
});
