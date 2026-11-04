import type { Scenario } from '../../net/transport';
import { Cents } from '@gavel/shared';
import { baseConfig, Script, openSnapshot, roster as makeRoster, type RosterEntry } from './_kit';

const BIDDER_COUNT = 200;
const BID_COUNT = 250;
const INCREMENT = 1_000;
const CEILING = 1_000_000;
const config = { ...baseConfig, minIncrement: Cents(INCREMENT), ceilingPresets: [Cents(CEILING)] };

const roster: RosterEntry[] = makeRoster(
  ...Array.from({ length: BIDDER_COUNT }, (_, i): [number, string] => [i + 1, `Bidder ${i + 1}`]),
);

const script = new Script().state(0, openSnapshot(roster, config));
for (let i = 0; i < BID_COUNT; i += 1) {
  const paddle = ((i * 7) % BIDDER_COUNT) + 1;
  script.acceptedBid(1_000 + i * 100, paddle, INCREMENT * (i + 1), INCREMENT);
}
const lastPaddle = (((BID_COUNT - 1) * 7) % BIDDER_COUNT) + 1;
script.hammer(1_000 + BID_COUNT * 100 + 1_000, lastPaddle, INCREMENT * BID_COUNT);

/** 200 bidders and 250 accepted bids, for list virtualisation and reducer timing. */
export const big_room_200_bids: Scenario = script.build(
  'big_room_200_bids',
  '200 bidders and 250 bids',
  config,
);
