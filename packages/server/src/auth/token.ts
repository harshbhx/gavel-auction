import { isUlid } from '@gavel/shared';
import type { ErrorCode } from '@gavel/shared';
import { z } from 'zod';

export const TOKEN_KINDS = ['invite', 'session', 'auctioneer', 'screen'] as const;
export type TokenKind = (typeof TOKEN_KINDS)[number];

/** Lifetimes in seconds: invite 24 h, session 4 h, auctioneer 12 h, screen 12 h. */
export const TOKEN_TTL_S: Readonly<Record<TokenKind, number>> = {
  invite: 24 * 3600,
  session: 4 * 3600,
  auctioneer: 12 * 3600,
  screen: 12 * 3600,
};

const ulid = z.string().refine(isUlid, 'invalid id');

/** Payload is strict: an `alg` (or any other unknown) field is rejected. */
export const TokenPayloadSchema = z
  .object({
    kind: z.enum(TOKEN_KINDS),
    aud: ulid,
    sub: z.string().min(1),
    bidderId: ulid.optional(),
    jti: ulid,
    iat: z.number().int().nonnegative(),
    exp: z.number().int().nonnegative(),
  })
  .strict();

export type TokenPayload = z.infer<typeof TokenPayloadSchema>;

export type VerifyResult =
  | {
      ok: true;
      payload: TokenPayload;
      /** Present only when no secret but a later (previous) one matched the signature. */
      viaPrevious?: true;
    }
  | {
      ok: false;
      code: Extract<ErrorCode, 'unauthorized' | 'forbidden' | 'invite_used'>;
      reason: string;
    };

/**
 * Revocation and single-use state, supplied by the store. Required on every
 * verification so the denylist and replay checks cannot be skipped (R-RT-083/084).
 */
export interface JtiStore {
  /** True when the jti is on the denylist. */
  isRevoked(jti: string): Promise<boolean>;
  /**
   * True when an invite jti is already used, without using it. Optional: when absent,
   * verification cannot reject a used invite and only `consumeInvite` does.
   */
  isUsed?(jti: string): Promise<boolean>;
  /** Mark an invite jti as used. Resolves false when it was already used. */
  consume(jti: string, expSec: number): Promise<boolean>;
}

export interface VerifyOptions {
  /** The auction the caller is talking to. */
  aud: string;
  /** Kinds the route accepts. */
  kinds: readonly TokenKind[];
  /** Current time in epoch milliseconds. */
  nowMs: number;
  /** Denylist and invite replay state; any error from it fails the check closed. */
  jtis: JtiStore;
}

/** Clock skew tolerated when comparing `iat` with the server clock. */
export const MAX_IAT_SKEW_S = 60;

const B64URL = /^[A-Za-z0-9_-]+$/;
const encoder = new TextEncoder();

function toB64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64Url(text: string): Uint8Array | null {
  if (!B64URL.test(text) || text.length % 4 === 1) return null;
  try {
    const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

async function mac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(data)));
}

/** Compare without exiting early on the first differing byte. */
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

/** Produce `base64url(payload).base64url(HMAC-SHA256)`. The algorithm is fixed. */
export async function signToken(payload: TokenPayload, secret: string): Promise<string> {
  const body = toB64Url(encoder.encode(JSON.stringify(TokenPayloadSchema.parse(payload))));
  return `${body}.${toB64Url(await mac(secret, body))}`;
}

const deny = (
  code: 'unauthorized' | 'forbidden' | 'invite_used',
  reason: string,
): VerifyResult => ({
  ok: false,
  code,
  reason,
});

/**
 * Verify signature, shape, audience, lifetime, kind, identity binding, revocation and, when the
 * store can tell, an already used invite. Has no side effects. Never throws.
 */
export async function verifyToken(
  token: string,
  secrets: string | readonly string[],
  opts: VerifyOptions,
): Promise<VerifyResult> {
  const parts = token.split('.');
  if (parts.length !== 2) return deny('unauthorized', 'malformed token');
  const [body, sig] = parts as [string, string];
  const gotSig = fromB64Url(sig);
  const rawBody = fromB64Url(body);
  // Re-encoding must reproduce the input, so non-canonical padding bits are refused.
  if (!gotSig || !rawBody || toB64Url(gotSig) !== sig) {
    return deny('unauthorized', 'malformed token');
  }

  // Try every configured secret (current first, then previous) without exiting
  // early, so rotation does not log everyone out and timing stays flat.
  const list = typeof secrets === 'string' ? [secrets] : secrets;
  let signed = false;
  let current = false;
  for (const [i, secret] of list.entries()) {
    const expected = await mac(secret, body);
    if (constantTimeEqual(expected, gotSig)) {
      signed = true;
      if (i === 0) current = true;
    }
  }
  if (!signed) return deny('unauthorized', 'bad signature');

  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(rawBody));
  } catch {
    return deny('unauthorized', 'malformed payload');
  }
  const parsed = TokenPayloadSchema.safeParse(json);
  if (!parsed.success) return deny('unauthorized', 'malformed payload');
  const payload = parsed.data;

  if (payload.aud !== opts.aud) return deny('unauthorized', 'wrong audience');
  if (payload.exp * 1000 <= opts.nowMs) return deny('unauthorized', 'expired');
  if (payload.iat * 1000 > opts.nowMs + MAX_IAT_SKEW_S * 1000) {
    return deny('unauthorized', 'issued in the future');
  }
  if (payload.exp <= payload.iat || payload.exp - payload.iat > TOKEN_TTL_S[payload.kind]) {
    return deny('unauthorized', 'bad lifetime');
  }
  // A wrong kind is an authentication failure (4401), not a permission failure.
  if (!opts.kinds.includes(payload.kind)) return deny('unauthorized', 'wrong token kind');
  if (payload.kind === 'session' && payload.bidderId === undefined) {
    return deny('unauthorized', 'session token without bidderId');
  }
  if (payload.bidderId !== undefined && payload.sub !== payload.bidderId) {
    return deny('unauthorized', 'sub does not match bidderId');
  }

  try {
    if (await opts.jtis.isRevoked(payload.jti)) return deny('unauthorized', 'revoked');
    // Verifying never consumes: the caller burns the invite with `consumeInvite` once it has
    // created the session, so a later failure or a copied link cannot lock the bidder out.
    if (payload.kind === 'invite' && (await opts.jtis.isUsed?.(payload.jti)) === true) {
      return deny('invite_used', 'invite already used');
    }
  } catch {
    return deny('unauthorized', 'revocation check failed');
  }
  return current || list.length < 2
    ? { ok: true, payload }
    : { ok: true, payload, viaPrevious: true };
}

/**
 * Burn a verified invite. Call it in the same step that creates the session, after every other
 * check has passed, and only for the first use: a second call reports `invite_used`.
 */
export async function consumeInvite(
  payload: TokenPayload,
  jtis: Pick<JtiStore, 'consume'>,
): Promise<{ ok: true } | { ok: false; code: 'unauthorized' | 'invite_used'; reason: string }> {
  if (payload.kind !== 'invite') return { ok: true };
  try {
    if (!(await jtis.consume(payload.jti, payload.exp))) {
      return { ok: false, code: 'invite_used', reason: 'invite already used' };
    }
  } catch {
    return { ok: false, code: 'unauthorized', reason: 'revocation check failed' };
  }
  return { ok: true };
}
