import {
  REPLAY_BUNDLE_VERSION,
  REPLAY_EXPORT_VERSION,
  hashPublicEntry,
  type ReplayBundle,
  type ReplayEvent,
} from '@gavel/shared';

const ID = 'A1';

/** A well-formed export v4 chain built with the shared hasher (the server test pins it to the engine). */
export function makeLedgerBundle(): ReplayBundle {
  const events: ReplayEvent[] = [];
  let prev = '0'.repeat(64);
  const types = ['AUCTION_CREATED', 'AUCTION_CLOSED'];
  types.forEach((type, i) => {
    const body = {
      v: 4 as const,
      auctionId: ID,
      seq: i + 1,
      at: 1000,
      type,
      cmd: null,
      payload: type === 'AUCTION_CLOSED' ? { headHash: prev } : { note: 'x' },
      redacted: [] as string[],
      fullHash: null,
      prev,
    };
    const hash = hashPublicEntry(body);
    events.push({ ...body, hash });
    prev = hash;
  });
  return {
    version: REPLAY_BUNDLE_VERSION,
    exportVersion: REPLAY_EXPORT_VERSION,
    auctionId: ID,
    generatedAt: 5000,
    count: events.length,
    headHash: prev,
    closed: false,
    events,
  };
}

/** The same bundle with the payload of entry `index` (0-based) edited after sealing. */
export function tamperedBundle(index = 0): ReplayBundle {
  const b = makeLedgerBundle();
  const e = b.events[index];
  if (e === undefined) throw new Error('no such entry');
  e.payload = { ...e.payload, note: 'edited' };
  return b;
}
