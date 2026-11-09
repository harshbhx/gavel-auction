import { canonicalJson } from '../util/hash';
import type { AuditPayload } from '../wire';

/** One line of a hash-chained ledger, as the ledger grid shows it. */
export interface LedgerEntry {
  /** 1-based position in the chain. */
  seq: number;
  /** Epoch ms. */
  at: number;
  /** Machine type, for example `bid_accepted`. */
  type: string;
  /** `paddle:12`, `auctioneer`, `system`, or null when the entry has no actor. */
  actor: string | null;
  /** Integer cents, or null when the entry carries no amount. */
  amountCents: number | null;
  note: string | null;
  /** Hex SHA-256 of the entry body, or null for a row that was never sealed (a plain audit row). */
  hash: string | null;
  /** Hash of the previous entry; the genesis entry points at 64 zeros. */
  prev: string | null;
}

/**
 * Per-row chain result.
 * verified: the stored hash matches the body and the link matches the entry before.
 * tampered: the body no longer matches its own hash, so the entry was edited after sealing.
 * broken: the body is intact but it does not point at the entry before it.
 * unsealed: the row has no hash (an audit row), so there is nothing to check.
 */
export type ChainStatus = 'verified' | 'tampered' | 'broken' | 'unsealed';

export const GENESIS_PREV = '0'.repeat(64);

export type HashFn = (text: string) => Promise<string | null>;

/** The fields a hash covers: everything except the hash itself. */
export function bodyOf(entry: LedgerEntry): Omit<LedgerEntry, 'hash'> {
  return {
    seq: entry.seq,
    at: entry.at,
    type: entry.type,
    actor: entry.actor,
    amountCents: entry.amountCents,
    note: entry.note,
    prev: entry.prev,
  };
}

export function hashInput(entry: LedgerEntry): string {
  return canonicalJson(bodyOf(entry));
}

/** Seals a list of bodies into a chain: each entry gets the hash of the one before as `prev`. */
export async function sealChain(
  bodies: readonly Omit<LedgerEntry, 'hash' | 'prev' | 'seq'>[],
  hash: HashFn,
): Promise<LedgerEntry[]> {
  const out: LedgerEntry[] = [];
  let prev = GENESIS_PREV;
  for (const [i, body] of bodies.entries()) {
    const partial = { ...body, seq: i + 1, prev, hash: null };
    const h = await hash(hashInput(partial));
    if (h === null) throw new Error('no SHA-256 available');
    out.push({ ...partial, hash: h });
    prev = h;
  }
  return out;
}

const BATCH = 400;

/**
 * Checks every entry: recomputes its hash and compares its link with the entry before. Hashing runs
 * in batches so a long ledger never blocks the page for a whole frame budget at once.
 */
export async function verifyEntries(
  entries: readonly LedgerEntry[],
  hash: HashFn,
): Promise<Map<number, ChainStatus>> {
  const result = new Map<number, ChainStatus>();
  for (let start = 0; start < entries.length; start += BATCH) {
    const slice = entries.slice(start, start + BATCH);
    const hashes = await Promise.all(
      slice.map((e) => (e.hash === null ? null : hash(hashInput(e)))),
    );
    slice.forEach((entry, j) => {
      const i = start + j;
      if (entry.hash === null) {
        result.set(entry.seq, 'unsealed');
        return;
      }
      const before = entries[i - 1];
      const expectedPrev = before === undefined ? GENESIS_PREV : before.hash;
      if (hashes[j] !== entry.hash) result.set(entry.seq, 'tampered');
      else if (entry.prev !== expectedPrev) result.set(entry.seq, 'broken');
      else result.set(entry.seq, 'verified');
    });
  }
  return result;
}

/** First entry that is not verified, or null when the whole chain checks out. */
export function firstBad(statuses: ReadonlyMap<number, ChainStatus>): number | null {
  let first: number | null = null;
  for (const [seq, status] of statuses) {
    if ((status === 'tampered' || status === 'broken') && (first === null || seq < first))
      first = seq;
  }
  return first;
}

/** Rows revealed per tick: a long ledger is shown in about 60 steps, a short one row by row. */
export function revealStep(total: number): number {
  return Math.max(1, Math.ceil(total / 60));
}

export function shortHash(h: string | null, n = 10): string {
  return h === null ? '' : h.slice(0, n);
}

/** `2026-10-03 14:22:05` in UTC. */
export function formatStamp(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}

/** Totals for the summary under the grid. */
export function chainCounts(
  statuses: ReadonlyMap<number, ChainStatus>,
): Record<ChainStatus, number> {
  const counts: Record<ChainStatus, number> = { verified: 0, tampered: 0, broken: 0, unsealed: 0 };
  for (const s of statuses.values()) counts[s] += 1;
  return counts;
}

/**
 * Audit rows as ledger entries. Audit rows are not sealed (the server keeps the chain; the page has no
 * hashes for them), so hash and prev stay null and the grid hides those columns.
 */
export function entriesFromAudit(
  rows: readonly AuditPayload[],
  paddleOf: (bidderId: string) => number | null,
): LedgerEntry[] {
  return rows.map((row) => {
    const paddle = paddleOf(row.bidderId);
    return {
      seq: row.seq,
      at: Number(row.serverTs),
      type: `audit_${row.outcome}`,
      actor: paddle === null ? null : `paddle:${paddle}`,
      amountCents: row.parsedAmount === undefined ? null : Number(row.parsedAmount),
      note: row.reason ?? null,
      hash: null,
      prev: null,
    };
  });
}
