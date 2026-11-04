import type { Scenario } from '../../net/transport';
import type { BidderView } from '../../wire';
import { baseConfig, Script, openSnapshot } from './_kit';

const BIDDER_COUNT = 200;
const BID_COUNT = 250;
const INCREMENT = 1_000;
const CEILING = 1_000_000;
const config = { ...baseConfig, minIncrementCents: INCREMENT, maxCeilingCents: CEILING };

const roster: BidderView[] = Array.from({ length: BIDDER_COUNT }, (_, i) => ({
  paddle: i + 1,
  name: `Bidder ${i + 1}`,
  holdState: 'HELD',
  ceilingCents: CEILING,
}));

const script = new Script().state(0, openSnapshot(roster, config));
for (let i = 0; i < BID_COUNT; i += 1) {
  const paddle = ((i * 7) % BIDDER_COUNT) + 1;
  script.acceptedBid(1_000 + i * 100, paddle, INCREMENT * (i + 1), i + 1, INCREMENT);
}
const lastPaddle = (((BID_COUNT - 1) * 7) % BIDDER_COUNT) + 1;
script.hammer(1_000 + BID_COUNT * 100 + 1_000, lastPaddle, INCREMENT * BID_COUNT);

/** 200 bidders and 250 accepted bids, for list virtualisation and reducer timing. */
export const big_room_200_bids: Scenario = script.build(
  'big_room_200_bids',
  '200 bidders and 250 bids',
  config,
);
