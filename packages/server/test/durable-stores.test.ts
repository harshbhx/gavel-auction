import {
  mkdtempSync,
  rmSync,
  appendFileSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GENESIS_PREV } from '@gavel/engine';
import type { LedgerEntry, Ulid } from '@gavel/engine';
import { SeqIds, type AuctionId, type EpochMs, type Jti, type RoomEvent } from '@gavel/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { runStoreContract } from '../../engine/src/testing/store-contract';
import { journalStoreContract, makeJournal } from '../../payments/test/storeContract';
import { FileLedgerStore } from '../src/store/file-ledger-store';
import { FileRoomStore } from '../src/store/file-room-store';
import { MemoryStore } from '../src/store/memory-store';
import { RoomJournalStore } from '../src/store/room-journal-store';

const dirs: string[] = [];
function freshDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'gavel-durable-'));
  dirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

// R-ENG-104: the file ledger passes the same contract as the in-memory store.
runStoreContract(async () => new FileLedgerStore(freshDir()));

// R-PAY-041, R-PAY-043: a RoomStore backs the payments JournalStore, lease included.
journalStoreContract('room-store (memory)', () => new RoomJournalStore(new MemoryStore()));

const A = pad('A1');
function pad(s: string): Ulid {
  return s.padStart(26, '0') as Ulid;
}

function entry(seq: number, prev: string): LedgerEntry {
  return {
    v: 1,
    auctionId: A,
    seq,
    at: seq,
    type: 'LOT_ADDED',
    cmd: null,
    payload: { lotId: A },
    prev,
    hash: `h${seq}`.padEnd(64, '0'),
  };
}

describe('FileLedgerStore crash and resume (R-QA-027)', () => {
  it('a new instance on the same directory sees every acknowledged batch', async () => {
    const dir = freshDir();
    const first = new FileLedgerStore(dir);
    const e1 = entry(1, GENESIS_PREV);
    const e2 = entry(2, e1.hash);
    await first.append(A, [e1, e2], 0);
    await first.append(A, [entry(3, e2.hash)], 2);

    const restarted = new FileLedgerStore(dir);
    expect((await restarted.read(A, 1)).map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(await restarted.head(A)).toEqual(await first.head(A));
    await restarted.append(A, [entry(4, entry(3, e2.hash).hash)], 3);
    expect((await new FileLedgerStore(dir).head(A))?.seq).toBe(4);
  });

  it('drops a batch that was torn by a crash and keeps the earlier ones', async () => {
    const dir = freshDir();
    const store = new FileLedgerStore(dir);
    const e1 = entry(1, GENESIS_PREV);
    await store.append(A, [e1], 0);
    const file = readdirSync(dir).find((f) => f.endsWith('.ledger.jsonl'));
    if (file === undefined) throw new Error('no ledger file');
    appendFileSync(join(dir, file), '[{"v":1,"auctionId":"');

    const restarted = new FileLedgerStore(dir);
    expect((await restarted.head(A))?.seq).toBe(1);
    await restarted.append(A, [entry(2, e1.hash)], 1);
    expect((await new FileLedgerStore(dir).read(A, 1)).map((e) => e.seq)).toEqual([1, 2]);
  });
});

describe('FileRoomStore crash and resume (R-RT-093)', () => {
  const ids = new SeqIds();
  const AID = ids.mint<'AuctionId'>() as AuctionId;
  const ev = (seq: number): RoomEvent =>
    ({ type: 'settle_requested', auctionId: AID, seq, ts: 1000 as EpochMs }) as RoomEvent;

  it('keeps events, snapshot, denied tokens and journal slots across a restart', async () => {
    const file = join(freshDir(), 'room.jsonl');
    const first = await FileRoomStore.open(file, () => 0);
    await first.appendEvents(AID, 0, [ev(1), ev(2)]);
    await first.saveSnapshot(AID, 2, { n: 2 });
    await first.denyJti('j1' as Jti, 5000 as EpochMs);
    expect(await first.consumeJti('j2' as Jti, 1000)).toBe(true);
    await first.putJournal('journal:x', 0, { version: 0 });
    first.close();

    const second = await FileRoomStore.open(file, () => 0);
    expect(await second.lastSeq(AID)).toBe(2);
    expect((await second.readEvents(AID, 1, 10)).map((e) => e.seq)).toEqual([1, 2]);
    expect(await second.loadSnapshot(AID)).toEqual({ seq: 2, state: { n: 2 } });
    expect(await second.isDenied('j1' as Jti)).toBe(true);
    expect(await second.consumeJti('j2' as Jti, 1000)).toBe(false);
    expect(await second.getJournal('journal:x')).toEqual({ version: 1, value: { version: 0 } });
    await second.appendEvents(AID, 2, [ev(3)]);
    second.close();
    const third = await FileRoomStore.open(file, () => 0);
    expect(await third.lastSeq(AID)).toBe(3);
    third.close();
  });

  it('rejected writes leave nothing in the file', async () => {
    const file = join(freshDir(), 'room.jsonl');
    const first = await FileRoomStore.open(file);
    await first.appendEvents(AID, 0, [ev(1)]);
    await expect(first.appendEvents(AID, 0, [ev(1)])).rejects.toThrow();
    first.close();
    const second = await FileRoomStore.open(file);
    expect(await second.lastSeq(AID)).toBe(1);
    second.close();
  });

  it('a payments journal and its lease survive a restart through RoomJournalStore', async () => {
    const file = join(freshDir(), 'room.jsonl');
    const first = await FileRoomStore.open(file);
    const journals = new RoomJournalStore(first);
    await journals.create(makeJournal('lot1', 0));
    await journals.save({ ...makeJournal('lot1', 1), state: 'BIDDING' }, 0);
    expect(await journals.acquireLease('lot1', 'host-a', 30000, 1000)).toBe(true);
    first.close();

    const restarted = new RoomJournalStore(await FileRoomStore.open(file));
    expect((await restarted.load('lot1'))?.state).toBe('BIDDING');
    expect(await restarted.acquireLease('lot1', 'host-b', 30000, 2000)).toBe(false);
    await restarted.save({ ...makeJournal('lot1', 2), state: 'VOIDING' }, 1);
  });
});

describe('RoomJournalStore errors and version rule', () => {
  it('maps room conflicts to the saga error types and keeps the version offset', async () => {
    const room = new MemoryStore();
    const journals = new RoomJournalStore(room);
    await journals.create(makeJournal('lot1', 0));
    expect((await room.getJournal('journal:lot1'))?.version).toBe(1);
    await expect(journals.create(makeJournal('lot1', 0))).rejects.toMatchObject({
      name: 'JournalExists',
    });
    await journals.save(makeJournal('lot1', 1), 0);
    expect((await room.getJournal('journal:lot1'))?.version).toBe(2);
    await expect(journals.save(makeJournal('lot1', 1), 0)).rejects.toMatchObject({
      name: 'VersionConflict',
      expectedVersion: 0,
      actualVersion: 1,
    });
  });
});

describe('round 3 blocking fixes (RT3)', () => {
  const ids = new SeqIds();
  const AID = ids.mint<'AuctionId'>() as AuctionId;
  const ev = (seq: number): RoomEvent =>
    ({ type: 'settle_requested', auctionId: AID, seq, ts: 1000 as EpochMs }) as RoomEvent;

  it('FileRoomStore keeps memory unchanged when the write fails (SERVICE-R3-04)', async () => {
    const file = join(freshDir(), 'room.jsonl');
    const store = await FileRoomStore.open(file);
    await store.appendEvents(AID, 0, [ev(1)]);
    await store.putJournal('journal:x', 0, { n: 1 });
    store.close(); // every later write fails
    await expect(store.appendEvents(AID, 1, [ev(2)])).rejects.toThrow();
    await expect(store.putJournal('journal:x', 1, { n: 2 })).rejects.toThrow();
    expect(await store.lastSeq(AID)).toBe(1);
    expect((await store.getJournal('journal:x'))?.version).toBe(1);
  });

  it('FileRoomStore refuses to boot on a corrupt line in the middle (SERVICE-R3-05)', async () => {
    const file = join(freshDir(), 'room.jsonl');
    const store = await FileRoomStore.open(file);
    await store.appendEvents(AID, 0, [ev(1)]);
    await store.appendEvents(AID, 1, [ev(2)]);
    store.close();
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.splice(1, 0, '{"k":"events","auct');
    writeFileSync(file, lines.join('\n'));
    await expect(FileRoomStore.open(file)).rejects.toThrow(/corrupt/);
    // The file is left as it was, so nothing acknowledged is lost.
    expect(readFileSync(file, 'utf8').split('\n')).toHaveLength(lines.length);
  });

  it('FileLedgerStore refuses to load a corrupt line in the middle (SERVICE-R3-05)', async () => {
    const dir = freshDir();
    const store = new FileLedgerStore(dir);
    const e1 = entry(1, GENESIS_PREV);
    const e2 = entry(2, e1.hash);
    await store.append(A, [e1], 0);
    await store.append(A, [e2], 1);
    const file = join(dir, readdirSync(dir).find((f) => f.endsWith('.ledger.jsonl')) ?? '');
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.splice(1, 0, '[{"v":1,"auctionId":"');
    writeFileSync(file, lines.join('\n'));
    const restarted = new FileLedgerStore(dir);
    await expect(restarted.head(A)).rejects.toThrow(/corrupt/);
    expect(readFileSync(file, 'utf8').split('\n')).toHaveLength(lines.length);
  });
});
