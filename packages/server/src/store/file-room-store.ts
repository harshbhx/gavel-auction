import {
  closeSync,
  fstatSync,
  fsyncSync,
  ftruncateSync,
  mkdirSync,
  openSync,
  readFileSync,
  truncateSync,
  writeSync,
} from 'node:fs';
import { dirname } from 'node:path';
import type { AuctionId, EpochMs, Jti, RoomEvent } from '@gavel/shared';
import { MemoryStore } from './memory-store';

type LogRecord =
  | { k: 'events'; auctionId: AuctionId; expectedSeq: number; events: RoomEvent[] }
  | { k: 'snapshot'; auctionId: AuctionId; seq: number; state: unknown }
  | { k: 'jti'; jti: Jti; ttlMs: number }
  | { k: 'deny'; jti: Jti; untilMs: EpochMs }
  | { k: 'journal'; key: string; expectedVersion: number; value: unknown };

/**
 * A RoomStore that survives a restart: the full MemoryStore behaviour with every
 * accepted write also appended to a JSON-lines file and synced (R-RT-093). On
 * `open` the file is replayed through the same methods, so the rules cannot
 * drift. A torn last line from a crash is dropped. Single host, single process.
 */
export class FileRoomStore extends MemoryStore {
  private fd = -1;
  private replaying = true;

  private constructor(now: () => number) {
    super(now);
  }

  static async open(file: string, now: () => number = () => 0): Promise<FileRoomStore> {
    mkdirSync(dirname(file), { recursive: true });
    const store = new FileRoomStore(now);
    let text = '';
    try {
      text = readFileSync(file, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    let good = 0;
    // Only the final unterminated segment is a torn write; an unreadable line that ends in a
    // newline is corruption and must stop the boot instead of silently dropping what follows.
    for (const line of text.split('\n').slice(0, -1)) {
      if (line === '') {
        good += 1;
        continue;
      }
      let rec: LogRecord;
      try {
        rec = JSON.parse(line) as LogRecord;
      } catch {
        throw new Error(`room store file is corrupt at byte ${good}`);
      }
      await store.apply(rec);
      good += Buffer.byteLength(line) + 1;
    }
    // Cut a torn tail so the next record starts on a fresh line.
    if (good < Buffer.byteLength(text)) truncateSync(file, good);
    store.replaying = false;
    store.fd = openSync(file, 'a');
    return store;
  }

  /** Closes the file; the store must not be used afterwards. */
  close(): void {
    if (this.fd >= 0) closeSync(this.fd);
    this.fd = -1;
  }

  private async apply(r: LogRecord): Promise<void> {
    switch (r.k) {
      case 'events':
        return super.appendEvents(r.auctionId, r.expectedSeq, r.events);
      case 'snapshot':
        return super.saveSnapshot(r.auctionId, r.seq, r.state);
      case 'jti':
        await super.consumeJti(r.jti, r.ttlMs);
        return;
      case 'deny':
        return super.denyJti(r.jti, r.untilMs);
      case 'journal':
        return super.putJournal(r.key, r.expectedVersion, r.value);
    }
  }

  private persist(r: LogRecord): void {
    if (this.replaying) return;
    const before = fstatSync(this.fd).size;
    try {
      writeSync(this.fd, `${JSON.stringify(r)}\n`);
      fsyncSync(this.fd);
    } catch (e) {
      // Drop any partial bytes so the next record starts on a fresh line.
      try {
        ftruncateSync(this.fd, before);
      } catch {
        // The original error is the one worth reporting.
      }
      throw e;
    }
  }

  override async appendEvents(
    auctionId: AuctionId,
    expectedSeq: number,
    events: RoomEvent[],
  ): Promise<void> {
    // Check, write and sync, then apply: a failed write must leave memory as it was.
    this.checkAppend(auctionId, expectedSeq, events);
    this.persist({ k: 'events', auctionId, expectedSeq, events });
    await super.appendEvents(auctionId, expectedSeq, events);
  }

  override async saveSnapshot(auctionId: AuctionId, seq: number, state: unknown): Promise<void> {
    this.persist({ k: 'snapshot', auctionId, seq, state });
    await super.saveSnapshot(auctionId, seq, state);
  }

  override async consumeJti(jti: Jti, ttlMs: number): Promise<boolean> {
    if (!this.jtiIsFresh(jti)) return false;
    this.persist({ k: 'jti', jti, ttlMs });
    return super.consumeJti(jti, ttlMs);
  }

  override async denyJti(jti: Jti, untilMs: EpochMs): Promise<void> {
    this.persist({ k: 'deny', jti, untilMs });
    await super.denyJti(jti, untilMs);
  }

  override async putJournal(key: string, expectedVersion: number, value: unknown): Promise<void> {
    this.checkJournal(key, expectedVersion);
    this.persist({ k: 'journal', key, expectedVersion, value });
    await super.putJournal(key, expectedVersion, value);
  }
}
