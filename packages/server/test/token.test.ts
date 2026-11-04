import { describe, expect, it } from 'vitest';
import { signToken, verifyToken, TOKEN_TTL_S, type TokenPayload } from '../src/auth/token';

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

const opts = { aud: AUCTION, kinds: ['session'] as const, nowMs: NOW_MS };
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
    expect(r).toMatchObject({ ok: false, code: 'forbidden' });
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
