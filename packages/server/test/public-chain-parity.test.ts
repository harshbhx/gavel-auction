import {
  InMemoryLedgerStore,
  genesisHead,
  sealBatch,
  verifyPublicExport,
  type LedgerEvent,
  type Ulid,
} from '@gavel/engine';
import { verifyPublicChain, type ReplayEvent } from '@gavel/shared';
import { describe, expect, it } from 'vitest';
import { buildReplayBundle } from '../src/admin/replay-bundle';

const ID = 'A1' as Ulid;

async function bundle() {
  const store = new InMemoryLedgerStore();
  const events = [
    { type: 'AUCTION_CREATED', payload: { note: 'x' } },
    { type: 'AUCTION_CLOSED', payload: { headHash: 'h' } },
  ] as unknown as LedgerEvent[];
  await store.append(ID, sealBatch(events, genesisHead(ID), 1000, null), 0);
  return buildReplayBundle(ID, await store.read(ID, 1), 5000);
}

type Engine = Parameters<typeof verifyPublicExport>[0];

describe('shared public-chain verifier matches the engine (web cannot import the engine)', () => {
  it('agrees on an untouched bundle, including the head and closed flag', async () => {
    const b = await bundle();
    const a = verifyPublicChain(b.events, { seq: b.count, hash: b.headHash as string });
    const e = verifyPublicExport(b.events as Engine);
    expect(a).toEqual(e);
  });

  it('agrees on edits, reorders, removals and a cut tail', async () => {
    const b = await bundle();
    const edited = structuredClone(b.events);
    (edited[0] as ReplayEvent).payload = { note: 'edited' };
    const swapped = [b.events[1], b.events[0]] as ReplayEvent[];
    const dropped = b.events.slice(1);
    const relinked = structuredClone(b.events);
    (relinked[1] as ReplayEvent).prev = '1'.repeat(64);
    for (const evs of [edited, swapped, dropped, relinked]) {
      expect(verifyPublicChain(evs)).toEqual(verifyPublicExport(evs as Engine));
    }
    const cut = b.events.slice(0, 1);
    expect(verifyPublicChain(cut, { seq: b.count, hash: b.headHash as string })).toEqual(
      verifyPublicExport(cut as Engine, undefined, {
        expectedHead: { seq: b.count, hash: b.headHash as string },
      }),
    );
  });
});
