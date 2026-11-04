import type { Scenario } from '../../net/transport';
import { Cents } from '@gavel/shared';
import { bidderId } from '../builders';
import { Script, bidders, hold, openSnapshot, settlementView } from './_kit';

const roster = bidders([12, 'Priya'], [7, 'Sam']);

/** The auctioneer stops the room mid-lot: no winner, every hold is released. */
export const kill_switch: Scenario = new Script()
  .state(0, openSnapshot(roster))
  .acceptedBid(1_000, 7, 10_000)
  .acceptedBid(2_000, 12, 15_000)
  .state(5_000, {
    ...openSnapshot(roster, undefined, 'DONE'),
    price: Cents(15_000),
    leaderId: bidderId(12),
    minNext: Cents(20_000),
  })
  .settlement(
    6_000,
    settlementView('SETTLED', null, [
      hold(12, 'Priya', 50_000, 'SETTLED', 0, 50_000),
      hold(7, 'Sam', 40_000, 'SETTLED', 0, 40_000),
    ]),
  )
  .build('kill_switch', 'Room stopped mid-lot, all holds released, no winner');
