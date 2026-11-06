import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GavelError } from '@gavel/shared';
import type { AuctionId, EpochMs, Jti, RoomEvent, RoomStore } from '@gavel/shared';
import type { Pool, PoolClient } from 'pg';

/** Arbitrary but fixed key so every booting host contends for the same lock. */
const MIGRATION_LOCK_KEY = 7_340_193;
const UNIQUE_VIOLATION = '23505';

export const DEFAULT_MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations', import.meta.url));

/** Versioned, forward-only migration files named `<version>_<name>.sql`. */
export function readMigrations(dir: string): { version: number; sql: string }[] {
  return readdirSync(dir)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .map((f) => ({ version: Number.parseInt(f, 10), sql: readFileSync(join(dir, f), 'utf8') }))
    .sort((a, b) => a.version - b.version);
}

/**
 * Applies pending migrations under a session advisory lock, so two hosts that boot
 * together apply each version once. Running it again is a no-op (R-RT-093, R-RT-096).
 * Returns the versions applied by this call.
 */
export async function migrate(
  pool: Pool,
  dir: string = DEFAULT_MIGRATIONS_DIR,
  now: () => number = Date.now,
): Promise<number[]> {
  const files = readMigrations(dir);
  const client = await pool.connect();
  const applied: number[] = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    try {
      await client.query(
        'CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at bigint NOT NULL)',
      );
      const done = new Set(
        (await client.query<{ version: number }>('SELECT version FROM schema_migrations')).rows.map(
          (r) => r.version,
        ),
      );
      for (const m of files) {
        if (done.has(m.version)) continue;
        await client.query('BEGIN');
        try {
          await client.query(m.sql);
          await client.query(
            'INSERT INTO schema_migrations (version, applied_at) VALUES ($1, $2)',
            [m.version, now()],
          );
          await client.query('COMMIT');
        } catch (e) {
          await client.query('ROLLBACK');
          throw e;
        }
        applied.push(m.version);
      }
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
  return applied;
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: unknown }).code === UNIQUE_VIOLATION;
}

/** RoomStore on Postgres. Call `migrate` once at boot before first use. */
export class PostgresStore implements RoomStore {
  constructor(
    private readonly pool: Pool,
    private readonly now: () => number = Date.now,
  ) {}

  async appendEvents(
    auctionId: AuctionId,
    expectedSeq: number,
    events: RoomEvent[],
  ): Promise<void> {
    // Validate the whole batch first so a bad batch appends nothing.
    events.forEach((e, i) => {
      if (e.seq !== expectedSeq + 1 + i || e.auctionId !== auctionId) {
        throw new GavelError('conflict', 'events must be gapless and belong to the auction');
      }
    });
    const client: PoolClient = await this.pool.connect();
    try {
      await client.query('BEGIN');
      try {
        const head = await client.query<{ seq: number | null }>(
          'SELECT max(seq) AS seq FROM events WHERE auction_id = $1',
          [auctionId],
        );
        const last = head.rows[0]?.seq ?? 0;
        if (last !== expectedSeq) {
          throw new GavelError('conflict', `expected seq ${expectedSeq}, store is at ${last}`);
        }
        for (const e of events) {
          await client.query('INSERT INTO events (auction_id, seq, body) VALUES ($1, $2, $3)', [
            auctionId,
            e.seq,
            JSON.stringify(e),
          ]);
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        // A concurrent append to the same seq loses on the unique key.
        if (isUniqueViolation(e)) throw new GavelError('conflict', 'seq already taken');
        throw e;
      }
    } finally {
      client.release();
    }
  }

  async readEvents(auctionId: AuctionId, fromSeq: number, limit: number): Promise<RoomEvent[]> {
    const r = await this.pool.query<{ body: RoomEvent }>(
      'SELECT body FROM events WHERE auction_id = $1 AND seq >= $2 ORDER BY seq LIMIT $3',
      [auctionId, fromSeq, Math.max(0, limit)],
    );
    return r.rows.map((row) => row.body);
  }

  async lastSeq(auctionId: AuctionId): Promise<number> {
    const r = await this.pool.query<{ seq: number | null }>(
      'SELECT max(seq) AS seq FROM events WHERE auction_id = $1',
      [auctionId],
    );
    return r.rows[0]?.seq ?? 0;
  }

  async saveSnapshot(auctionId: AuctionId, seq: number, state: unknown): Promise<void> {
    await this.pool.query(
      `INSERT INTO snapshots (auction_id, seq, state) VALUES ($1, $2, $3)
       ON CONFLICT (auction_id) DO UPDATE SET seq = EXCLUDED.seq, state = EXCLUDED.state`,
      [auctionId, seq, JSON.stringify(state)],
    );
  }

  async loadSnapshot(auctionId: AuctionId): Promise<{ seq: number; state: unknown } | null> {
    const r = await this.pool.query<{ seq: number; state: unknown }>(
      'SELECT seq, state FROM snapshots WHERE auction_id = $1',
      [auctionId],
    );
    return r.rows[0] ?? null;
  }

  async consumeJti(jti: Jti, ttlMs: number): Promise<boolean> {
    const now = this.now();
    const r = await this.pool.query(
      `INSERT INTO jti_used (jti, until_ms) VALUES ($1, $2)
       ON CONFLICT (jti) DO UPDATE SET until_ms = EXCLUDED.until_ms
       WHERE jti_used.until_ms <= $3`,
      [jti, now + ttlMs, now],
    );
    return r.rowCount === 1;
  }

  async denyJti(jti: Jti, untilMs: EpochMs): Promise<void> {
    await this.pool.query(
      `INSERT INTO jti_denied (jti, until_ms) VALUES ($1, $2)
       ON CONFLICT (jti) DO UPDATE SET until_ms = EXCLUDED.until_ms`,
      [jti, untilMs],
    );
  }

  async isDenied(jti: Jti): Promise<boolean> {
    const r = await this.pool.query('SELECT 1 FROM jti_denied WHERE jti = $1 AND until_ms > $2', [
      jti,
      this.now(),
    ]);
    return (r.rowCount ?? 0) > 0;
  }

  async getJournal(key: string): Promise<{ version: number; value: unknown } | null> {
    const r = await this.pool.query<{ version: number; value: unknown }>(
      'SELECT version, value FROM journals WHERE key = $1',
      [key],
    );
    return r.rows[0] ?? null;
  }

  async putJournal(key: string, expectedVersion: number, value: unknown): Promise<void> {
    const body = JSON.stringify(value);
    const r =
      expectedVersion === 0
        ? await this.pool.query(
            'INSERT INTO journals (key, version, value) VALUES ($1, 1, $2) ON CONFLICT (key) DO NOTHING',
            [key, body],
          )
        : await this.pool.query(
            'UPDATE journals SET version = version + 1, value = $3 WHERE key = $1 AND version = $2',
            [key, expectedVersion, body],
          );
    if (r.rowCount !== 1) throw new GavelError('conflict', 'journal version mismatch');
  }

  async listAuctions(): Promise<AuctionId[]> {
    const r = await this.pool.query<{ auction_id: AuctionId }>(
      'SELECT DISTINCT auction_id FROM events ORDER BY auction_id',
    );
    return r.rows.map((row) => row.auction_id);
  }

  async ping(): Promise<void> {
    await this.pool.query('SELECT 1');
  }
}
