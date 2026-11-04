import { createHash } from 'node:crypto';

export type RequestOp = 'order' | 'authorize' | 'capture' | 'void' | 'reauth';

export interface RequestIdParts {
  auctionId: string;
  op: RequestOp;
  holdId: string;
  amountCents: number;
  /** Only changes when parameters change; never on retry or resume. */
  generation: number;
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 4648 base32 (no padding). */
export function base32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** Deterministic PayPal-Request-Id (SPEC 4.4): 44 characters. */
export function buildRequestId(p: RequestIdParts): string {
  if (!Number.isInteger(p.amountCents) || p.amountCents < 0)
    throw new RangeError('amountCents must be a non-negative integer');
  if (!Number.isInteger(p.generation) || p.generation < 0)
    throw new RangeError('generation must be a non-negative integer');
  const digest = createHash('sha256')
    .update(`${p.auctionId}|${p.op}|${p.holdId}|${p.amountCents}|${p.generation}`)
    .digest();
  return `gv1-${base32(digest).slice(0, 40)}`;
}
