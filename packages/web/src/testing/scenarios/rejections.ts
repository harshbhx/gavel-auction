import type { Scenario } from '../../net/transport';
import { baseConfig, Script, bidders, openSnapshot } from './_kit';

const roster = bidders([12, 'Priya', 20_000], [7, 'Sam', 40_000]);
const config = { ...baseConfig, reserveCents: 15_000 };

function reject(
  script: Script,
  at: number,
  clientBidId: string,
  code: string,
  details?: Record<string, unknown>,
): Script {
  return script.emit(at, (e) => ({
    t: 'bid_rejected',
    ...e,
    clientBidId,
    code,
    message: code,
    ...(details === undefined ? {} : { details }),
  }));
}

const script = new Script().state(0, openSnapshot(roster, config)).acceptedBid(1_000, 12, 5_000, 1);

reject(script, 2_000, 'rj-over', 'over_ceiling', { maxCents: 20_000 });
reject(script, 3_000, 'rj-low', 'below_increment', { minCents: 10_000 });
reject(script, 4_000, 'rj-closed', 'closed');
reject(script, 5_000, 'rj-lead', 'already_leading');
reject(script, 6_000, 'rj-reserve', 'below_reserve');

/** One rejection for each code in the copy table. */
export const rejections: Scenario = script.build(
  'rejections',
  'over_ceiling, below_increment, closed, already_leading, below_reserve',
  config,
);
