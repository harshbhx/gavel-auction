import { canonicalBytes, canonicalize } from '../canonical.js';
import type { JsonValue } from '../canonical.js';
import type { LedgerEntry } from '../events.js';
import { pureHasher } from '../sha256.js';
import type { Hasher } from '../hasher.js';
import { GENESIS_PREV, verifyChain } from './chain.js';

/**
 * Redacted public export (R-ENG-045, R-ENG-086, R-ENG-108, R-ENG-109).
 *
 * The private ledger keeps its v1 entries and its hash vector unchanged. A public export is a
 * second chain over redacted copies of the entries: every private field is removed (not hashed,
 * because a ceiling is a small number and a digest of it can be guessed). An entry that lost
 * fields never publishes the hash of its private entry: with every other field public, that hash
 * lets a viewer test each candidate amount (R5-E01). Such an entry carries `fullHash` null, or a
 * keyed commitment when the auditor passes a secret `commitKey`. An entry that lost nothing
 * carries the private hash as is. Anyone can verify the public chain; an auditor who holds the
 * private ledger (and the key) checks `matchesLedger`.
 *
 * Version 3 (version 2 published every private hash).
 */
export const PUBLIC_EXPORT_VERSION = 3;

export interface PublicEntry {
  v: 3;
  auctionId: string;
  seq: number;
  at: number;
  type: string;
  cmd: string | null;
  payload: Record<string, JsonValue>;
  /** Names of the payload fields that were removed, sorted. */
  redacted: string[];
  /**
   * Hash of the private entry when nothing was removed; otherwise null, or a keyed commitment
   * to that hash when the export was built with a `commitKey`.
   */
  fullHash: string | null;
  prev: string;
  hash: string;
}

export type PublicVerifyFailure = 'bad_hash' | 'bad_prev' | 'bad_seq' | 'bad_version' | 'truncated';

export interface PublicExportOptions {
  /** Secret held by the auditor; makes the commitment to each redacted entry's private hash. */
  commitKey?: string;
}

export type PublicVerifyResult =
  | { ok: true; count: number; headHash: string }
  | { ok: false; firstBadIndex: number; reason: PublicVerifyFailure };

type Rec = Record<string, JsonValue>;

const CEILING_FIELDS = ['ceilingCents', 'fromCents', 'holdRef'];
const LEADER_FIELDS = ['leaderBefore', 'leaderAfter', 'rank'];
const SEALED_AMOUNT_FIELDS = ['amountCents', 'amountRaw', 'priceBefore', 'priceAfter'];
/** A proxy bid amount is the bidder's secret maximum; the price fields stay public (R-ENG-109). */
const PROXY_MAXIMUM_FIELDS = ['amountCents', 'amountRaw'];
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

function withoutTranscript(payload: Rec, dropped: Set<string>): Rec {
  const audit = payload['audit'];
  if (typeof audit !== 'object' || audit === null || Array.isArray(audit)) return payload;
  if (!('transcript' in audit)) return payload;
  const inner = new Set<string>();
  dropped.add('audit.transcript');
  return { ...payload, audit: withoutKeys(audit, ['transcript'], inner) };
}

function linkFor(
  privateHash: string,
  redacted: boolean,
  opts: PublicExportOptions,
  hasher: Hasher,
): string | null {
  if (!redacted) return privateHash;
  if (opts.commitKey === undefined) return null;
  return hasher.sha256Hex(canonicalBytes({ commit: opts.commitKey, hash: privateHash }));
}

/**
 * Builds the public export of a verified ledger. Sealed (second price) lots lose their bid
 * amounts and the spoken transcript until the lot is hammered, since both reveal the leading
 * maximum. Proxy lots lose each bid's amount, which is the bidder's secret maximum, and the
 * transcript; their price fields stay public.
 */
export function publicExport(
  entries: readonly LedgerEntry[],
  hasher: Hasher = pureHasher,
  opts: PublicExportOptions = {},
): PublicEntry[] {
  const sealed = new Set<string>();
  const proxy = new Set<string>();
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
        if ((lot as Rec)['mode'] === 'proxy') proxy.add(lotId);
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
      const isProxy = typeof lotId === 'string' && proxy.has(lotId);
      pub = withoutKeys(
        payload,
        [
          ...(e.type === 'BID_RECORDED' ? LEADER_FIELDS : []),
          ...(isSealed ? SEALED_AMOUNT_FIELDS : []),
          ...(isProxy ? PROXY_MAXIMUM_FIELDS : []),
        ],
        dropped,
      );
      if (isSealed || isProxy) pub = withoutTranscript(pub, dropped);
      const detail = pub['detail'];
      if (typeof detail === 'object' && detail !== null && !Array.isArray(detail)) {
        const inner = new Set<string>();
        pub = { ...pub, detail: withoutKeys(detail, DETAIL_FIELDS, inner) };
        if (inner.size > 0) dropped.add('detail.ceiling');
      }
    }
    if (e.type === 'LOT_HAMMERED' || e.type === 'LOT_UNSOLD' || e.type === 'LOT_ABORTED') {
      const lotId = payload['lotId'];
      if (typeof lotId === 'string') {
        sealed.delete(lotId);
        proxy.delete(lotId);
      }
    }
    const body: Omit<PublicEntry, 'hash'> = {
      v: PUBLIC_EXPORT_VERSION,
      auctionId: e.auctionId,
      seq: e.seq,
      at: e.at,
      type: e.type,
      cmd: e.cmd,
      payload: pub,
      redacted: [...dropped].sort(),
      fullHash: linkFor(e.hash, dropped.size > 0, opts, hasher),
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
  o: { expectedHead?: { seq: number; hash: string } } = {},
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
  const exp = o.expectedHead;
  if (exp !== undefined) {
    const last = entries[entries.length - 1];
    if (last === undefined || last.seq !== exp.seq || last.hash !== exp.hash) {
      return { ok: false, firstBadIndex: entries.length, reason: 'truncated' };
    }
  }
  return { ok: true, count: entries.length, headHash: prev };
}

/**
 * Auditor check: the public export was derived from exactly this private ledger. The ledger is
 * verified first, then every public entry is compared byte for byte with the one re-derived
 * from the ledger, so altered content cannot hide behind unchanged hash fields. Pass the same
 * `commitKey` the export was built with.
 */
export function matchesLedger(
  pub: readonly PublicEntry[],
  ledger: readonly LedgerEntry[],
  hasher: Hasher = pureHasher,
  opts: PublicExportOptions = {},
): boolean {
  if (pub.length !== ledger.length) return false;
  if (!verifyChain(ledger, { hasher }).ok) return false;
  const again = publicExport(ledger, hasher, opts);
  try {
    return again.every(
      (p, i) =>
        canonicalize(p as unknown as JsonValue) === canonicalize(pub[i] as unknown as JsonValue),
    );
  } catch {
    return false;
  }
}
