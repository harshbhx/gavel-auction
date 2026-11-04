import { canonicalBytes } from '../canonical.js';
import type { JsonValue } from '../canonical.js';
import type { LedgerEntry } from '../events.js';
import { pureHasher } from '../sha256.js';
import type { Hasher } from '../hasher.js';
import { GENESIS_PREV } from './chain.js';

/**
 * Redacted public export (R-ENG-045, R-ENG-086, R-ENG-108, R-ENG-109).
 *
 * The private ledger keeps its v1 entries and its hash vector unchanged. A public export is a
 * second chain over redacted copies of the entries: every private field is removed (not hashed,
 * because a ceiling is a small number and a digest of it can be guessed), and each public entry
 * carries `fullHash`, the hash of the private entry it was derived from. Anyone can verify the
 * public chain; an auditor who holds the private ledger checks `matchesLedger`.
 */
export const PUBLIC_EXPORT_VERSION = 2;

export interface PublicEntry {
  v: 2;
  auctionId: string;
  seq: number;
  at: number;
  type: string;
  cmd: string | null;
  payload: Record<string, JsonValue>;
  /** Names of the payload fields that were removed, sorted. */
  redacted: string[];
  /** Hash of the private entry this one was derived from. */
  fullHash: string;
  prev: string;
  hash: string;
}

export type PublicVerifyFailure = 'bad_hash' | 'bad_prev' | 'bad_seq' | 'bad_version';

export type PublicVerifyResult =
  | { ok: true; count: number; headHash: string }
  | { ok: false; firstBadIndex: number; reason: PublicVerifyFailure };

type Rec = Record<string, JsonValue>;

const CEILING_FIELDS = ['ceilingCents', 'fromCents', 'holdRef'];
const LEADER_FIELDS = ['leaderBefore', 'leaderAfter', 'rank'];
const SEALED_AMOUNT_FIELDS = ['amountCents', 'amountRaw', 'priceBefore', 'priceAfter'];
const DETAIL_FIELDS = ['availableCeilingCents', 'ceilingCents'];

function withoutKeys(rec: Rec, keys: readonly string[], dropped: Set<string>): Rec {
  const out: Rec = {};
  for (const [k, v] of Object.entries(rec)) {
    if (keys.includes(k)) dropped.add(k);
    else out[k] = v;
  }
  return out;
}

function hashPublic(e: Omit<PublicEntry, 'hash'>, hasher: Hasher): string {
  return hasher.sha256Hex(canonicalBytes(e as unknown as JsonValue));
}

/**
 * Builds the public export of a verified ledger. Sealed (second price) lots also lose their
 * bid amounts until the lot is hammered, since the amounts reveal the leading maximum.
 */
export function publicExport(
  entries: readonly LedgerEntry[],
  hasher: Hasher = pureHasher,
): PublicEntry[] {
  const sealed = new Set<string>();
  const out: PublicEntry[] = [];
  let prev = GENESIS_PREV;
  for (const e of entries) {
    const payload = e.payload as unknown as Rec;
    const dropped = new Set<string>();
    let pub: Rec = payload;
    if (e.type === 'LOT_ADDED') {
      const lot = payload['lot'];
      const lotId = payload['lotId'];
      if (typeof lotId === 'string' && typeof lot === 'object' && lot !== null) {
        if ((lot as Rec)['mode'] === 'second_price') sealed.add(lotId);
      }
    } else if (
      e.type === 'BIDDER_REGISTERED' ||
      e.type === 'CEILING_RAISED' ||
      e.type === 'CEILING_REVOKED'
    ) {
      pub = withoutKeys(payload, CEILING_FIELDS, dropped);
    } else if (e.type === 'BID_RECORDED' || e.type === 'BID_REJECTED') {
      const lotId = payload['lotId'];
      const isSealed = typeof lotId === 'string' && sealed.has(lotId);
      pub = withoutKeys(
        payload,
        [
          ...(e.type === 'BID_RECORDED' ? LEADER_FIELDS : []),
          ...(isSealed ? SEALED_AMOUNT_FIELDS : []),
        ],
        dropped,
      );
      const detail = pub['detail'];
      if (typeof detail === 'object' && detail !== null && !Array.isArray(detail)) {
        const inner = new Set<string>();
        pub = { ...pub, detail: withoutKeys(detail, DETAIL_FIELDS, inner) };
        if (inner.size > 0) dropped.add('detail.availableCeilingCents');
      }
    }
    if (e.type === 'LOT_HAMMERED' || e.type === 'LOT_UNSOLD' || e.type === 'LOT_ABORTED') {
      const lotId = payload['lotId'];
      if (typeof lotId === 'string') sealed.delete(lotId);
    }
    const body: Omit<PublicEntry, 'hash'> = {
      v: 2,
      auctionId: e.auctionId,
      seq: e.seq,
      at: e.at,
      type: e.type,
      cmd: e.cmd,
      payload: pub,
      redacted: [...dropped].sort(),
      fullHash: e.hash,
      prev,
    };
    const hash = hashPublic(body, hasher);
    out.push({ ...body, hash });
    prev = hash;
  }
  return out;
}

/** Verifies the public chain on its own: version, seq, links and hashes. */
export function verifyPublicExport(
  entries: readonly PublicEntry[],
  hasher: Hasher = pureHasher,
): PublicVerifyResult {
  let prev = GENESIS_PREV;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i] as PublicEntry;
    const fail = (reason: PublicVerifyFailure): PublicVerifyResult => ({
      ok: false,
      firstBadIndex: i,
      reason,
    });
    if (typeof e !== 'object' || e === null || (e.v as number) !== PUBLIC_EXPORT_VERSION) {
      return fail('bad_version');
    }
    if (e.seq !== i + 1) return fail('bad_seq');
    if (e.prev !== prev) return fail('bad_prev');
    const { hash, ...body } = e;
    let h: string;
    try {
      h = hashPublic(body, hasher);
    } catch {
      return fail('bad_hash');
    }
    if (h !== hash) return fail('bad_hash');
    prev = hash;
  }
  return { ok: true, count: entries.length, headHash: prev };
}

/** Auditor check: the public export was derived from exactly this private ledger. */
export function matchesLedger(
  pub: readonly PublicEntry[],
  ledger: readonly LedgerEntry[],
  hasher: Hasher = pureHasher,
): boolean {
  if (pub.length !== ledger.length) return false;
  const again = publicExport(ledger, hasher);
  return again.every((p, i) => p.hash === (pub[i] as PublicEntry).hash);
}
