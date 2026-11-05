import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  InMemoryLedgerStore,
  genesisHead,
  sealBatch,
  verifyChain,
  type LedgerEvent,
  type Ulid,
} from '@gavel/engine';
import { describe, expect, it } from 'vitest';
import { createExportHandler, parseNdjson, toNdjson } from '../src/admin/export';

const ID = 'A1' as Ulid;

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
  handler: ReturnType<typeof createExportHandler>,
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

describe('admin export (T-QA-085)', () => {
  it('requires the admin token', async () => {
    const h = createExportHandler({ adminKey: 'k', ledger: await seeded() });
    expect((await call(h, '/admin/export?auctionId=A1')).status).toBe(401);
    expect((await call(h, '/admin/export?auctionId=A1', 'wrong')).status).toBe(401);
  });

  it('rejects a bad auction id', async () => {
    const h = createExportHandler({ adminKey: 'k', ledger: await seeded() });
    expect((await call(h, '/admin/export?auctionId=a/b', 'k')).status).toBe(400);
  });

  it('verifyChain accepts the export', async () => {
    const h = createExportHandler({ adminKey: 'k', ledger: await seeded() });
    const out = await call(h, '/admin/export?auctionId=A1', 'k');
    expect(out.status).toBe(200);
    const parsed = parseNdjson(out.body);
    expect(parsed).not.toBeNull();
    const { entries, head } = parsed ?? { entries: [], head: null };
    expect(head).not.toBeNull();
    expect(verifyChain(entries, head ? { expectedHead: head } : {}).ok).toBe(true);
  });

  it('rejects a truncated export', async () => {
    const store = await seeded();
    const all = await store.read(ID, 1);
    const parsed = parseNdjson(toNdjson(all));
    const head = parsed?.head;
    expect(head).toBeTruthy();
    const short = all.slice(0, 1);
    expect(verifyChain(short, head ? { expectedHead: head } : {}).ok).toBe(false);
  });
});
