import type { HoldRecord, HoldStore, PaymentsGateway } from '@gavel/payments';
import type { AuctionId, BidderId, Cents } from '@gavel/shared';
import { describe, expect, it, vi } from 'vitest';
import { createSimHoldSource, isSimAuth, withSimulatedHolds } from '../src/http/sim-holds';

function realGateway(): PaymentsGateway {
  const never = (): Promise<never> => Promise.reject(new Error('real gateway reached'));
  return {
    createOrder: never,
    getOrder: never,
    authorizeOrder: never,
    getHoldTruth: never,
    capture: vi.fn(never),
    voidAuthorization: vi.fn(never),
    reauthorize: never,
  };
}

describe('simulated holds', () => {
  it('writes an approved hold with a simulated authorization', async () => {
    const put = vi.fn(() => Promise.resolve());
    const get = vi.fn(() => Promise.resolve(null));
    const source = createSimHoldSource({ put, get } as unknown as HoldStore, () => 5);
    const id = await source('B1' as BidderId, 5_000 as Cents, 'A1' as AuctionId);
    expect(id).toBe('sim-hold-B1');
    expect(put).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'HELD', ceilingCents: 5_000, authId: 'sim-auth-B1-5000' }),
    );
    expect(isSimAuth('sim-auth-B1-5000')).toBe(true);
    expect(isSimAuth('9AB12345CD')).toBe(false);
  });

  it('writes one hold per bidder: same ceiling is idempotent, another ceiling is refused', async () => {
    const rows = new Map<string, HoldRecord>();
    const store = {
      get: (id: string) => Promise.resolve(rows.get(id) ?? null),
      put: (h: HoldRecord) => {
        rows.set(h.holdId, h);
        return Promise.resolve();
      },
    } as unknown as HoldStore;
    const source = createSimHoldSource(store, () => 5);
    await source('B1' as BidderId, 5_000 as Cents, 'A1' as AuctionId);
    expect(await source('B1' as BidderId, 5_000 as Cents, 'A1' as AuctionId)).toBe('sim-hold-B1');
    await expect(source('B1' as BidderId, 2_000 as Cents, 'A1' as AuctionId)).rejects.toMatchObject(
      {
        code: 'conflict',
      },
    );
    expect(rows.get('sim-hold-B1')?.ceilingCents).toBe(5_000);
    // A hold that is no longer HELD is never reused or rewritten.
    rows.set('sim-hold-B1', { ...(rows.get('sim-hold-B1') as HoldRecord), status: 'VOIDED' });
    await expect(source('B1' as BidderId, 5_000 as Cents, 'A1' as AuctionId)).rejects.toMatchObject(
      {
        code: 'conflict',
      },
    );
    expect(rows.get('sim-hold-B1')?.status).toBe('VOIDED');
  });

  it('FEAT-61: a larger ceiling is a raise with its own hold, written once per amount', async () => {
    const rows = new Map<string, HoldRecord>();
    const store = {
      get: (id: string) => Promise.resolve(rows.get(id) ?? null),
      put: (h: HoldRecord) => {
        rows.set(h.holdId, h);
        return Promise.resolve();
      },
    } as unknown as HoldStore;
    const source = createSimHoldSource(store, () => 5);
    await source('B1' as BidderId, 5_000 as Cents, 'A1' as AuctionId);
    const raised = await source('B1' as BidderId, 8_000 as Cents, 'A1' as AuctionId);
    expect(raised).toBe('sim-hold-B1-8000');
    expect(rows.get(raised)).toMatchObject({
      status: 'HELD',
      ceilingCents: 8_000,
      authId: 'sim-auth-B1-8000',
    });
    // The same request again finds the same hold; the old one is not rewritten.
    expect(await source('B1' as BidderId, 8_000 as Cents, 'A1' as AuctionId)).toBe(raised);
    expect(rows.get('sim-hold-B1')?.ceilingCents).toBe(5_000);
    // A raise to an amount already used by a voided hold is not reused.
    rows.set(raised, { ...(rows.get(raised) as HoldRecord), status: 'VOIDED' });
    await expect(source('B1' as BidderId, 8_000 as Cents, 'A1' as AuctionId)).rejects.toMatchObject(
      { code: 'conflict' },
    );
  });

  it('races two calls for one bidder into a single write', async () => {
    const rows = new Map<string, HoldRecord>();
    const put = vi.fn(async (h: HoldRecord) => {
      await Promise.resolve();
      rows.set(h.holdId, h);
    });
    const store = {
      get: (id: string) => Promise.resolve(rows.get(id) ?? null),
      put,
    } as unknown as HoldStore;
    const source = createSimHoldSource(store, () => 5);
    const results = await Promise.allSettled([
      source('B9' as BidderId, 5_000 as Cents, 'A1' as AuctionId),
      source('B9' as BidderId, 2_000 as Cents, 'A1' as AuctionId),
    ]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
    expect(put).toHaveBeenCalledTimes(1);
    expect(rows.get('sim-hold-B9')?.ceilingCents).toBe(5_000);
  });

  it('settles a simulated hold without the real gateway', async () => {
    const real = realGateway();
    const gw = withSimulatedHolds(real, () => 9);
    const truth = { holdId: 'h', authId: 'sim-auth-B1-5000' };
    expect((await gw.getHoldTruth(truth)).status).toBe('PENDING');
    expect(
      await gw.capture('sim-auth-B1-5000', {
        amountCents: 3_000,
        finalCapture: true,
        invoiceId: 'i',
        requestId: 'r',
      }),
    ).toEqual({ captureId: 'sim-cap-sim-auth-B1-5000', amountCents: 3_000 });
    const after = await gw.getHoldTruth(truth);
    expect(after.status).toBe('CAPTURED');
    expect(after.capturedCents).toBe(3_000);
    await gw.voidAuthorization('sim-auth-B2-5000', 'r2');
    expect((await gw.getHoldTruth({ holdId: 'h2', authId: 'sim-auth-B2-5000' })).status).toBe(
      'VOIDED',
    );
    expect(real.capture).not.toHaveBeenCalled();
    expect(real.voidAuthorization).not.toHaveBeenCalled();
  });

  it('passes every real authorization to the real gateway', async () => {
    const real = realGateway();
    const gw = withSimulatedHolds(real, () => 9);
    await expect(gw.voidAuthorization('9AB12345CD', 'r')).rejects.toThrow('real gateway reached');
    await expect(gw.getHoldTruth({ holdId: 'h', authId: '9AB12345CD' })).rejects.toThrow(
      'real gateway reached',
    );
  });
});
