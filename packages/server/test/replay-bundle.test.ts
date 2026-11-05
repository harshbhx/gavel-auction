import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  ChainError,
  InMemoryLedgerStore,
  genesisHead,
  sealBatch,
  verifyPublicExport,
  type LedgerEvent,
  type Ulid,
} from '@gavel/engine';
import { isReplayBundle, type ReplayBundle } from '@gavel/shared';
import { describe, expect, it } from 'vitest';
import { buildReplayBundle, createReplayBundleHandler } from '../src/admin/replay-bundle';

const ID = 'A1' as Ulid;
const NOW = 5000;

async function seeded(): Promise<InMemoryLedgerStore> {
  const store = new InMemoryLedgerStore();
  const events = [
    { type: 'AUCTION_CREATED', payload: { note: 'x' } },
    { type: 'AUCTION_CLOSED', payload: { headHash: 'h' } },
  ] as unknown as LedgerEvent[];
  await store.append(ID, sealBatch(events, genesisHead(ID), 1000, null), 0);
  return store;
}

async function call(
  handler: ReturnType<typeof createReplayBundleHandler>,
  url: string,
  key?: string,
): Promise<{ status: number; body: string }> {
  const req = {
    method: 'GET',
    url,
    headers: key === undefined ? {} : { 'x-admin-key': key },
  } as unknown as IncomingMessage;
  return new Promise((resolve) => {
    let status = 0;
    const res = {
      setHeader: () => undefined,
      writeHead: (s: number) => {
        status = s;
      },
      end: (b: string) => resolve({ status, body: b }),
    } as unknown as ServerResponse;
    handler(req, res);
  });
}

describe('replay bundle (INTEGRATION-RT-22)', () => {
  it('builds a bundle a client can verify against its head hash', async () => {
    const entries = await (await seeded()).read(ID, 1);
    const b = buildReplayBundle(ID, entries, NOW);
    expect(isReplayBundle(b)).toBe(true);
    expect(b.generatedAt).toBe(NOW);
    expect(b.count).toBe(2);
    const v = verifyPublicExport(b.events as Parameters<typeof verifyPublicExport>[0]);
    expect(v.ok).toBe(true);
    expect(v.ok && v.headHash).toBe(b.headHash);
  });

  it('fails verification when an event is edited', async () => {
    const entries = await (await seeded()).read(ID, 1);
    const b = buildReplayBundle(ID, entries, NOW);
    const events = structuredClone(b.events);
    (events[0] as { payload: Record<string, unknown> }).payload = { note: 'edited' };
    const v = verifyPublicExport(events as Parameters<typeof verifyPublicExport>[0]);
    expect(v).toMatchObject({ ok: false, firstBadIndex: 0, reason: 'bad_hash' });
  });

  it('fails verification when events are dropped or reordered', async () => {
    const entries = await (await seeded()).read(ID, 1);
    const b = buildReplayBundle(ID, entries, NOW);
    type Arg = Parameters<typeof verifyPublicExport>[0];
    expect(verifyPublicExport([b.events[1]] as Arg)).toMatchObject({ ok: false });
    expect(verifyPublicExport([b.events[1], b.events[0]] as Arg)).toMatchObject({ ok: false });
    const head = { seq: 2, hash: 'x' };
    expect(
      verifyPublicExport(b.events.slice(0, 1) as Arg, undefined, { expectedHead: head }),
    ).toMatchObject({
      ok: false,
      reason: 'truncated',
    });
  });

  it('refuses to build from a tampered ledger', async () => {
    const entries = structuredClone(await (await seeded()).read(ID, 1));
    (entries[0] as { at: number }).at = 1;
    expect(() => buildReplayBundle(ID, entries, NOW)).toThrow(ChainError);
  });

  it('serves the bundle to the admin key only', async () => {
    const h = createReplayBundleHandler({ adminKey: 'k', ledger: await seeded(), now: () => NOW });
    expect((await call(h, `/admin/replay-bundle?auctionId=${ID}`)).status).toBe(401);
    expect((await call(h, '/admin/replay-bundle?auctionId=a%20b', 'k')).status).toBe(400);
    expect((await call(h, '/admin/replay-bundle?auctionId=NOPE', 'k')).status).toBe(404);
    const ok = await call(h, `/admin/replay-bundle?auctionId=${ID}`, 'k');
    expect(ok.status).toBe(200);
    const b = JSON.parse(ok.body) as ReplayBundle;
    expect(isReplayBundle(b)).toBe(true);
    expect(b.headHash).not.toBeNull();
  });
});
