import type { AuctionId, PaymentsPort } from '@gavel/shared';
import { describe, expect, it } from 'vitest';
import type { WebhookPort } from '../src/http/webhook';
import { bindSettlementUpdates, type MailboxRoom } from '../src/http/webhook-dispatch';
import type { SettlementReport } from '../src/room/settle-port';

type Update = Parameters<Parameters<PaymentsPort['onSettlementUpdate']>[0]>[0];
type Listener = (u: Update) => void;

const update = (id: string, rev: number): Update => ({
  auctionId: id as AuctionId,
  rev,
  auctionState: 'CAPTURING',
  perBidder: {},
});

/** A room stand-in: one FIFO mailbox that assigns the next seq to each event. */
class FakeRoom implements MailboxRoom {
  seq = 10;
  readonly events: { seq: number; rev: number }[] = [];
  private tail: Promise<unknown> = Promise.resolve();

  private enqueue<T>(fn: () => T): Promise<T> {
    const run = this.tail.then(fn);
    this.tail = run.catch(() => undefined);
    return run;
  }

  bid(): Promise<number> {
    return this.enqueue(() => (this.seq += 1));
  }

  reportSettlement(report: SettlementReport): Promise<void> {
    return this.enqueue(() => {
      this.seq += 1;
      this.events.push({ seq: this.seq, rev: report.rev });
    });
  }
}

describe('webhook dispatch', () => {
  it('a stalled webhook does not block bids; its update enters via the mailbox (T-RT-084)', async () => {
    const room = new FakeRoom();
    let release: () => void = () => undefined;
    let listener: Listener | undefined;
    bindSettlementUpdates({
      payments: {
        onSettlementUpdate(cb) {
          listener = cb;
          return () => undefined;
        },
      },
      room: () => Promise.resolve(room),
      onError: () => undefined,
    });

    const port: WebhookPort = {
      handleWebhook: () =>
        new Promise((resolve) => {
          release = () => resolve({ kind: 'ok' });
        }),
    };
    const stalled = port.handleWebhook({ rawBody: new Uint8Array(), headers: {} });

    const bids = Promise.all([room.bid(), room.bid()]).then(() => 'done');
    const limit = new Promise<string>((r) => setTimeout(() => r('late'), 50));
    expect(await Promise.race([bids, limit])).toBe('done');

    listener?.(update('a1', 1));
    await new Promise((r) => setTimeout(r, 5));
    const seq = await room.bid();
    expect(room.events).toEqual([{ seq: 13, rev: 1 }]);
    expect(seq).toBe(14);

    release();
    await stalled;
  });

  it('reports mailbox failures without throwing into the webhook path', async () => {
    const errors: string[] = [];
    let listener: Listener | undefined;
    bindSettlementUpdates({
      payments: {
        onSettlementUpdate(cb) {
          listener = cb;
          return () => undefined;
        },
      },
      room: () =>
        Promise.resolve({ reportSettlement: () => Promise.reject(new Error('store down')) }),
      onError: (_e, id) => errors.push(id),
    });
    listener?.(update('a2', 1));
    await new Promise((r) => setTimeout(r, 5));
    expect(errors).toEqual(['a2']);
  });
});
