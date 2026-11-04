import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  truncateSync,
  writeSync,
} from 'node:fs';
import { join } from 'node:path';
import { GENESIS_PREV, LedgerConflict } from '@gavel/engine';
import type { LedgerEntry, LedgerStore, Ulid } from '@gavel/engine';

/** Calls `write(buf, offset)` until every byte is out; `write` returns how many it wrote. */
export function writeFully(buf: Buffer, write: (buf: Buffer, offset: number) => number): void {
  let off = 0;
  while (off < buf.length) {
    const n = write(buf, off);
    if (n <= 0) throw new Error('ledger write made no progress');
    off += n;
  }
}

function fsyncDir(dir: string): void {
  const fd = openSync(dir, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** The ledger file is damaged somewhere before its tail; it is left as found. */
export class LedgerCorruption extends Error {
  constructor(
    readonly file: string,
    detail: string,
  ) {
    super(`ledger file is corrupt (${detail}): ${file}`);
    this.name = 'LedgerCorruption';
  }
}

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
    const lines = text.split('\n');
    // Only the final, newline-less segment can be a torn write: every append ends
    // with a newline, so a terminated line is a complete batch. A terminated line
    // that does not parse, or does not extend the chain, is damage; keep the file
    // untouched and refuse to load it (R-ENG-076).
    const tail = lines.pop() ?? '';
    for (const [i, line] of lines.entries()) {
      if (line === '') continue;
      let batch: unknown;
      try {
        batch = JSON.parse(line);
      } catch {
        throw new LedgerCorruption(this.path(auctionId), `line ${i + 1} does not parse`);
      }
      if (!Array.isArray(batch)) {
        throw new LedgerCorruption(this.path(auctionId), `line ${i + 1} is not a batch`);
      }
      for (const e of batch as LedgerEntry[]) {
        const want = entries.at(-1)?.hash ?? GENESIS_PREV;
        if (e.seq !== entries.length + 1 || e.prev !== want) {
          throw new LedgerCorruption(this.path(auctionId), `line ${i + 1} breaks the chain`);
        }
        entries.push(e);
      }
    }
    // Cut the unfinished write off so the next batch starts on a fresh line.
    if (tail !== '')
      truncateSync(this.path(auctionId), Buffer.byteLength(text) - Buffer.byteLength(tail));
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

    const file = this.path(auctionId);
    const created = !existsSync(file);
    const before = created ? 0 : statSync(file).size;
    const fd = openSync(file, 'a');
    try {
      const buf = Buffer.from(`${JSON.stringify(entries)}\n`, 'utf8');
      // writeSync may write less than asked; loop until the whole line is out.
      writeFully(buf, (b, off) => writeSync(fd, b, off, b.length - off));
      fsyncSync(fd);
    } catch (e) {
      // Do not leave a partial line behind for the next append to build on.
      try {
        truncateSync(file, before);
      } catch {
        this.ledgers.delete(auctionId);
      }
      throw e;
    } finally {
      closeSync(fd);
    }
    // A new file is only durable once its directory entry is too.
    if (created) fsyncDir(this.dir);
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
