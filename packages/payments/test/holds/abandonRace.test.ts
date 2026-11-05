import { describe, expect, it } from 'vitest';
import { HoldError, HoldService } from '../../src/holds/service.js';
import type { PaymentsGateway } from '../../src/ports.js';
import { MemoryHoldStore } from '../../src/stores/memory.js';

describe('R4-S06 approval racing an abandon', () => {
  it('does not write HELD over a record that was abandoned during authorize', async () => {
    const holds = new MemoryHoldStore();
    const voided: string[] = [];
    const gateway = {
      authorizeOrder: async () => {
        // The buyer picks another ceiling while the call is in flight.
        const rec = await holds.get('h1');
        if (rec === null) throw new Error('record');
        await holds.put({ ...rec, status: 'EXPIRED' });
        return { authId: 'auth-1', amountCents: 15000 };
      },
      voidAuthorization: async (authId: string) => {
        voided.push(authId);
      },
    } as unknown as PaymentsGateway;
    const service = new HoldService({
      gateway,
      holds,
      audit: { append: async () => undefined },
      clock: { nowMs: () => 1_800_000_000_000 },
      maxCeilingCents: 100000,
    });
    await holds.put({
      holdId: 'h1',
      auctionId: 'a1',
      bidderId: 'b1',
      orderId: 'o1',
      ceilingCents: 15000,
      status: 'PENDING_APPROVAL',
      createdAtMs: 1_800_000_000_000,
    });
    await expect(service.completeApproval({ holdId: 'h1', orderId: 'o1' })).rejects.toBeInstanceOf(
      HoldError,
    );
    const rec = await holds.get('h1');
    expect(rec?.status).toBe('EXPIRED');
    expect(rec?.authId).toBe('auth-1');
    expect(voided).toEqual(['auth-1']);
  });
});
