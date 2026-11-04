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
  | { ok: true; payload: TokenPayload }
  | { ok: false; code: Extract<ErrorCode, 'unauthorized' | 'forbidden'>; reason: string };

export interface VerifyOptions {
  /** The auction the caller is talking to. */
  aud: string;
  /** Kinds the route accepts. */
  kinds: readonly TokenKind[];
  /** Current time in epoch milliseconds. */
  nowMs: number;
}

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

const deny = (code: 'unauthorized' | 'forbidden', reason: string): VerifyResult => ({
  ok: false,
  code,
  reason,
});

/** Verify signature, shape, audience, expiry and kind. Never throws. */
export async function verifyToken(
  token: string,
  secret: string,
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

  const expected = await mac(secret, body);
  if (!constantTimeEqual(expected, gotSig)) return deny('unauthorized', 'bad signature');

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
  if (!opts.kinds.includes(payload.kind)) return deny('forbidden', 'wrong token kind');
  return { ok: true, payload };
}
