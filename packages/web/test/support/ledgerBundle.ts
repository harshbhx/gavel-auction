import {
  genesisHead,
  publicExport,
  sealBatch,
  verifyPublicExport,
  type LedgerEvent,
  type Ulid,
} from '@gavel/engine';
import { REPLAY_BUNDLE_VERSION, REPLAY_EXPORT_VERSION, type ReplayBundle } from '@gavel/shared';

const ID = 'A1' as Ulid;

/** A real replay bundle: sealed by the engine, redacted to export v4, head hash included. */
export function makeLedgerBundle(): ReplayBundle {
  const events = [
    { type: 'AUCTION_CREATED', payload: { note: 'x' } },
    { type: 'AUCTION_CLOSED', payload: { headHash: 'h' } },
  ] as unknown as LedgerEvent[];
  const entries = sealBatch(events, genesisHead(ID), 1000, null);
  const pub = publicExport(entries);
  const v = verifyPublicExport(pub);
  if (!v.ok) throw new Error('fixture does not verify');
  return {
    version: REPLAY_BUNDLE_VERSION,
    exportVersion: REPLAY_EXPORT_VERSION,
    auctionId: ID,
    generatedAt: 5000,
    count: pub.length,
    headHash: v.headHash,
    closed: v.closed,
    events: structuredClone(pub) as unknown as ReplayBundle['events'],
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
