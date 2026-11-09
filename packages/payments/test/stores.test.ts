import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  FileHoldStore,
  FileJournalStore,
  FileWebhookEventStore,
  openFileStores,
} from '../src/stores/file.js';
import {
  MemoryHoldStore,
  MemoryJournalStore,
  MemoryWebhookEventStore,
  VersionConflict,
} from '../src/stores/memory.js';
import {
  holdStoreContract,
  journalStoreContract,
  makeJournal,
  webhookStoreContract,
} from './storeContract.js';

journalStoreContract('memory', () => new MemoryJournalStore());
webhookStoreContract('memory', () => new MemoryWebhookEventStore());
holdStoreContract('memory', () => new MemoryHoldStore());

const dirs: string[] = [];
function freshDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'gavel-stores-'));
  dirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

journalStoreContract('file', () => new FileJournalStore(join(freshDir(), 'j.json')));
webhookStoreContract('file', () => new FileWebhookEventStore(join(freshDir(), 'w.json')));
holdStoreContract('file', () => new FileHoldStore(join(freshDir(), 'h.json')));

describe('VersionConflict', () => {
  it('is a named error carrying both versions', async () => {
    const s = new MemoryJournalStore();
    await s.create(makeJournal('a1', 3));
    let err: unknown;
    try {
      await s.save(makeJournal('a1', 4), 2);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(VersionConflict);
    expect((err as VersionConflict).expectedVersion).toBe(2);
    expect((err as VersionConflict).actualVersion).toBe(3);
  });
});

describe('file stores survive a restart', () => {
  it('a new instance on the same directory sees journals, webhooks and holds', async () => {
    const dir = freshDir();
    const a = openFileStores(dir);
    await a.journals.create(makeJournal('a1', 0));
    await a.journals.save({ ...makeJournal('a1', 1), state: 'BIDDING' }, 0);
    await a.journals.acquireLease('a1', 'r1', 30000, 1000);
    await a.webhooks.insertIfAbsent({ id: 'e1', eventType: 'X', receivedAtMs: 1, body: '{}' });
    await a.webhooks.parkOrphan('e1', 600);
    await a.holds.put({
      holdId: 'h1',
      auctionId: 'a1',
      bidderId: 'b1',
      orderId: 'O-1',
      ceilingCents: 100,
      status: 'HELD',
      createdAtMs: 1,
    });

    const b = openFileStores(dir);
    expect((await b.journals.load('a1'))?.state).toBe('BIDDING');
    // RT4-saga-02: the lease of the process that died is not carried over.
    expect(await b.journals.acquireLease('a1', 'r2', 30000, 2000)).toBe(true);
    await expect(b.journals.save(makeJournal('a1', 5), 0)).rejects.toBeInstanceOf(VersionConflict);
    expect((await b.webhooks.listOrphans(0)).map((e) => e.id)).toEqual(['e1']);
    expect(
      await b.webhooks.insertIfAbsent({ id: 'e1', eventType: 'X', receivedAtMs: 2, body: '' }),
    ).toBe(false);
    expect((await b.holds.get('h1'))?.status).toBe('HELD');
  });

  it('leaves no temp files and uses a complete file after many writes', async () => {
    const dir = freshDir();
    const a = openFileStores(dir);
    await a.journals.create(makeJournal('a1', 0));
    for (let v = 1; v <= 5; v += 1) await a.journals.save(makeJournal('a1', v), v - 1);
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    expect(() => JSON.parse(readFileSync(join(dir, 'journals.json'), 'utf8'))).not.toThrow();
  });

  it('refuses to start empty on a corrupt journal file', () => {
    const dir = freshDir();
    writeFileSync(join(dir, 'journals.json'), '{"journals":{"a1":');
    expect(() => new FileJournalStore(join(dir, 'journals.json'))).toThrow(/not valid JSON/);
  });

  it('stores journals as canonical JSON', async () => {
    const s = new MemoryJournalStore();
    await s.create(makeJournal('a1'));
    const raw = s.snapshot().journals['a1'] ?? '';
    expect(raw.startsWith('{"auctionId":"a1"')).toBe(true);
    expect(raw).not.toContain(' ');
  });
});

describe('webhook retention (#2086)', () => {
  const ev = (id: string, receivedAtMs: number) => ({
    id,
    eventType: 'X',
    receivedAtMs,
    body: '{}',
  });

  it('prune drops processed events past the cutoff, never unprocessed ones', async () => {
    const s = new MemoryWebhookEventStore();
    await s.insertIfAbsent(ev('old-done', 1));
    await s.insertIfAbsent(ev('old-open', 2));
    await s.insertIfAbsent(ev('new-done', 100));
    await s.markProcessed('old-done', 'ok');
    await s.markProcessed('new-done', 'ok');
    expect(await s.prune(50)).toBe(1);
    expect(Object.keys(s.snapshot().events).sort()).toEqual(['new-done', 'old-open']);
    expect((await s.listUnprocessed()).map((e) => e.id)).toEqual(['old-open']);
    expect(await s.prune(50)).toBe(0);
  });

  it('a pruned id stays a duplicate, also after a restart on a file', async () => {
    const path = join(freshDir(), 'w.json');
    const a = new FileWebhookEventStore(path);
    await a.insertIfAbsent(ev('e1', 1));
    await a.markProcessed('e1', 'ok');
    await a.prune(10);
    expect(await a.insertIfAbsent(ev('e1', 20))).toBe(false);
    const b = new FileWebhookEventStore(path);
    expect(Object.keys(b.snapshot().events)).toEqual([]);
    expect(await b.insertIfAbsent(ev('e1', 20))).toBe(false);
  });

  it('a failed write on prune puts the events back', async () => {
    let fail = false;
    const s = new MemoryWebhookEventStore(undefined, () => {
      if (fail) throw new Error('disk full');
    });
    await s.insertIfAbsent(ev('e1', 1));
    await s.markProcessed('e1', 'ok');
    fail = true;
    await expect(s.prune(10)).rejects.toThrow('disk full');
    fail = false;
    expect(Object.keys(s.snapshot().events)).toEqual(['e1']);
    expect(s.snapshot().pruned).toBeUndefined();
  });
});

describe('hold index by authorization id (#2086)', () => {
  const rec = (holdId: string, authId: string | undefined, auctionId = 'a1') => ({
    holdId,
    auctionId,
    bidderId: 'b1',
    orderId: `O-${holdId}`,
    ...(authId === undefined ? {} : { authId }),
    ceilingCents: 100,
    status: 'HELD' as const,
    createdAtMs: 1,
  });

  it('follows a changed authId and a failed write', async () => {
    let fail = false;
    const s = new MemoryHoldStore(undefined, () => {
      if (fail) throw new Error('disk full');
    });
    await s.put(rec('h1', 'A1'));
    expect((await s.byAuthId('A1'))?.holdId).toBe('h1');
    await s.put(rec('h1', 'A2'));
    expect(await s.byAuthId('A1')).toBeNull();
    expect((await s.byAuthId('A2'))?.holdId).toBe('h1');
    fail = true;
    await expect(s.put(rec('h1', 'A3'))).rejects.toThrow('disk full');
    fail = false;
    expect(await s.byAuthId('A3')).toBeNull();
    expect((await s.byAuthId('A2'))?.holdId).toBe('h1');
    expect(await s.byAuthId('missing')).toBeNull();
  });

  it('is rebuilt from a saved file and keeps the per-auction listing', async () => {
    const path = join(freshDir(), 'h.json');
    const a = new FileHoldStore(path);
    await a.put(rec('h1', 'A1', 'x'));
    await a.put(rec('h2', undefined, 'y'));
    const b = new FileHoldStore(path);
    expect((await b.byAuthId('A1'))?.holdId).toBe('h1');
    expect((await b.listByAuction('y')).map((h) => h.holdId)).toEqual(['h2']);
    expect(await b.listByAuction('nope')).toEqual([]);
  });
});
