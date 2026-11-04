import type { Scenario } from '../../net/transport';
import { msgId } from '../builders';
import { Script, bidders, openSnapshot } from './_kit';

const roster = bidders([12, 'Priya'], [7, 'Sam']);
const script = new Script().state(0, openSnapshot(roster)).acceptedBid(1_000, 7, 10_000);
script.steps.push({ at: 2_000, expectClient: { t: 'bid' } });
script.emit(2_100, (e) => ({
  v: 1,
  t: 'bid_rejected',
  ...e,
  mid: msgId(900),
  reason: 'unregistered',
  retryable: false,
}));

/** Late entry is off: a newcomer can watch but their bid is rejected. */
export const late_entry_closed: Scenario = script.build(
  'late_entry_closed',
  'Registration is closed once bidding starts',
);
