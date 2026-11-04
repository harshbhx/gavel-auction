import type { Scenario } from '../../net/transport';
import { baseConfig, Script, bidders, openSnapshot } from './_kit';

const roster = bidders([12, 'Priya', 50_000], [7, 'Sam', 40_000]);
const config = { ...baseConfig, lateEntry: false };

const script = new Script().state(0, openSnapshot(roster, config)).acceptedBid(1_000, 7, 10_000, 1);
script.steps.push({ at: 2_000, expectClient: { t: 'bid', paddle: 33 } });
script.emit(2_100, (e) => ({
  t: 'bid_rejected',
  ...e,
  clientBidId: 'late-1',
  code: 'unregistered',
  message: 'late entry is closed',
}));

/** Late entry is off: a newcomer can watch but their bid is rejected. */
export const late_entry_closed: Scenario = script.build(
  'late_entry_closed',
  'Registration is closed once bidding starts',
  config,
);
