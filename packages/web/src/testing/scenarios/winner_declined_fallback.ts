import type { Scenario } from '../../net/transport';
import { Script, bidders, hold, openSnapshot, settlementView } from './_kit';

const roster = bidders([12, 'Priya'], [7, 'Sam'], [9, 'Ana']);
const REASON = 'hold expired';
const verified = {
  eventId: 'evt-capture-2',
  kind: 'webhook',
  eventType: 'PAYMENT.CAPTURE.COMPLETED',
  at: 1_700_000_050_000,
} as const;

/** The winning hold expires, the runner-up is selected and ends CAPTURED. 30000 + 70000 = 100000. */
export const winner_declined_fallback: Scenario = new Script()
  .state(0, openSnapshot(roster))
  .acceptedBid(1_000, 9, 5_000)
  .acceptedBid(2_000, 7, 30_000)
  .acceptedBid(3_000, 12, 35_000)
  .hammer(13_000, 12, 35_000)
  .settlement(
    14_000,
    settlementView('WINNER_SELECTED', 12, [
      hold(12, 'Priya', 50_000, 'WINNER_SELECTED'),
      hold(7, 'Sam', 40_000, 'BIDDING'),
      hold(9, 'Ana', 10_000, 'VOIDING'),
    ]),
  )
  .settlement(
    15_000,
    settlementView('FALLBACK_RUNNER_UP', 7, [
      hold(12, 'Priya', 50_000, 'FALLBACK_RUNNER_UP', 0, 0, { reason: REASON }),
      hold(7, 'Sam', 40_000, 'WINNER_SELECTED'),
      hold(9, 'Ana', 10_000, 'VOIDING'),
    ]),
  )
  .settlement(
    16_000,
    settlementView('CAPTURING', 7, [
      hold(12, 'Priya', 50_000, 'FALLBACK_RUNNER_UP', 0, 0, { reason: REASON }),
      hold(7, 'Sam', 40_000, 'CAPTURING'),
      hold(9, 'Ana', 10_000, 'VOIDING'),
    ]),
  )
  .settlement(
    17_000,
    settlementView('CAPTURED', 7, [
      hold(12, 'Priya', 50_000, 'FALLBACK_RUNNER_UP', 0, 50_000, { reason: REASON }),
      hold(7, 'Sam', 40_000, 'CAPTURED', 30_000, 10_000, { verifiedBy: [verified] }),
      hold(9, 'Ana', 10_000, 'SETTLED', 0, 10_000),
    ]),
  )
  .build('winner_declined_fallback', 'Winner hold expired; the runner-up is captured instead');
