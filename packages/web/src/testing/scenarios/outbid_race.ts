import type { Scenario } from '../../net/transport';
import { Script, bidders, openSnapshot } from './_kit';

const roster = bidders([12, 'Priya', 50_000], [7, 'Sam', 40_000]);

/** Two bids inside the same 50 ms: both are broadcast, the second one leads. */
export const outbid_race: Scenario = new Script()
  .state(0, openSnapshot(roster))
  .acceptedBid(1_000, 7, 10_000, 1)
  .acceptedBid(2_000, 12, 15_000, 2)
  .acceptedBid(2_030, 7, 20_000, 3)
  .build('outbid_race', 'Two bids land within 50 ms of each other');
