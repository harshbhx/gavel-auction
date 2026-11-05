import { describe, expect, it } from 'vitest';
import { PayPalError } from '../../src/errors.js';
import { HoldService, type HoldServiceDeps } from '../../src/holds/service.js';
import type { PaymentsGateway } from '../../src/ports.js';
import { MemoryHoldStore } from '../../src/stores/memory.js';

type OrderAnswer = Awaited<ReturnType<PaymentsGateway['getOrder']>>;

function lostAnswer(): PayPalError {
  return new PayPalError({
    kind: 'server_error',
    status: 200,
    name: 'MALFORMED_RESPONSE',
    message: 'authorization status PENDING',
    outcome: 'unknown',
  });
}

async function setup(order: OrderAnswer) {
  const holds = new MemoryHoldStore();
  await holds.put({
    holdId: 'h1',
    auctionId: 'a1',
    bidderId: 'b1',
    orderId: 'o1',
    ceilingCents: 15000,
    status: 'PENDING_APPROVAL',
    createdAtMs: 1,
  });
  const gateway = {
    getOrder: async () => order,
    authorizeOrder: async () => {
      throw lostAnswer();
    },
  } as unknown as PaymentsGateway;
  const deps: HoldServiceDeps = {
    gateway,
    holds,
    audit: { append: async () => undefined },
    clock: { nowMs: () => 2 },
    maxCeilingCents: 25000,
    newId: () => 'x',
  };
  return { holds, service: new HoldService(deps) };
}

describe('HRD-04 a hold is adopted from the order only when PayPal says CREATED', () => {
  it('adopts a CREATED authorization and takes the amount from PayPal', async () => {
    const { holds, service } = await setup({
      orderId: 'o1',
      status: 'COMPLETED',
      authId: 'auth-1',
      authStatus: 'CREATED',
      authAmountCents: 12000,
    });
    const out = await service.completeApproval({ holdId: 'h1', orderId: 'o1' });
    expect(out).toMatchObject({ status: 'HELD', ceilingCents: 12000 });
    expect((await holds.get('h1'))?.authId).toBe('auth-1');
  });

  for (const authStatus of ['PENDING', 'DENIED', undefined]) {
    it(`does not adopt an authorization with status ${String(authStatus)}`, async () => {
      const order: OrderAnswer = { orderId: 'o1', status: 'COMPLETED', authId: 'auth-1' };
      if (authStatus !== undefined) order.authStatus = authStatus;
      order.authAmountCents = 15000;
      const { holds, service } = await setup(order);
      await expect(service.completeApproval({ holdId: 'h1', orderId: 'o1' })).rejects.toBeDefined();
      const stored = await holds.get('h1');
      expect(stored?.status).toBe('PENDING_APPROVAL');
      expect(stored?.authId).toBeUndefined();
    });
  }

  it('does not adopt a CREATED authorization without an amount', async () => {
    const { holds, service } = await setup({
      orderId: 'o1',
      status: 'COMPLETED',
      authId: 'auth-1',
      authStatus: 'CREATED',
    });
    await expect(service.completeApproval({ holdId: 'h1', orderId: 'o1' })).rejects.toBeDefined();
    expect((await holds.get('h1'))?.status).toBe('PENDING_APPROVAL');
  });
});
