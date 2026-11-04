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
import { join } from 'node:path';
import { GENESIS_PREV, LedgerConflict } from '@gavel/engine';
import type { LedgerEntry, LedgerStore, Ulid } from '@gavel/engine';

/**
 * A durable LedgerStore for one host: one JSON-lines file per auction, one line
 * per appended batch (R-ENG-076, R-ENG-104, R-QA-027).
 *
 * A batch is written as a single line and synced before `append` resolves, so a
 * crash leaves either the whole batch or none of it: a torn last line fails to
 * parse on the next start and is dropped. The checks on `expectedHeadSeq`,
 * contiguity and `prev` are the same as the in-memory store.
 *
 * Write order for the three records (see docs/DECISIONS.md): the engine ledger is
 * written first and is the source of truth; the room log is derived from it; the
 * payments journal is saved only after LOT_HAMMERED is in the ledger.
 */
export class FileLedgerStore implements LedgerStore {
  private readonly ledgers = new Map<string, LedgerEntry[]>();

  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  private path(auctionId: string): string {
    if (!/^[0-9A-Za-z]{1,64}$/.test(auctionId)) throw new RangeError('bad auction id');
    return join(this.dir, `${auctionId}.ledger.jsonl`);
  }

  private load(auctionId: string): LedgerEntry[] {
    const cached = this.ledgers.get(auctionId);
    if (cached !== undefined) return cached;
    let text = '';
    try {
      text = readFileSync(this.path(auctionId), 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    const entries: LedgerEntry[] = [];
    let good = 0;
    // Only newline-terminated lines count: the last segment is an unfinished write.
    for (const line of text.split('\n').slice(0, -1)) {
      if (line === '') {
        good += 1;
        continue;
      }
      try {
        entries.push(...(JSON.parse(line) as LedgerEntry[]));
        good += Buffer.byteLength(line) + 1;
      } catch {
        // A newline-terminated line that does not parse is corruption, not a torn tail.
        throw new Error(`ledger file for ${auctionId} is corrupt at byte ${good}`);
      }
    }
    // Cut the unterminated final segment (a crash mid-write) so the next batch starts on a fresh line.
    if (good < Buffer.byteLength(text)) truncateSync(this.path(auctionId), good);
    this.ledgers.set(auctionId, entries);
    return entries;
  }

  async append(
    auctionId: Ulid,
    entries: readonly LedgerEntry[],
    expectedHeadSeq: number,
  ): Promise<void> {
    const cur = this.load(auctionId);
    if (cur.length !== expectedHeadSeq) throw new LedgerConflict(expectedHeadSeq, cur.length);
    const foreign = entries.findIndex((e) => e.auctionId !== auctionId);
    if (foreign >= 0) throw new RangeError(`entry at index ${foreign} belongs to another auction`);
    const headHash = cur.at(-1)?.hash ?? GENESIS_PREV;
    if (entries[0] !== undefined && entries[0].prev !== headHash) {
      throw new RangeError('first entry does not extend the stored head');
    }
    const gap = entries.findIndex((e, i) => e.seq !== expectedHeadSeq + i + 1);
    if (gap >= 0) throw new RangeError(`entry at index ${gap} is not contiguous`);
    if (entries.length === 0) return;

    const fd = openSync(this.path(auctionId), 'a');
    try {
      const before = fstatSync(fd).size;
      try {
        writeSync(fd, `${JSON.stringify(entries)}\n`);
        fsyncSync(fd);
      } catch (e) {
        // A partial line would swallow the next batch: cut it back and drop the cache.
        try {
          ftruncateSync(fd, before);
        } catch {
          // The write error is the one worth reporting.
        }
        this.ledgers.delete(auctionId);
        throw e;
      }
    } finally {
      closeSync(fd);
    }
    cur.push(...entries);
  }

  async read(auctionId: Ulid, fromSeq: number): Promise<LedgerEntry[]> {
    return this.load(auctionId).filter((e) => e.seq >= fromSeq);
  }

  async head(auctionId: Ulid): Promise<{ seq: number; hash: string } | null> {
    const last = this.load(auctionId).at(-1);
    return last === undefined ? null : { seq: last.seq, hash: last.hash };
  }
}
