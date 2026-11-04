import type { Scenario } from '../../net/transport';
import { Cents } from '@gavel/shared';
import type { ErrorCode } from '../../wire';
import { msgId } from '../builders';
import { baseConfig, Script, bidders, openSnapshot } from './_kit';

const roster = bidders([12, 'Priya'], [7, 'Sam']);
const config = { ...baseConfig, reserve: Cents(15_000) };

function reject(script: Script, at: number, n: number, reason: ErrorCode): Script {
  return script.emit(at, (e) => ({
    v: 1,
    t: 'bid_rejected',
    ...e,
    mid: msgId(900 + n),
    reason,
    retryable: false,
  }));
}

const script = new Script().state(0, openSnapshot(roster, config)).acceptedBid(1_000, 12, 5_000);

reject(script, 2_000, 1, 'over_ceiling');
reject(script, 3_000, 2, 'below_increment');
reject(script, 4_000, 3, 'closed');
reject(script, 5_000, 4, 'already_leading');
reject(script, 6_000, 5, 'below_reserve');

/** One rejection for each code in the copy table. */
export const rejections: Scenario = script.build(
  'rejections',
  'over_ceiling, below_increment, closed, already_leading, below_reserve',
  config,
);
