import type { Scenario } from '../../net/transport';
import { Script, bidders, openSnapshot } from './_kit';

const roster = bidders([12, 'Priya', 50_000], [7, 'Sam', 40_000]);

const script = new Script()
  .state(0, openSnapshot(roster))
  .acceptedBid(1_000, 7, 10_000, 1)
  .emit(3_000, (e) => ({
    t: 'confirm_request',
    ...e,
    confirmId: 'confirm-1',
    paddle: 12,
    amountCents: 15_000,
    transcript: 'one fifty paddle twelve',
    confidence: 0.62,
    expiresAt: e.serverTime + 8_000,
    addressee: 'both',
  }));
script.steps.push({
  at: 4_000,
  expectClient: { t: 'confirm_response', confirmId: 'confirm-1', accept: true },
});
script
  .emit(4_200, (e) => ({ t: 'confirm_response', ...e, confirmId: 'confirm-1', accept: true }))
  .acceptedBid(4_300, 12, 15_000, 2);

/** A low-confidence voice bid is held until the bidder or auctioneer answers the confirm request. */
export const ambiguous_confirm: Scenario = script.build(
  'ambiguous_confirm',
  'A voice bid below the confidence threshold needs a yes before it counts',
);
