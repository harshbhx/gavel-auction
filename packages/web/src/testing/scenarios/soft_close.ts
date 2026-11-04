import type { Scenario } from '../../net/transport';
import { EpochMs } from '@gavel/shared';
import { BASE_TIME } from '../builders';
import { Script, bidders, openSnapshot } from './_kit';

const roster = bidders([12, 'Priya'], [7, 'Sam']);
const closesAt = BASE_TIME + 30_000;

/** A bid in the last second pushes the close time out by the soft-close window. */
export const soft_close: Scenario = new Script()
  .state(0, { ...openSnapshot(roster), endTs: EpochMs(closesAt) })
  .acceptedBid(5_000, 7, 10_000, 5_000, closesAt, 0)
  .acceptedBid(29_000, 12, 15_000, 5_000, closesAt + 10_000, 1)
  .acceptedBid(38_500, 7, 20_000, 5_000, closesAt + 20_000, 2)
  .hammer(48_500, 7, 20_000)
  .build('soft_close', 'A bid in the final second extends the close time');
