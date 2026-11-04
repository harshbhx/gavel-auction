import type { Scenario } from '../../net/transport';
import { Script, bidders, openSnapshot } from './_kit';

const roster = bidders([12, 'Priya', 50_000], [7, 'Sam', 40_000]);
const script = new Script()
  .state(0, openSnapshot(roster))
  .acceptedBid(1_000, 7, 10_000, 1)
  // seq 5 is lost, so seq 6 arrives with a gap and the client asks for a snapshot.
  .emit(
    2_000,
    (e) => ({
      t: 'price',
      ...e,
      currentCents: 15_000,
      leaderPaddle: 12,
      nextMinCents: 20_000,
      bidCount: 2,
    }),
    'drop',
  )
  .emit(3_000, (e) => ({
    t: 'price',
    ...e,
    currentCents: 20_000,
    leaderPaddle: 7,
    nextMinCents: 25_000,
    bidCount: 3,
  }))
  .emit(4_000, (e) => ({
    t: 'state',
    ...e,
    ...openSnapshot(roster),
    price: { currentCents: 20_000, leaderPaddle: 7, nextMinCents: 25_000, bidCount: 3 },
  }))
  // The connection drops here; the next message arrives after the client reconnects.
  .emit(
    5_000,
    (e) => ({
      t: 'price',
      ...e,
      currentCents: 25_000,
      leaderPaddle: 12,
      nextMinCents: 30_000,
      bidCount: 4,
    }),
    'disconnect',
  )
  .emit(7_000, (e) => ({
    t: 'price',
    ...e,
    currentCents: 30_000,
    leaderPaddle: 7,
    nextMinCents: 35_000,
    bidCount: 5,
  }));

/** A dropped message forces a resync, then the socket closes and later reopens. */
export const reconnect_gap: Scenario = script.build(
  'reconnect_gap',
  'Sequence gap, snapshot resync and a disconnect',
);
