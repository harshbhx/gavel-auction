import type { ReplayBundle } from './replay-bundle';

/**
 * Browser-side verifier for a replay bundle (the redacted public export, version 4).
 * packages/web may not import the engine (dependency-cruiser), so this is a port of the
 * engine's `verifyPublicExport`: same canonical JSON, same SHA-256, same checks. A parity test
 * in packages/server runs both on good and tampered bundles and requires equal answers.
 */

export type PublicChainFailure = 'bad_hash' | 'bad_prev' | 'bad_seq' | 'bad_version' | 'truncated';

export type PublicChainResult =
  | { ok: true; count: number; headHash: string; closed: boolean }
  | { ok: false; firstBadIndex: number; reason: PublicChainFailure };

const GENESIS_PREV = '0'.repeat(64);
const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

function sha256HexOf(bytes: Uint8Array): string {
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const len = bytes.length;
  const padded = new Uint8Array(((len + 9 + 63) >> 6) << 6);
  padded.set(bytes);
  padded[len] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(len / 0x20000000), false);
  view.setUint32(padded.length - 4, (len << 3) >>> 0, false);
  const w = new Uint32Array(64);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const w15 = w[i - 15] as number;
      const w2 = w[i - 2] as number;
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
      w[i] = ((w[i - 16] as number) + s0 + (w[i - 7] as number) + s1) >>> 0;
    }
    let a = h[0] as number,
      b = h[1] as number,
      c = h[2] as number,
      d = h[3] as number;
    let e = h[4] as number,
      f = h[5] as number,
      g = h[6] as number,
      hh = h[7] as number;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + (K[i] as number) + (w[i] as number)) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = ((h[0] as number) + a) >>> 0;
    h[1] = ((h[1] as number) + b) >>> 0;
    h[2] = ((h[2] as number) + c) >>> 0;
    h[3] = ((h[3] as number) + d) >>> 0;
    h[4] = ((h[4] as number) + e) >>> 0;
    h[5] = ((h[5] as number) + f) >>> 0;
    h[6] = ((h[6] as number) + g) >>> 0;
    h[7] = ((h[7] as number) + hh) >>> 0;
  }
  let hex = '';
  for (const v of h) hex += v.toString(16).padStart(8, '0');
  return hex;
}

function checkString(s: string): void {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = s.charCodeAt(i + 1);
      if (!(d >= 0xdc00 && d <= 0xdfff)) throw new Error('lone surrogate');
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      throw new Error('lone surrogate');
    }
  }
}

function quote(s: string): string {
  return JSON.stringify(s).replace(
    /[^\x20-\x7e]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

function compareCodePoints(a: string, b: string): number {
  const x = Array.from(a);
  const y = Array.from(b);
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) {
    const p = (x[i] as string).codePointAt(0) as number;
    const q = (y[i] as string).codePointAt(0) as number;
    if (p !== q) return p < q ? -1 : 1;
  }
  return x.length < y.length ? -1 : x.length > y.length ? 1 : 0;
}

function encode(v: unknown, out: string[]): void {
  if (v === null) out.push('null');
  else if (typeof v === 'boolean') out.push(v ? 'true' : 'false');
  else if (typeof v === 'number') {
    if (!Number.isSafeInteger(v) || Object.is(v, -0))
      throw new Error('numbers must be safe integers');
    out.push(String(v));
  } else if (typeof v === 'string') {
    checkString(v);
    out.push(quote(v));
  } else if (Array.isArray(v)) {
    if (Object.keys(v).length !== v.length) throw new Error('sparse array');
    out.push('[');
    for (let i = 0; i < v.length; i++) {
      if (i > 0) out.push(',');
      encode(v[i], out);
    }
    out.push(']');
  } else if (typeof v === 'object') {
    const proto: unknown = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) throw new Error('not a plain object');
    const obj = v as Record<string, unknown>;
    out.push('{');
    Object.keys(obj)
      .sort(compareCodePoints)
      .forEach((k, i) => {
        if (FORBIDDEN_KEYS.has(k)) throw new Error('forbidden key');
        checkString(k);
        if (i > 0) out.push(',');
        out.push(quote(k), ':');
        encode(obj[k], out);
      });
    out.push('}');
  } else throw new Error('unsupported value');
}

/** Hash of a public entry body (every field except `hash`). */
export function hashPublicEntry(body: unknown): string {
  const out: string[] = [];
  encode(body, out);
  return sha256HexOf(new TextEncoder().encode(out.join('')));
}

type Entry = ReplayBundle['events'][number];

function isAnchoredClose(entries: readonly Entry[]): boolean {
  const last = entries[entries.length - 1];
  const before = entries[entries.length - 2];
  if (last === undefined || before === undefined || last.type !== 'AUCTION_CLOSED') return false;
  const named = last.payload['headHash'];
  const anchor =
    Array.isArray(last.redacted) && last.redacted.includes('headHash')
      ? before.hash
      : before.fullHash;
  return typeof named === 'string' && named === anchor;
}

/** Same checks as the engine's `verifyPublicExport`, optionally against the head the bundle claims. */
export function verifyPublicChain(
  entries: readonly Entry[],
  expectedHead?: { seq: number; hash: string },
): PublicChainResult {
  let prev = GENESIS_PREV;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i] as Entry;
    const fail = (reason: PublicChainFailure): PublicChainResult => ({
      ok: false,
      firstBadIndex: i,
      reason,
    });
    if (typeof e !== 'object' || e === null || (e.v as number) !== 4) return fail('bad_version');
    if (e.seq !== i + 1) return fail('bad_seq');
    if (e.prev !== prev) return fail('bad_prev');
    const { hash, ...body } = e;
    let h: string;
    try {
      h = hashPublicEntry(body);
    } catch {
      return fail('bad_hash');
    }
    if (h !== hash) return fail('bad_hash');
    prev = hash;
  }
  if (expectedHead !== undefined) {
    const last = entries[entries.length - 1];
    if (last === undefined || last.seq !== expectedHead.seq || last.hash !== expectedHead.hash) {
      return { ok: false, firstBadIndex: entries.length, reason: 'truncated' };
    }
  }
  return { ok: true, count: entries.length, headHash: prev, closed: isAnchoredClose(entries) };
}
