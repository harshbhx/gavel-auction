import { SeqIds } from '@gavel/shared';
import { describe, expect, it } from 'vitest';
import { signToken, verifyToken } from '../src/auth/token';
import type { JtiStore, TokenPayload, VerifyOptions } from '../src/auth/token';

// T-RT-063: random byte strings and mutated valid tokens never verify and never throw.
// A seeded generator keeps every run reproducible.

const SECRET = 'fake-secret-for-tests-only-0123456789';
const NOW_MS = 1_700_000_000_000;
const ids = new SeqIds();

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const jtis: JtiStore = {
  isRevoked: async () => false,
  consume: async () => true,
};

const aud = ids.mint<'AuctionId'>();
const opts: VerifyOptions = { aud, kinds: ['auctioneer'], nowMs: NOW_MS, jtis };

async function validToken(): Promise<string> {
  const payload: TokenPayload = {
    kind: 'auctioneer',
    aud,
    sub: 'host',
    jti: ids.mint<'Jti'>(),
    iat: NOW_MS / 1000,
    exp: NOW_MS / 1000 + 3600,
  };
  return signToken(payload, SECRET);
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.=+/ ';

describe('token fuzz (T-RT-063)', () => {
  it('accepts the unmodified token', async () => {
    const res = await verifyToken(await validToken(), SECRET, opts);
    expect(res.ok).toBe(true);
  });

  it('never verifies random strings and never throws', async () => {
    const rnd = mulberry32(1);
    for (let i = 0; i < 500; i++) {
      const len = Math.floor(rnd() * 300);
      let s = '';
      for (let j = 0; j < len; j++) s += ALPHABET[Math.floor(rnd() * ALPHABET.length)];
      const res = await verifyToken(s, SECRET, opts);
      expect(res.ok).toBe(false);
    }
  });

  it('never verifies random binary text and never throws', async () => {
    const rnd = mulberry32(2);
    for (let i = 0; i < 300; i++) {
      const len = Math.floor(rnd() * 200);
      let s = '';
      for (let j = 0; j < len; j++) s += String.fromCharCode(Math.floor(rnd() * 0xffff));
      const res = await verifyToken(s, SECRET, opts);
      expect(res.ok).toBe(false);
    }
  });

  it('never verifies a token with any single character changed', async () => {
    const token = await validToken();
    const rnd = mulberry32(3);
    for (let i = 0; i < 400; i++) {
      const at = Math.floor(rnd() * token.length);
      const orig = token[at] as string;
      let repl = ALPHABET[Math.floor(rnd() * ALPHABET.length)] as string;
      if (repl === orig) repl = repl === 'A' ? 'B' : 'A';
      const mutated = token.slice(0, at) + repl + token.slice(at + 1);
      const res = await verifyToken(mutated, SECRET, opts);
      expect(res.ok).toBe(false);
    }
  });

  it('never verifies truncated, extended or swapped-part tokens', async () => {
    const token = await validToken();
    const [body = '', sig = ''] = token.split('.');
    const other = await validToken();
    const [body2 = ''] = other.split('.');
    const cases = [
      token.slice(0, -1),
      token.slice(0, 5),
      `${token}A`,
      `${token}.${sig}`,
      `${body}.`,
      `.${sig}`,
      `${body2}.${sig}`,
      `${sig}.${body}`,
      '',
      '.',
    ];
    for (const c of cases) {
      const res = await verifyToken(c, SECRET, opts);
      expect(res.ok).toBe(false);
    }
  });

  it('rejects a valid token under a different secret', async () => {
    const res = await verifyToken(await validToken(), 'another-fake-secret-0123456789', opts);
    expect(res.ok).toBe(false);
  });
});
