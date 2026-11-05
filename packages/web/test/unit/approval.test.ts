import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FakeApprovalAdapter,
  type FakeFaultMode,
  type FetchLike,
} from '../../src/payments/fakeAdapter';
import { PayPalV6Adapter } from '../../src/payments/paypalV6Adapter';
import type { ApprovalRequest, ApprovalState } from '../../src/payments/port';
import { saveRegistration } from '../../src/payments/registrationStore';
import {
  completeApprovalReturn,
  createApprovalPort,
  resetApprovalMemory,
  resetAttemptMemoryOnly,
  useApproval,
} from '../../src/payments/useApproval';

const req: ApprovalRequest = {
  roomId: 'room-1',
  bidderId: 'b-1',
  ceilingCents: 50_000,
  clientRegistrationId: 'reg-0001-abcd',
};

function mockFetch(): { fetch: FetchLike; calls: string[] } {
  const calls: string[] = [];
  const fetch: FetchLike = (url) => {
    calls.push(url.replace(/^.*\/api/, '/api'));
    const body = url.endsWith('/orders')
      ? { orderId: 'ord-1' }
      : { holdIdSuffix: 'a1b2c3', state: 'HELD' };
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  };
  return { fetch, calls };
}

function adapter(mode: FakeFaultMode, fetch: FetchLike, sleep?: (ms: number) => Promise<void>) {
  return new FakeApprovalAdapter({
    apiBase: 'http://api.test',
    mode,
    fetch,
    sleep: sleep ?? (() => Promise.resolve()),
  });
}

async function run(a: FakeApprovalAdapter): Promise<ApprovalState[]> {
  const seen: ApprovalState[] = [];
  await a.start(req, (s) => seen.push(s));
  return seen;
}

beforeEach(() => {
  resetApprovalMemory();
});

describe('fake adapter state sequences (T-WEB-020)', () => {
  it('ok', async () => {
    expect(await run(adapter('ok', mockFetch().fetch))).toEqual([
      'preparing',
      'awaiting_buyer',
      'confirming',
      'held',
    ]);
  });

  it('ok returns the hold suffix', async () => {
    const result = await adapter('ok', mockFetch().fetch).start(req, () => undefined);
    expect(result).toMatchObject({ state: 'held', holdIdSuffix: 'a1b2c3' });
  });

  it('cancel', async () => {
    expect(await run(adapter('cancel', mockFetch().fetch))).toEqual([
      'preparing',
      'awaiting_buyer',
      'cancelled',
    ]);
  });

  it('decline', async () => {
    expect(await run(adapter('decline', mockFetch().fetch))).toEqual([
      'preparing',
      'awaiting_buyer',
      'declined',
    ]);
  });

  it('error', async () => {
    expect(await run(adapter('error', mockFetch().fetch))).toEqual(['preparing', 'error']);
  });

  it('slow waits 3 s in awaiting_buyer, then holds', async () => {
    vi.useFakeTimers();
    try {
      const a = new FakeApprovalAdapter({
        apiBase: 'http://api.test',
        mode: 'slow',
        fetch: mockFetch().fetch,
      });
      const seen: ApprovalState[] = [];
      const done = a.start(req, (s) => seen.push(s));
      await vi.advanceTimersByTimeAsync(2999);
      expect(seen).toEqual(['preparing', 'awaiting_buyer']);
      await vi.advanceTimersByTimeAsync(1);
      await done;
      expect(seen).toEqual(['preparing', 'awaiting_buyer', 'confirming', 'held']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancel() during the buyer step ends in cancelled', async () => {
    const a = new FakeApprovalAdapter({
      apiBase: 'http://api.test',
      mode: 'slow',
      fetch: mockFetch().fetch,
      sleep: () => new Promise<void>(() => undefined),
    });
    const seen: ApprovalState[] = [];
    const done = a.start(req, (s) => seen.push(s));
    await vi.waitFor(() => expect(seen).toContain('awaiting_buyer'));
    a.cancel();
    expect((await done).state).toBe('cancelled');
  });

  it('turns a failed order request into an error', async () => {
    const failing: FetchLike = () =>
      Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });
    expect(await run(adapter('ok', failing))).toEqual(['preparing', 'error']);
  });
});

describe('port selection (R-WEB-048)', () => {
  it('VITE_PAYMENTS=fake selects the fake adapter', () => {
    const paypal = { apiBase: 'http://api.test', clientId: 'client-1' };
    expect(createApprovalPort('fake', { apiBase: 'http://api.test' }, paypal)).toBeInstanceOf(
      FakeApprovalAdapter,
    );
  });

  it('the default mode uses the real PayPal v6 adapter, not a stub (WEB-RT-02)', async () => {
    const paypal = { apiBase: 'http://api.test', clientId: 'client-1' };
    const port = createApprovalPort('paypal', { apiBase: 'http://api.test' }, paypal);
    expect(port).toBeInstanceOf(PayPalV6Adapter);
    expect(port).not.toBeInstanceOf(FakeApprovalAdapter);
  });
});

describe('useApproval idempotency (T-WEB-021)', () => {
  const orders = (calls: string[]): number => calls.filter((c) => c.endsWith('/orders')).length;

  it('double click sends one POST /orders', async () => {
    const { fetch, calls } = mockFetch();
    const port = adapter('ok', fetch);
    const { result } = renderHook(() =>
      useApproval({ port, roomId: 'room-1', bidderId: 'b-1', makeId: () => 'reg-1' }),
    );
    await act(async () => {
      const first = result.current.start(50_000);
      const second = result.current.start(50_000);
      await Promise.all([first, second]);
    });
    expect(orders(calls)).toBe(1);
    expect(result.current.state).toBe('held');
    expect(result.current.result?.holdIdSuffix).toBe('a1b2c3');
  });

  it('back and forward remounts show the existing hold without a second order', async () => {
    const { fetch, calls } = mockFetch();
    const port = adapter('ok', fetch);
    const options = { port, roomId: 'room-1', bidderId: 'b-1', makeId: () => 'reg-1' };
    const first = renderHook(() => useApproval(options));
    await act(async () => {
      await first.result.current.start(50_000);
    });
    first.unmount();

    const second = renderHook(() => useApproval(options));
    expect(second.result.current.state).toBe('held');
    await act(async () => {
      await second.result.current.start(50_000);
    });
    expect(orders(calls)).toBe(1);
    expect(calls.filter((c) => c.endsWith('/holds'))).toHaveLength(1);
  });

  it('a remount during an attempt joins it instead of starting another', async () => {
    const { fetch, calls } = mockFetch();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const port = adapter('slow', fetch, () => gate);
    const options = { port, roomId: 'room-1', bidderId: 'b-1', makeId: () => 'reg-1' };
    const first = renderHook(() => useApproval(options));
    let pending: Promise<unknown> = Promise.resolve();
    act(() => {
      pending = first.result.current.start(50_000);
    });
    first.unmount();
    const second = renderHook(() => useApproval(options));
    await act(async () => {
      void second.result.current.start(50_000);
      release();
      await pending;
    });
    expect(orders(calls)).toBe(1);
    expect(second.result.current.state).toBe('held');
  });

  it('a declined attempt retries with a new id, a cancelled one with the same id', async () => {
    const { fetch } = mockFetch();
    const ids: string[] = [];
    const port = adapter('decline', fetch);
    const spy = vi.spyOn(port, 'start');
    let n = 0;
    const { result } = renderHook(() =>
      useApproval({ port, roomId: 'room-1', bidderId: 'b-9', makeId: () => `reg-${(n += 1)}` }),
    );
    await act(async () => {
      await result.current.start(50_000);
    });
    await act(async () => {
      await result.current.start(50_000);
    });
    for (const call of spy.mock.calls) ids.push(call[0].clientRegistrationId);
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });
});

describe('registration id survives a reload and the redirect return (WEB-RT-10)', () => {
  it('reuses the stored id after the in-memory attempts are gone', async () => {
    const { fetch } = mockFetch();
    const port = adapter('cancel', fetch);
    const spy = vi.spyOn(port, 'start');
    const options = { port, roomId: 'room-1', bidderId: 'b-5' };
    const first = renderHook(() => useApproval({ ...options, makeId: () => 'reg-first' }));
    await act(async () => {
      await first.result.current.start(50_000);
    });
    first.unmount();

    // A reload drops module memory but not sessionStorage.
    resetAttemptMemoryOnly();
    const second = renderHook(() => useApproval({ ...options, makeId: () => 'reg-second' }));
    await act(async () => {
      await second.result.current.start(50_000);
    });
    expect(spy.mock.calls.map((c) => c[0].clientRegistrationId)).toEqual([
      'reg-first',
      'reg-first',
    ]);
  });

  it('keeps ids apart per room and bidder', async () => {
    const { fetch } = mockFetch();
    const port = adapter('cancel', fetch);
    const spy = vi.spyOn(port, 'start');
    const a = renderHook(() =>
      useApproval({ port, roomId: 'room-1', bidderId: 'b-1', makeId: () => 'reg-a' }),
    );
    const b = renderHook(() =>
      useApproval({ port, roomId: 'room-2', bidderId: 'b-1', makeId: () => 'reg-b' }),
    );
    await act(async () => {
      await a.result.current.start(50_000);
      await b.result.current.start(50_000);
    });
    expect(spy.mock.calls.map((c) => c[0].clientRegistrationId)).toEqual(['reg-a', 'reg-b']);
  });

  it('refuses a return whose order id is not the one issued (WEB-R2-08)', async () => {
    saveRegistration('room-1', 'b-8', { clientRegistrationId: 'reg-r', orderId: 'ord-issued' });
    const fetch = vi.fn();
    const real = new PayPalV6Adapter({ apiBase: 'http://api.test', clientId: 'c', fetch });
    const result = await completeApprovalReturn(
      real,
      { roomId: 'room-1', bidderId: 'b-8', orderId: 'ord-crafted' },
      () => undefined,
    );
    expect(result).toMatchObject({ state: 'error', errorCode: 'order_mismatch' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('retries a failed confirm with the approved order id, not a new order (WEB-R2-08)', async () => {
    const results = [
      { state: 'error' as const, errorCode: 'hold_failed', orderId: 'ord-1' },
      { state: 'held' as const, holdIdSuffix: 'a1b2c3', ceilingCents: 50_000 },
    ];
    const start = vi.fn((_r: ApprovalRequest, _on: (s: ApprovalState) => void) =>
      Promise.resolve(results.shift() ?? { state: 'error' as const }),
    );
    const port = { start, cancel: () => undefined };
    const { result } = renderHook(() => useApproval({ port, roomId: 'room-9', bidderId: 'b-9' }));
    await act(async () => {
      await result.current.start(50_000);
    });
    await act(async () => {
      await result.current.start(50_000);
    });
    expect(start.mock.calls[0]?.[0].approvedOrderId).toBeUndefined();
    expect(start.mock.calls[1]?.[0].approvedOrderId).toBe('ord-1');
  });

  it('completes the redirect return with the stored id', async () => {
    const posted: string[] = [];
    const fetch: FetchLike = (_url, init) => {
      posted.push(init.body);
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({ holdIdSuffix: 'ZZ9988', ceilingCents: 50_000, state: 'HELD' }),
      });
    };
    saveRegistration('room-1', 'b-7', { clientRegistrationId: 'reg-redirect', orderId: 'ord-9' });
    const real = new PayPalV6Adapter({ apiBase: 'http://api.test', clientId: 'c', fetch });
    const states: ApprovalState[] = [];
    const result = await completeApprovalReturn(
      real,
      { roomId: 'room-1', bidderId: 'b-7', orderId: 'ord-9' },
      (s) => states.push(s),
    );
    expect(result).toMatchObject({ state: 'held', holdIdSuffix: 'ZZ9988' });
    expect(JSON.parse(posted[0] ?? '{}')).toEqual({
      orderId: 'ord-9',
      clientRegistrationId: 'reg-redirect',
    });
  });

  it('reports an error instead of inventing an id when nothing was stored', async () => {
    const real = new PayPalV6Adapter({ apiBase: 'http://api.test', clientId: 'c' });
    const result = await completeApprovalReturn(
      real,
      { roomId: 'room-1', bidderId: 'nobody', orderId: 'ord-9' },
      () => undefined,
    );
    expect(result).toMatchObject({ state: 'error', errorCode: 'registration_missing' });
  });
});
