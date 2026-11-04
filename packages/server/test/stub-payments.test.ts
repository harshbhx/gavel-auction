import { SeqIds } from '@gavel/shared';
import type { AuctionId, BidderId, Cents } from '@gavel/shared';
import { describe, expect, it } from 'vitest';
import { StubPayments } from '../src/testing/stub-payments';

const ids = new SeqIds();
const auctionId = ids.mint<'AuctionId'>() as AuctionId;
const bidderId = ids.mint<'BidderId'>() as BidderId;
const outcome = { winner: bidderId, price: 500 as Cents, ranking: [] };
const raw = new Uint8Array([1, 2, 3]);

describe('StubPayments (T-RT-109)', () => {
  it('records settle calls and rejects once when told to', async () => {
    const p = new StubPayments();
    await p.settle({ auctionId, outcome, holds: { [bidderId]: 'hold-1' } });
    expect(p.settleCalls).toHaveLength(1);
    p.failNextSettle(new Error('boom'));
    await expect(p.settle({ auctionId, outcome, holds: {} })).rejects.toThrow('boom');
    await expect(p.settle({ auctionId, outcome, holds: {} })).resolves.toBeUndefined();
    expect(p.settleCalls).toHaveLength(3);
  });

  it('records webhook inputs and replays injected results in order', async () => {
    const p = new StubPayments();
    p.injectWebhook(
      { kind: 'duplicate' },
      { kind: 'invalid_signature' },
      { kind: 'retry', reason: 'x' },
    );
    const headers = { 'x-sig': 'fake' };
    expect(await p.handleWebhook({ rawBody: raw, headers })).toEqual({ kind: 'duplicate' });
    expect(await p.handleWebhook({ rawBody: raw, headers })).toEqual({ kind: 'invalid_signature' });
    expect(await p.handleWebhook({ rawBody: raw, headers })).toEqual({
      kind: 'retry',
      reason: 'x',
    });
    expect(await p.handleWebhook({ rawBody: raw, headers })).toEqual({ kind: 'ok' });
    expect(p.webhookCalls).toHaveLength(4);
    expect(p.webhookCalls[0]?.headers).toEqual(headers);
  });

  it('pushes settlement updates and hold reports until unsubscribed', () => {
    const p = new StubPayments();
    const updates: number[] = [];
    const holds: string[] = [];
    const off = p.onSettlementUpdate((u) => updates.push(u.rev));
    p.onHoldReported((h) => holds.push(h.holdRef));
    p.pushUpdate({ auctionId, rev: 1, auctionState: 'HELD', perBidder: {} });
    off();
    p.pushUpdate({ auctionId, rev: 2, auctionState: 'HELD', perBidder: {} });
    p.pushHold({ auctionId, bidderId, name: 'Ann', ceiling: 900 as Cents, holdRef: 'h1' });
    expect(updates).toEqual([1]);
    expect(holds).toEqual(['h1']);
  });
});
