import { Cents, EpochMs } from '@gavel/shared';
import type { Scenario } from '../../net/transport';
import { baseConfig, bidderId } from '../builders';
import { Script, bidders, openSnapshot } from './_kit';

const roster = bidders([12, 'Priya'], [7, 'Sam']);

function priceAt(
  script: Script,
  at: number,
  paddle: number,
  cents: number,
  fault?: 'drop' | 'disconnect',
): void {
  script.emit(
    at,
    (e) => ({
      v: 1,
      t: 'price',
      ...e,
      price: Cents(cents),
      leaderId: bidderId(paddle),
      leaderPaddle: paddle,
      endTs: baseConfig.endTs,
      minNext: Cents(cents + 5_000),
      extensions: 0,
    }),
    fault,
  );
}

const script = new Script().state(0, openSnapshot(roster)).acceptedBid(1_000, 7, 10_000);
// seq 4 is lost, so seq 5 arrives with a gap and the client asks for a snapshot.
priceAt(script, 2_000, 12, 15_000, 'drop');
priceAt(script, 3_000, 7, 20_000);
script.emit(4_000, (e) => ({
  v: 1,
  t: 'state',
  ...e,
  snapshot: {
    ...openSnapshot(roster),
    price: Cents(20_000),
    leaderId: bidderId(7),
    minNext: Cents(25_000),
    endTs: EpochMs(baseConfig.endTs),
  },
}));
// The connection drops here; the next message arrives after the client reconnects.
priceAt(script, 5_000, 12, 25_000, 'disconnect');
priceAt(script, 7_000, 7, 30_000);

/** A dropped message forces a resync, then the socket closes and later reopens. */
export const reconnect_gap: Scenario = script.build(
  'reconnect_gap',
  'Sequence gap, snapshot resync and a disconnect',
);
