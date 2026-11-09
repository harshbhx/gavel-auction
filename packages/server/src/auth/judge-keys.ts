import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Per-judge API keys (FEAT-60). A key reads `gvl_judge_<id>_<secret>`: the id is public and picks
 * the entry, the secret is 192 random bits. Only `sha256(secret)` is ever stored or configured,
 * so a leaked config or journal cannot be used to call the API. A key scopes to judge rooms
 * only: nothing in this file knows about admin routes, and `requireAdmin` never reads it.
 */
export const JUDGE_KEY_PREFIX = 'gvl_judge_';
const KEY_RE = /^gvl_judge_([a-z0-9]{8})_([0-9a-f]{48})$/;
/** Default and latest allowed expiry of a key: the end of the judging window. */
export const JUDGE_KEY_DEFAULT_EXPIRY = '2026-11-30T23:59:00Z';
export const JUDGE_KEY_LATEST_EXPIRY = '2026-12-15T00:00:00Z';
/** Id of the entry that stands for the single shared JUDGE_KEY. */
export const LEGACY_KEY_ID = 'legacy';

export interface JudgeKeyEntry {
  id: string;
  /** sha256 of the secret part, 64 lowercase hex characters. */
  hash: string;
  label: string;
  /**
   * Epoch ms; the key is refused from this moment on. `Number.POSITIVE_INFINITY` means it never
   * expires (a config entry with `"expiresAt": null`, and the legacy shared key).
   */
  expiresAt: number;
  /** Judge rooms this key may keep alive at once. */
  maxRooms: number;
  /** Rooms this key may create per hour. */
  perHour: number;
}

export type KeyVerdict =
  | { ok: true; key: JudgeKeyEntry }
  | { ok: false; reason: 'invalid' | 'expired' | 'revoked'; keyId?: string };

export const sha256Hex = (text: string): string => createHash('sha256').update(text).digest('hex');

/** Splits a key into id and secret, or undefined when it is not shaped like one. */
export function parseJudgeKey(given: string): { id: string; secret: string } | undefined {
  const m = KEY_RE.exec(given);
  return m === null ? undefined : { id: m[1] as string, secret: m[2] as string };
}

/** Constant-time comparison of two secrets of any length (both sides are hashed first). */
export function secretsEqual(given: string, expected: string): boolean {
  return timingSafeEqual(
    createHash('sha256').update(given).digest(),
    createHash('sha256').update(expected).digest(),
  );
}

const HEX64 = /^[0-9a-f]{64}$/;
const ID_RE = /^[a-z0-9]{8}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Parses the JUDGE_KEYS value (a JSON array). Returns the entries and every problem found, so
 * config can name them all. Never echoes a hash back in a problem.
 */
export function parseJudgeKeys(raw: string | undefined): {
  entries: JudgeKeyEntry[];
  problems: string[];
} {
  const entries: JudgeKeyEntry[] = [];
  const problems: string[] = [];
  if (raw === undefined || raw.trim() === '') return { entries, problems };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { entries, problems: ['must be a JSON array'] };
  }
  if (!Array.isArray(data)) return { entries, problems: ['must be a JSON array'] };
  const latest = Date.parse(JUDGE_KEY_LATEST_EXPIRY);
  const seen = new Set<string>();
  data.forEach((item: unknown, i) => {
    const at = `entry ${i + 1}`;
    if (typeof item !== 'object' || item === null)
      return void problems.push(`${at}: not an object`);
    const o = item as Record<string, unknown>;
    const id = o.id;
    if (typeof id !== 'string' || !ID_RE.test(id)) {
      return void problems.push(`${at}: id must be 8 lowercase letters or digits`);
    }
    if (seen.has(id)) return void problems.push(`${at}: duplicate id`);
    seen.add(id);
    if (typeof o.hash !== 'string' || !HEX64.test(o.hash)) {
      return void problems.push(`${at}: hash must be 64 lowercase hex characters (sha256)`);
    }
    // `"expiresAt": null` is the one way to say "never expires" (a shared judging key, FEAT-63);
    // a missing field is still a problem. Dated entries keep the cap below.
    const never = o.expiresAt === null;
    // ISO-8601 with a Z or offset only: Date.parse alone also takes local-time text like "Nov 5".
    const expiresAt = never
      ? Number.POSITIVE_INFINITY
      : typeof o.expiresAt === 'string' && ISO_RE.test(o.expiresAt)
        ? Date.parse(o.expiresAt)
        : Number.NaN;
    if (Number.isNaN(expiresAt)) {
      return void problems.push(`${at}: expiresAt must be an ISO date, or null for no expiry`);
    }
    // A date in the past is allowed: the key is simply refused as expired, and a restart after
    // the judging window must not stop the host from booting.
    if (!never && expiresAt > latest) {
      return void problems.push(`${at}: expiresAt is after ${JUDGE_KEY_LATEST_EXPIRY}`);
    }
    const maxRooms = o.maxRooms ?? 2;
    const perHour = o.perHour ?? 10;
    if (
      typeof maxRooms !== 'number' ||
      !Number.isInteger(maxRooms) ||
      maxRooms < 1 ||
      maxRooms > 10
    ) {
      return void problems.push(`${at}: maxRooms must be an integer from 1 to 10`);
    }
    if (typeof perHour !== 'number' || !Number.isInteger(perHour) || perHour < 1 || perHour > 100) {
      return void problems.push(`${at}: perHour must be an integer from 1 to 100`);
    }
    const label = typeof o.label === 'string' ? o.label.slice(0, 60) : '';
    entries.push({ id, hash: o.hash, label, expiresAt, maxRooms, perHour });
  });
  return { entries, problems };
}

/** The keys a host accepts: configured entries plus the legacy shared JUDGE_KEY, minus revoked. */
export class JudgeKeyRegistry {
  private readonly byId = new Map<string, JudgeKeyEntry>();
  private readonly revoked = new Set<string>();
  private readonly legacy: string | undefined;
  private readonly legacyEntry: JudgeKeyEntry | undefined;

  constructor(
    entries: readonly JudgeKeyEntry[],
    legacy: { key: string; maxRooms: number; perHour: number } | undefined,
  ) {
    for (const e of entries) this.byId.set(e.id, e);
    this.legacy = legacy?.key;
    this.legacyEntry =
      legacy === undefined
        ? undefined
        : {
            id: LEGACY_KEY_ID,
            hash: '',
            label: 'shared judge key',
            expiresAt: Number.POSITIVE_INFINITY,
            maxRooms: legacy.maxRooms,
            perHour: legacy.perHour,
          };
  }

  /** True when any key can be presented (the probe reports `keyed` from this). */
  get any(): boolean {
    return this.byId.size > 0 || this.legacy !== undefined;
  }

  setRevoked(ids: Iterable<string>): void {
    this.revoked.clear();
    for (const id of ids) this.revoked.add(id);
  }

  revokedIds(): string[] {
    return [...this.revoked];
  }

  /** Revokes a known key id. Returns false for an id that is not configured. */
  revoke(id: string): boolean {
    if (!this.byId.has(id) && !(id === LEGACY_KEY_ID && this.legacy !== undefined)) return false;
    this.revoked.add(id);
    return true;
  }

  get(id: string): JudgeKeyEntry | undefined {
    return id === LEGACY_KEY_ID ? this.legacyEntry : this.byId.get(id);
  }

  isRevoked(id: string): boolean {
    return this.revoked.has(id);
  }

  /** Every entry, for the admin listing. Hashes are included here only as present, see the route. */
  entries(): JudgeKeyEntry[] {
    return [...this.byId.values(), ...(this.legacyEntry ? [this.legacyEntry] : [])];
  }

  /**
   * Checks a presented key. The comparison always runs (against a dummy for an unknown id), and
   * expiry or revocation is reported only once the secret is right, so a wrong guess learns
   * nothing about which ids exist.
   */
  verify(given: string, nowMs: number): KeyVerdict {
    const parsed = parseJudgeKey(given);
    if (parsed === undefined) {
      const same = secretsEqual(given, this.legacy ?? '\u0000unset');
      if (this.legacy === undefined || given === '' || !same)
        return { ok: false, reason: 'invalid' };
      return this.judge(this.legacyEntry as JudgeKeyEntry, nowMs);
    }
    const entry = this.byId.get(parsed.id);
    const want = Buffer.from(entry?.hash ?? '0'.repeat(64), 'hex');
    const have = Buffer.from(sha256Hex(parsed.secret), 'hex');
    if (entry === undefined || !timingSafeEqual(have, want))
      return { ok: false, reason: 'invalid' };
    return this.judge(entry, nowMs);
  }

  private judge(entry: JudgeKeyEntry, nowMs: number): KeyVerdict {
    if (this.revoked.has(entry.id)) return { ok: false, reason: 'revoked', keyId: entry.id };
    if (entry.expiresAt <= nowMs) return { ok: false, reason: 'expired', keyId: entry.id };
    return { ok: true, key: entry };
  }
}
