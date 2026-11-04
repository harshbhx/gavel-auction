import { Cents, EpochMs } from '@gavel/shared';
import type { Scenario } from '../../net/transport';
import { Script, bidders, openSnapshot } from './_kit';

const roster = bidders([12, 'Priya'], [7, 'Sam']);

const script = new Script()
  .state(0, openSnapshot(roster))
  .acceptedBid(1_000, 7, 10_000)
  .emit(3_000, (e) => ({
    v: 1,
    t: 'confirm_request',
    ...e,
    confirmId: 'confirm-1',
    amount: Cents(15_000),
    transcript: 'one fifty paddle twelve',
    expiresAt: EpochMs(e.ts + 8_000),
  }));
script.steps.push({
  at: 4_000,
  expectClient: { t: 'confirm_response', confirmId: 'confirm-1', accept: true },
});
script.acceptedBid(4_300, 12, 15_000);

/** A low-confidence voice bid is held until the bidder or auctioneer answers the confirm request. */
export const ambiguous_confirm: Scenario = script.build(
  'ambiguous_confirm',
  'A voice bid below the confidence threshold needs a yes before it counts',
);
