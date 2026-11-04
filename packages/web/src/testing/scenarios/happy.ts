import type { Scenario } from '../../net/transport';
import { Script, bidders, hold, openSnapshot, settlementView } from './_kit';

const roster = bidders([12, 'Priya', 50_000], [7, 'Sam', 40_000], [9, 'Ana', 10_000]);

const verified = {
  eventId: 'evt-capture-1',
  kind: 'webhook',
  eventType: 'PAYMENT.CAPTURE.COMPLETED',
  at: 1_700_000_040_000,
} as const;

/** Three bidders, five accepted bids, hammer, full settlement. Totals: 35000 + 65000 = 100000. */
export const happy: Scenario = new Script()
  .state(0, openSnapshot(roster))
  .acceptedBid(1_000, 9, 5_000, 1)
  .acceptedBid(2_000, 7, 15_000, 2)
  .acceptedBid(3_000, 12, 25_000, 3)
  .acceptedBid(4_000, 7, 30_000, 4)
  .acceptedBid(5_000, 12, 35_000, 5)
  .hammer(15_000, 12, 35_000)
  .settlement(
    16_000,
    settlementView('WINNER_SELECTED', 12, [
      hold(12, 'Priya', 50_000, 'WINNER_SELECTED'),
      hold(7, 'Sam', 40_000, 'VOIDING'),
      hold(9, 'Ana', 10_000, 'VOIDING'),
    ]),
  )
  .settlement(
    17_000,
    settlementView('CAPTURING', 12, [
      hold(12, 'Priya', 50_000, 'CAPTURING'),
      hold(7, 'Sam', 40_000, 'VOIDING'),
      hold(9, 'Ana', 10_000, 'VOIDING'),
    ]),
  )
  .settlement(
    18_000,
    settlementView('CAPTURED', 12, [
      hold(12, 'Priya', 50_000, 'CAPTURED', 35_000, 15_000, { verifiedBy: [verified] }),
      hold(7, 'Sam', 40_000, 'SETTLED', 0, 40_000),
      hold(9, 'Ana', 10_000, 'SETTLED', 0, 10_000),
    ]),
  )
  .build('happy', 'Three bidders, five accepted bids, hammer and full settlement');
