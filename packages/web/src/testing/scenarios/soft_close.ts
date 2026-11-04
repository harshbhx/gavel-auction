import type { Scenario } from '../../net/transport';
import { Script, bidders, openSnapshot } from './_kit';

const roster = bidders([12, 'Priya', 50_000], [7, 'Sam', 40_000]);
const closesAt = 1_700_000_000_000 + 30_000;

/** A bid in the last second pushes the close time out by the soft-close window. */
export const soft_close: Scenario = new Script()
  .state(0, {
    ...openSnapshot(roster),
    lot: { id: 'lot-1', title: 'Signed first edition', closesAt },
  })
  .acceptedBid(5_000, 7, 10_000, 1, 5_000, closesAt)
  .acceptedBid(29_000, 12, 15_000, 2, 5_000, closesAt + 10_000)
  .acceptedBid(38_500, 7, 20_000, 3, 5_000, closesAt + 20_000)
  .hammer(48_500, 7, 20_000)
  .build('soft_close', 'A bid in the final second extends the close time');
