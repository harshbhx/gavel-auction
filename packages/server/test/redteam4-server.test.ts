import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GENESIS_PREV } from '@gavel/engine';
import type { LedgerEntry, Ulid } from '@gavel/engine';
import type { AuctionId, EpochMs, RoomEvent } from '@gavel/shared';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createExportHandler, exportLines } from '../src/http/export';
import { FileLedgerStore } from '../src/store/file-ledger-store';

const hooks = vi.hoisted(() => ({ failDirSync: false }));

vi.mock('node:fs', async (orig) => {
  const real = await orig<typeof import('node:fs')>();
  return {
    ...real,
    openSync: ((path: string, flags: string, ...rest: unknown[]) => {
      if (hooks.failDirSync && flags === 'r') throw new Error('EIO: directory sync failed');
      return (real.openSync as (...a: unknown[]) => number)(path, flags, ...rest);
    }) as typeof real.openSync,
  };
});

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const A = 'A1'.padStart(26, '0') as Ulid;
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
  } as unknown as LedgerEntry;
}

describe('FileLedgerStore first write (R4-E04)', () => {
  it('R-ENG-076 R-ENG-102 a failed directory sync leaves no file and the retry succeeds', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gavel-rt4-'));
    dirs.push(dir);
    const store = new FileLedgerStore(dir);
    hooks.failDirSync = true;
    await expect(store.append(A, [entry(1, GENESIS_PREV)], 0)).rejects.toThrow('EIO');
    hooks.failDirSync = false;
    expect(existsSync(join(dir, `${A}.ledger.jsonl`))).toBe(false);
    expect(await store.head(A)).toBeNull();
    await store.append(A, [entry(1, GENESIS_PREV)], 0);
    const restarted = new FileLedgerStore(dir);
    expect((await restarted.read(A, 1)).map((e) => e.seq)).toEqual([1]);
  });
});

const auctionId = 'AU'.padStart(26, '0') as AuctionId;
const ev = (seq: number): RoomEvent =>
  ({ type: 'settle_requested', auctionId, seq, ts: seq as EpochMs }) as RoomEvent;

async function collect(it: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const l of it) out.push(l);
  return out;
}

describe('export paging (R4-E06)', () => {
  it('R-RT-108 a page that skips a seq fails the stream', async () => {
    const store = { readEvents: async () => [ev(1), ev(3)] };
    await expect(collect(exportLines(store, auctionId, 'admin'))).rejects.toThrow('expected seq 2');
  });

  it('R-RT-108 a store that stops before its last seq fails the stream', async () => {
    const store = {
      readEvents: async (_a: AuctionId, from: number) => (from === 1 ? [ev(1), ev(2)] : []),
      lastSeq: async () => 3,
    };
    await expect(collect(exportLines(store, auctionId, 'admin'))).rejects.toThrow('reaches 3');
  });

  it('R-RT-108 a short page in the middle does not end the export', async () => {
    const all = [ev(1), ev(2), ev(3), ev(4)];
    const store = {
      readEvents: async (_a: AuctionId, from: number) =>
        all.filter((e) => e.seq >= from).slice(0, 2),
      lastSeq: async () => 4,
    };
    expect(await collect(exportLines(store, auctionId, 'admin'))).toHaveLength(4);
  });
});

function fakeRes() {
  const res = new EventEmitter() as EventEmitter & {
    destroyed: boolean;
    status: number;
    writes: string[];
    ended: boolean;
    writeHead: (s: number) => void;
    setHeader: () => void;
    write: (t: string) => boolean;
    end: (t?: string) => void;
    destroy: () => void;
  };
  res.destroyed = false;
  res.status = 0;
  res.writes = [];
  res.ended = false;
  res.setHeader = () => undefined;
  res.writeHead = (s) => {
    res.status = s;
  };
  res.write = (t) => {
    res.writes.push(t);
    return false;
  };
  res.end = () => {
    res.ended = true;
  };
  res.destroy = () => {
    res.destroyed = true;
    res.emit('close');
  };
  return res;
}
const req = {
  method: 'GET',
  url: `/api/auctions/${auctionId}/export`,
  headers: {},
} as IncomingMessage;

describe('export handler failures (R4-E05)', () => {
  it('R-RT-108 a client that disconnects while the buffer is full does not hang the handler', async () => {
    const res = fakeRes();
    const handler = createExportHandler({
      store: { readEvents: async (_a, from) => (from === 1 ? [ev(1), ev(2)] : []) },
      authenticate: async () => 'admin',
    });
    const done = handler(req, res as unknown as ServerResponse);
    setTimeout(() => res.emit('close'), 5);
    await done;
    expect(res.destroyed).toBe(true);
    expect(res.writes).toHaveLength(1);
    expect(res.ended).toBe(false);
  });

  it('R-RT-108 a store error before the header answers 500', async () => {
    const res = fakeRes();
    const handler = createExportHandler({
      store: {
        readEvents: async () => {
          throw new Error('disk');
        },
      },
      authenticate: async () => 'admin',
    });
    await handler(req, {
      ...res,
      writeHead: res.writeHead,
      end: res.end,
      setHeader: res.setHeader,
    } as never);
    expect(res.status).toBe(500);
  });

  it('R-RT-108 a store error after the header cuts the connection instead of ending cleanly', async () => {
    const res = fakeRes();
    res.write = (t) => {
      res.writes.push(t);
      return true;
    };
    const handler = createExportHandler({
      store: {
        readEvents: async (_a, from) => {
          if (from === 1) return [ev(1)];
          throw new Error('disk');
        },
      },
      authenticate: async () => 'admin',
    });
    await handler(req, res as unknown as ServerResponse);
    expect(res.status).toBe(200);
    expect(res.destroyed).toBe(true);
    expect(res.ended).toBe(false);
  });
});
