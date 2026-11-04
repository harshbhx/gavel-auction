import { canonicalBytes } from '../canonical.js';
import type { JsonValue } from '../canonical.js';
import type { LedgerEntry, LedgerEvent } from '../events.js';
import { pureHasher } from '../sha256.js';
import type { Hasher } from '../hasher.js';
import type { Ulid } from '../types.js';

/** The `prev` of the first entry of every ledger (R-ENG-072). */
export const GENESIS_PREV = '0'.repeat(64);

/** Where the next entry attaches: the auction id and the current head. */
export interface ChainHead {
  auctionId: Ulid;
  seq: number;
  hash: string;
}

export function genesisHead(auctionId: Ulid): ChainHead {
  return { auctionId, seq: 0, hash: GENESIS_PREV };
}

export type VerifyFailure =
  | 'bad_hash'
  | 'bad_prev'
  | 'bad_seq'
  | 'bad_time'
  | 'unsupported_version'
  | 'truncated';

export type VerifyResult =
  | { ok: true; count: number; headHash: string }
  | { ok: false; firstBadIndex: number; reason: VerifyFailure };

export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

function withoutHash(entry: LedgerEntry): JsonValue {
  const out: Record<string, JsonValue> = {};
  for (const [k, v] of Object.entries(entry)) {
    if (k !== 'hash') out[k] = v as JsonValue;
  }
  return out;
}

/** SHA-256 over the canonical JSON of the entry without its hash field (R-ENG-072). */
export function hashEntry(entry: LedgerEntry, hasher: Hasher = pureHasher): string {
  return hasher.sha256Hex(canonicalBytes(withoutHash(entry)));
}

/**
 * Seals a batch of events into consecutive hash-chained entries that share
 * one `at` and one command id (R-ENG-076). Does not validate ids.
 */
export function sealBatch(
  events: readonly LedgerEvent[],
  head: ChainHead,
  at: number,
  cmd: Ulid | null,
  hasher: Hasher = pureHasher,
): LedgerEntry[] {
  const out: LedgerEntry[] = [];
  let seq = head.seq;
  let prev = head.hash;
  for (const ev of events) {
    seq += 1;
    const body = {
      v: 1,
      auctionId: head.auctionId,
      seq,
      at,
      type: ev.type,
      cmd,
      payload: ev.payload,
      prev,
    } as Omit<LedgerEntry, 'hash'>;
    const entry = { ...body, hash: '' } as LedgerEntry;
    const hash = hashEntry(entry, hasher);
    const sealed = deepFreeze({ ...entry, hash } as LedgerEntry);
    out.push(sealed);
    prev = hash;
  }
  return out;
}

/** The head seq and hash of a ledger, or null when it is empty (R-ENG-075). */
export function headOf(entries: readonly LedgerEntry[]): { seq: number; hash: string } | null {
  const last = entries[entries.length - 1];
  return last === undefined ? null : { seq: last.seq, hash: last.hash };
}

/**
 * Verifies a whole ledger from genesis (R-ENG-073, R-ENG-074, R-ENG-080).
 * With `expectedHead` a shortened or rewritten tail fails as `truncated`.
 */
export function verifyChain(
  entries: readonly LedgerEntry[],
  o: { expectedHead?: { seq: number; hash: string }; hasher?: Hasher } = {},
): VerifyResult {
  const hasher = o.hasher ?? pureHasher;
  let prevHash = GENESIS_PREV;
  let prevAt = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i] as LedgerEntry;
    const fail = (reason: VerifyFailure): VerifyResult => ({ ok: false, firstBadIndex: i, reason });
    if ((e.v as number) !== 1) return fail('unsupported_version');
    if (e.seq !== i + 1) return fail('bad_seq');
    if (typeof e.at !== 'number' || e.at < prevAt) return fail('bad_time');
    if (e.prev !== prevHash) return fail('bad_prev');
    let h: string;
    try {
      h = hashEntry(e, hasher);
    } catch {
      return fail('bad_hash');
    }
    if (h !== e.hash) return fail('bad_hash');
    prevHash = e.hash;
    prevAt = e.at;
  }
  const exp = o.expectedHead;
  if (exp !== undefined) {
    const head = headOf(entries);
    if (head === null || head.seq !== exp.seq || head.hash !== exp.hash) {
      return { ok: false, firstBadIndex: entries.length, reason: 'truncated' };
    }
  }
  return { ok: true, count: entries.length, headHash: prevHash };
}
