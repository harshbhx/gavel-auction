import type { HoldStore, PaymentsGateway } from '@gavel/payments';
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
    const source = createSimHoldSource({ put } as unknown as HoldStore, () => 5);
    const id = await source('B1' as BidderId, 5_000 as Cents, 'A1' as AuctionId);
    expect(id).toBe('sim-hold-B1');
    expect(put).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'HELD', ceilingCents: 5_000, authId: 'sim-auth-B1-5000' }),
    );
    expect(isSimAuth('sim-auth-B1-5000')).toBe(true);
    expect(isSimAuth('9AB12345CD')).toBe(false);
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
    expect(after.status).toBe('PARTIALLY_CAPTURED');
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
