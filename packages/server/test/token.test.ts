import { describe, expect, it } from 'vitest';
import {
  signToken,
  verifyToken,
  TOKEN_TTL_S,
  consumeInvite,
  type JtiStore,
  type TokenPayload,
} from '../src/auth/token';

const AUCTION = '01J9ZQ4Y6Z8K3M5N7P9R1S3T5V';
const OTHER = '01J9ZQ4Y6Z8K3M5N7P9R1S3T5W';
const BIDDER = '01J9ZQ3A0B2C4D6F8H0J2K4M6N';
const SECRET = 'test-secret-test-secret-test-secret';
const NOW_S = 1_789_000_000;
const NOW_MS = NOW_S * 1000;

const payload: TokenPayload = {
  kind: 'session',
  aud: AUCTION,
  sub: BIDDER,
  bidderId: BIDDER,
  jti: '01J9ZQ6A0B2C4D6F8H0J2K4M6N',
  iat: NOW_S,
  exp: NOW_S + TOKEN_TTL_S.session,
};

/** In-memory denylist and single-use set for tests. */
class TestJtis implements JtiStore {
  readonly revoked = new Set<string>();
  readonly used = new Set<string>();
  fail = false;
  async isRevoked(jti: string): Promise<boolean> {
    if (this.fail) throw new Error('store down');
    return this.revoked.has(jti);
  }
  async isUsed(jti: string): Promise<boolean> {
    if (this.fail) throw new Error('store down');
    return this.used.has(jti);
  }
  async consume(jti: string): Promise<boolean> {
    if (this.fail) throw new Error('store down');
    if (this.used.has(jti)) return false;
    this.used.add(jti);
    return true;
  }
}

const opts = { aud: AUCTION, kinds: ['session'] as const, nowMs: NOW_MS, jtis: new TestJtis() };
const b64url = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

describe('token sign and verify (T-RT-058)', () => {
  it('round trips', async () => {
    const token = await signToken(payload, SECRET);
    expect(token.split('.')).toHaveLength(2);
    const r = await verifyToken(token, SECRET, opts);
    expect(r).toEqual({ ok: true, payload });
  });

  it('is deterministic for a payload and secret', async () => {
    expect(await signToken(payload, SECRET)).toBe(await signToken(payload, SECRET));
  });

  it('rejects a different secret', async () => {
    const token = await signToken(payload, SECRET);
    const r = await verifyToken(token, 'another-secret-another-secret-xx', opts);
    expect(r.ok).toBe(false);
  });

  it('rejects any single flipped bit in payload or signature', async () => {
    const token = await signToken(payload, SECRET);
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    for (let i = 0; i < token.length; i++) {
      if (token[i] === '.') continue;
      const swap = alphabet[(alphabet.indexOf(token[i] ?? 'A') + 1) % alphabet.length] ?? 'A';
      const bad = token.slice(0, i) + swap + token.slice(i + 1);
      const r = await verifyToken(bad, SECRET, opts);
      expect(r.ok, `position ${i}`).toBe(false);
    }
  });

  it('rejects alg-none style tokens and extra segments', async () => {
    const header = b64url(JSON.stringify({ alg: 'none', typ: 'JWT' }));
    const body = b64url(JSON.stringify(payload));
    for (const bad of [`${header}.${body}.`, `${header}.${body}.sig`, `${body}.`, body, '']) {
      const r = await verifyToken(bad, SECRET, opts);
      expect(r.ok).toBe(false);
    }
  });

  it('rejects an alg field smuggled into a correctly signed payload', async () => {
    const body = b64url(JSON.stringify({ ...payload, alg: 'none' }));
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const sig = new Uint8Array(
      await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)),
    );
    const sigText = btoa(String.fromCharCode(...sig))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const r = await verifyToken(`${body}.${sigText}`, SECRET, opts);
    expect(r.ok).toBe(false);
  });

  it('rejects non base64url characters without throwing', async () => {
    const r = await verifyToken('a b.c+d', SECRET, opts);
    expect(r.ok).toBe(false);
  });

  it('refuses to sign a payload that carries extra fields', async () => {
    const extra = { ...payload, alg: 'none' } as unknown as TokenPayload;
    await expect(signToken(extra, SECRET)).rejects.toThrow();
  });
});

describe('token claims (T-RT-059)', () => {
  it('rejects the wrong audience', async () => {
    const token = await signToken({ ...payload, aud: OTHER }, SECRET);
    const r = await verifyToken(token, SECRET, opts);
    expect(r).toMatchObject({ ok: false, code: 'unauthorized' });
  });

  it('rejects an expired token (exp = now - 1)', async () => {
    const token = await signToken({ ...payload, exp: NOW_S - 1 }, SECRET);
    const r = await verifyToken(token, SECRET, opts);
    expect(r).toMatchObject({ ok: false, code: 'unauthorized' });
  });

  it('rejects a token that expires exactly now', async () => {
    const token = await signToken({ ...payload, exp: NOW_S }, SECRET);
    const r = await verifyToken(token, SECRET, opts);
    expect(r.ok).toBe(false);
  });

  it('accepts a token one second before expiry', async () => {
    const token = await signToken({ ...payload, exp: NOW_S + 1 }, SECRET);
    const r = await verifyToken(token, SECRET, opts);
    expect(r.ok).toBe(true);
  });

  it('rejects the wrong kind for the route', async () => {
    const token = await signToken({ ...payload, kind: 'screen' }, SECRET);
    const r = await verifyToken(token, SECRET, opts);
    expect(r).toMatchObject({ ok: false, code: 'unauthorized' });
  });

  it('accepts any kind the route lists', async () => {
    const token = await signToken({ ...payload, kind: 'auctioneer' }, SECRET);
    const r = await verifyToken(token, SECRET, { ...opts, kinds: ['session', 'auctioneer'] });
    expect(r.ok).toBe(true);
  });

  it('exposes the documented lifetimes', () => {
    expect(TOKEN_TTL_S).toEqual({
      invite: 86_400,
      session: 14_400,
      auctioneer: 43_200,
      screen: 43_200,
    });
  });
});

describe('secret rotation (R-RT-082)', () => {
  const PREVIOUS = 'previous-secret-previous-secret-xx';

  it('accepts a token signed by the previous secret', async () => {
    const token = await signToken(payload, PREVIOUS);
    expect((await verifyToken(token, [SECRET, PREVIOUS], opts)).ok).toBe(true);
    expect((await verifyToken(token, SECRET, opts)).ok).toBe(false);
  });

  it('accepts the current secret and rejects an unknown one', async () => {
    const token = await signToken(payload, SECRET);
    expect((await verifyToken(token, [SECRET, PREVIOUS], opts)).ok).toBe(true);
    const stranger = await signToken(payload, 'unknown-secret-unknown-secret-xxx');
    expect((await verifyToken(stranger, [SECRET, PREVIOUS], opts)).ok).toBe(false);
  });
});

describe('revocation and replay (R-RT-083, R-RT-084)', () => {
  it('rejects a revoked jti', async () => {
    const jtis = new TestJtis();
    jtis.revoked.add(payload.jti);
    const token = await signToken(payload, SECRET);
    const r = await verifyToken(token, SECRET, { ...opts, jtis });
    expect(r).toMatchObject({ ok: false, code: 'unauthorized' });
  });

  it('does not consume an invite on verify, so a failed exchange can retry', async () => {
    const jtis = new TestJtis();
    const invite: TokenPayload = { ...payload, kind: 'invite', exp: NOW_S + TOKEN_TTL_S.invite };
    const token = await signToken(invite, SECRET);
    const o = { ...opts, kinds: ['invite'] as const, jtis };
    expect((await verifyToken(token, SECRET, o)).ok).toBe(true);
    expect((await verifyToken(token, SECRET, o)).ok).toBe(true);
    expect(jtis.used.size).toBe(0);
  });

  it('burns an invite only through consumeInvite, then reports invite_used', async () => {
    const jtis = new TestJtis();
    const invite: TokenPayload = { ...payload, kind: 'invite', exp: NOW_S + TOKEN_TTL_S.invite };
    const token = await signToken(invite, SECRET);
    const o = { ...opts, kinds: ['invite'] as const, jtis };
    expect(await consumeInvite(invite, jtis)).toEqual({ ok: true });
    expect(await verifyToken(token, SECRET, o)).toMatchObject({ ok: false, code: 'invite_used' });
    expect(await consumeInvite(invite, jtis)).toMatchObject({ ok: false, code: 'invite_used' });
  });

  it('consumeInvite fails closed when the store throws', async () => {
    const jtis = new TestJtis();
    jtis.fail = true;
    const invite: TokenPayload = { ...payload, kind: 'invite', exp: NOW_S + TOKEN_TTL_S.invite };
    expect(await consumeInvite(invite, jtis)).toMatchObject({ ok: false, code: 'unauthorized' });
  });

  it('does not burn an invite that fails another check', async () => {
    const jtis = new TestJtis();
    const invite: TokenPayload = { ...payload, kind: 'invite', exp: NOW_S + TOKEN_TTL_S.invite };
    const token = await signToken(invite, SECRET);
    const bad = { ...opts, aud: OTHER, kinds: ['invite'] as const, jtis };
    expect((await verifyToken(token, SECRET, bad)).ok).toBe(false);
    expect(jtis.used.size).toBe(0);
  });

  it('fails closed when the store errors', async () => {
    const jtis = new TestJtis();
    jtis.fail = true;
    const token = await signToken(payload, SECRET);
    expect(await verifyToken(token, SECRET, { ...opts, jtis })).toMatchObject({
      ok: false,
      code: 'unauthorized',
    });
  });
});

describe('claim binding (T-RT-059)', () => {
  const check = async (p: TokenPayload) =>
    verifyToken(await signToken(p, SECRET), SECRET, { ...opts, jtis: new TestJtis() });

  it('rejects a session token without bidderId', async () => {
    const rest: Partial<TokenPayload> = { ...payload };
    delete rest.bidderId;
    expect((await check(rest as TokenPayload)).ok).toBe(false);
  });

  it('rejects sub that differs from bidderId', async () => {
    expect((await check({ ...payload, sub: OTHER })).ok).toBe(false);
  });

  it('rejects an iat in the future', async () => {
    const r = await check({ ...payload, iat: NOW_S + 3600, exp: NOW_S + 3600 + 100 });
    expect(r.ok).toBe(false);
  });

  it('rejects a lifetime longer than the kind allows, and exp before iat', async () => {
    expect((await check({ ...payload, exp: NOW_S + TOKEN_TTL_S.session + 1 })).ok).toBe(false);
    expect((await check({ ...payload, exp: NOW_S - 5, iat: NOW_S })).ok).toBe(false);
  });

  it('answers a wrong kind with unauthorized, not forbidden', async () => {
    const token = await signToken({ ...payload, kind: 'screen' }, SECRET);
    expect(await verifyToken(token, SECRET, { ...opts, jtis: new TestJtis() })).toMatchObject({
      ok: false,
      code: 'unauthorized',
    });
  });
});
