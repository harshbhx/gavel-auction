import type { PaymentsPort } from '@gavel/shared';
import type { SettlementReport } from '../room/settle-port';

/** The room's mailbox entry for settlement progress (R-RT-052). */
export interface MailboxRoom {
  reportSettlement(report: SettlementReport): Promise<void>;
}

export interface WebhookDispatchDeps {
  payments: Pick<PaymentsPort, 'onSettlementUpdate'>;
  /** The room for an auction, or undefined when there is none (the update is dropped). */
  room(auctionId: string): Promise<MailboxRoom | undefined>;
  onError(err: unknown, auctionId: string): void;
}

/**
 * R-RT-113: settlement updates that come out of webhook handling enter the room through
 * its mailbox, off the webhook path. The webhook call never awaits a room, and a room
 * never awaits the webhook call. Returns the unsubscribe function.
 */
export function bindSettlementUpdates(deps: WebhookDispatchDeps): () => void {
  return deps.payments.onSettlementUpdate((u) => {
    const report: SettlementReport = {
      rev: u.rev,
      auctionState: u.auctionState,
      perBidder: u.perBidder,
      amountCaptured: u.amountCaptured,
      note: u.note,
    };
    const id = String(u.auctionId);
    void (async () => {
      try {
        const room = await deps.room(id);
        if (room !== undefined) await room.reportSettlement(report);
      } catch (err) {
        deps.onError(err, id);
      }
    })();
  });
}
