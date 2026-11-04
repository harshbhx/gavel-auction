import type { Scenario } from '../../net/transport';
import { Script, bidders, hold, openSnapshot, settlementView } from './_kit';

const roster = bidders([12, 'Priya'], [7, 'Sam']);

/** Capture fails and no fallback is available: settlement stops in FAILED_NEEDS_REVIEW. */
export const failed_needs_review: Scenario = new Script()
  .state(0, openSnapshot(roster))
  .acceptedBid(1_000, 7, 10_000)
  .acceptedBid(2_000, 12, 15_000)
  .hammer(12_000, 12, 15_000)
  .settlement(
    13_000,
    settlementView('CAPTURING', 12, [
      hold(12, 'Priya', 50_000, 'CAPTURING'),
      hold(7, 'Sam', 40_000, 'VOIDING'),
    ]),
  )
  .settlement(
    14_000,
    settlementView(
      'FAILED_NEEDS_REVIEW',
      12,
      [
        hold(12, 'Priya', 50_000, 'FAILED_NEEDS_REVIEW', 0, 0, { reason: 'capture failed' }),
        hold(7, 'Sam', 40_000, 'SETTLED', 0, 40_000),
      ],
      false,
      ['holds not reconciled: 50000 unaccounted'],
    ),
  )
  .build('failed_needs_review', 'Capture fails and settlement stops for review');
