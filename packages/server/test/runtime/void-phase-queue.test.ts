import { MemoryHoldStore } from '@gavel/payments';
import type { AuditSink, HoldRecord, PaymentsGateway } from '@gavel/payments';
import { describe, expect, it } from 'vitest';
import { voidOrphanHold } from '../../src/runtime/void-phase';

const hold: HoldRecord = {
  holdId: 'H1',
  auctionId: 'AU1',
  bidderId: 'B1',
  orderId: 'O1',
  authId: 'AUTH-1',
  ceilingCents: 5000,
  status: 'HELD',
  createdAtMs: 0,
};

describe('orphan void write (R9-M05)', () => {
  it('keeps a newer write that landed during the void call', async () => {
    const holds = new MemoryHoldStore();
    await holds.put(hold);
    const gateway = {
      voidAuthorization: async () => {
        await holds.put({ ...hold, ceilingCents: 7777 });
      },
    } as unknown as PaymentsGateway;
    const audit: AuditSink = { append: async () => undefined };
    const status = await voidOrphanHold(
      { gateway, holds, audit, clock: { nowMs: () => 1000 } },
      'AU1',
      'H1',
    );
    expect(status).toBe('voided');
    const after = await holds.get('H1');
    expect(after?.status).toBe('VOIDED');
    expect(after?.ceilingCents).toBe(7777);
  });

  it('leaves a hold that a webhook captured during the void call', async () => {
    const holds = new MemoryHoldStore();
    await holds.put(hold);
    const gateway = {
      voidAuthorization: async () => {
        await holds.put({ ...hold, status: 'CAPTURED' });
      },
    } as unknown as PaymentsGateway;
    const audit: AuditSink = { append: async () => undefined };
    await voidOrphanHold({ gateway, holds, audit, clock: { nowMs: () => 1000 } }, 'AU1', 'H1');
    expect((await holds.get('H1'))?.status).toBe('CAPTURED');
  });
});
