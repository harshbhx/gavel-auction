import { SeqIds } from '@gavel/shared';
import type { AuctionId, EpochMs, RoomEvent } from '@gavel/shared';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate, PostgresStore } from '../src/store/postgres';
import { runStoreContract } from './store-contract';

/** Runs in the CI job with a Postgres service container; skipped when no URL is given. */
const url = process.env.GAVEL_TEST_DATABASE_URL;
const run = url === undefined ? describe.skip : describe;

run('PostgresStore (R-RT-093, R-RT-096)', () => {
  const pool = new pg.Pool({ connectionString: url, max: 30 });
  const ids = new SeqIds();

  beforeAll(async () => {
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
  });
  afterAll(async () => {
    await pool.end();
  });

  it('migrates a fresh database, a second run is a no-op (T-RT-070)', async () => {
    const first = await migrate(pool);
    expect(first.length).toBeGreaterThan(0);
    expect(await migrate(pool)).toEqual([]);
    const rows = await pool.query('SELECT version FROM schema_migrations');
    expect(rows.rowCount).toBe(first.length);
  });

  it('applies each version once when two boots race (T-RT-070)', async () => {
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
    const runs = await Promise.all([migrate(pool), migrate(pool), migrate(pool)]);
    const applied = runs.flat();
    expect(new Set(applied).size).toBe(applied.length);
    const rows = await pool.query('SELECT version FROM schema_migrations');
    expect(rows.rowCount).toBe(applied.length);
  });

  it('lets one of 20 parallel appends to the same seq win (T-RT-067)', async () => {
    const store = new PostgresStore(pool);
    const a = ids.mint<'AuctionId'>() as AuctionId;
    const ev = { type: 'settle_requested', auctionId: a, seq: 1, ts: 1 as EpochMs } as RoomEvent;
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => store.appendEvents(a, 0, [ev])),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const r of results) {
      if (r.status === 'rejected') expect(r.reason).toMatchObject({ code: 'conflict' });
    }
    expect(await store.lastSeq(a)).toBe(1);
  });

  runStoreContract(() => new PostgresStore(pool), 'PostgresStore');
});
