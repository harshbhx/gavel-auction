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
 * because a ceiling is a small number and a digest of it can be guessed). A private entry hash
 * covers `prev`, the private hash of the entry before it, so once any entry has lost fields no
 * later entry may publish its private hash either: the next unredacted entry would commit to the
 * redacted one and let a viewer test candidate amounts by hashing forward (R5-E01, R12-E01).
 * From the first redaction on every entry carries `fullHash` null, or a keyed commitment when the
 * auditor passes a secret `commitKey`. Entries before it carry the private hash, which a viewer
 * can recompute from public data alone. Anyone can verify the public chain; an auditor who holds
 * the private ledger (and the key) checks `matchesLedger`.
 *
 * Version 4 (version 3 published the private hash of every unredacted entry and kept english
 * transcripts, proxy fallback prices and ceiling-bounding rejections; version 2 published every
 * private hash).
 */
export const PUBLIC_EXPORT_VERSION = 4;

export interface PublicEntry {
  v: 4;
  auctionId: string;
  seq: number;
  at: number;
  type: string;
  cmd: string | null;
  payload: Record<string, JsonValue>;
  /** Names of the payload fields that were removed, sorted. */
  redacted: string[];
  /**
   * Hash of the private entry while no entry up to this one lost fields; from the first
   * redaction on null, or a keyed commitment to that hash when the export was built with a
   * `commitKey`.
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
/** A rejection over the ceiling puts an upper bound on it through the amount (R12-E07). */
const REJECTED_AMOUNT_FIELDS = ['amountCents', 'amountRaw'];
/** A skip reason and price bound the runner-up's available ceiling (R12-E07). */
const SKIP_FIELDS = ['reason', 'priceCents'];

function withoutKeys(rec: Rec, keys: readonly string[], dropped: Set<string>): Rec {
  const out: Rec = {};
  for (const [k, v] of Object.entries(rec)) {
    if (keys.includes(k)) dropped.add(k);
    else out[k] = v;
  }
  return out;
}

function withoutRankingAmounts(payload: Rec, dropped: Set<string>): Rec {
  const ranking = payload['ranking'];
  if (!Array.isArray(ranking)) return payload;
  const inner = new Set<string>();
  const next = ranking.map((r) =>
    typeof r === 'object' && r !== null && !Array.isArray(r)
      ? withoutKeys(r as Rec, ['amountCents'], inner)
      : r,
  );
  if (inner.size > 0) dropped.add('ranking.amountCents');
  return { ...payload, ranking: next };
}

/**
 * A proxy runner-up price is the next lower secret maximum plus the increment, so only the
 * winner's entry keeps its price; a promoted runner-up's price is published by FALLBACK_PROMOTED
 * when it is charged (R12-E06).
 */
function withoutFallbackPrices(payload: Rec, dropped: Set<string>): Rec {
  const candidates = payload['candidates'];
  if (!Array.isArray(candidates)) return payload;
  const inner = new Set<string>();
  const next = candidates.map((c, i) =>
    i > 0 && typeof c === 'object' && c !== null && !Array.isArray(c)
      ? withoutKeys(c as Rec, ['priceCents'], inner)
      : c,
  );
  if (inner.size > 0) dropped.add('candidates.priceCents');
  return { ...payload, candidates: next };
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
  hidden: boolean,
  opts: PublicExportOptions,
  hasher: Hasher,
): string | null {
  if (!hidden) return privateHash;
  if (opts.commitKey === undefined) return null;
  return hasher.sha256Hex(canonicalBytes({ commit: opts.commitKey, hash: privateHash }));
}

/**
 * Builds the public export of a verified ledger. Sealed (second price) lots lose their bid
 * amounts until the lot is hammered, since they reveal the leading maximum. Proxy lots lose each
 * bid's amount, which is the bidder's secret maximum, and the runner-up prices of the hammer;
 * their price fields stay public. Every bid loses its spoken transcript, which is personal data
 * shown to auditors only (R12-E05), and a rejection or skip that bounds a ceiling loses the
 * amount or the reason that bounds it (R12-E07).
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
  // Set at the first entry that loses a field; never cleared (R12-E01).
  let hidden = false;
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
      const overCeiling = e.type === 'BID_REJECTED' && payload['reason'] === 'over_ceiling';
      pub = withoutKeys(
        payload,
        [
          ...(e.type === 'BID_RECORDED' ? LEADER_FIELDS : []),
          ...(isSealed ? SEALED_AMOUNT_FIELDS : []),
          ...(isProxy ? PROXY_MAXIMUM_FIELDS : []),
          ...(overCeiling ? REJECTED_AMOUNT_FIELDS : []),
        ],
        dropped,
      );
      pub = withoutTranscript(pub, dropped);
      const detail = pub['detail'];
      if (typeof detail === 'object' && detail !== null && !Array.isArray(detail)) {
        const inner = new Set<string>();
        pub = { ...pub, detail: withoutKeys(detail, DETAIL_FIELDS, inner) };
        if (inner.size > 0) dropped.add('detail.ceiling');
      }
    } else if (e.type === 'CANDIDATE_SKIPPED') {
      pub = withoutKeys(payload, SKIP_FIELDS, dropped);
    }
    if (e.type === 'LOT_HAMMERED' || e.type === 'LOT_UNSOLD' || e.type === 'LOT_ABORTED') {
      const lotId = payload['lotId'];
      if (typeof lotId === 'string') {
        sealed.delete(lotId);
        // The hammer ranking holds every bidder's secret maximum and each runner-up price is
        // the next maximum plus the increment; only the order and the price stay public for a
        // proxy lot (R8-E03, R12-E06).
        if (e.type === 'LOT_HAMMERED' && proxy.has(lotId))
          pub = withoutFallbackPrices(withoutRankingAmounts(pub, dropped), dropped);
        proxy.delete(lotId);
      }
    }
    if (dropped.size > 0) hidden = true;
    const body: Omit<PublicEntry, 'hash'> = {
      v: PUBLIC_EXPORT_VERSION,
      auctionId: e.auctionId,
      seq: e.seq,
      at: e.at,
      type: e.type,
      cmd: e.cmd,
      payload: pub,
      redacted: [...dropped].sort(),
      fullHash: linkFor(e.hash, hidden, opts, hasher),
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
