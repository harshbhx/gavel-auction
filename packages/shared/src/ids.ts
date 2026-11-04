import { GavelError } from './errors';

declare const brand: unique symbol;

/** A 26-char Crockford base32 ULID, branded by kind. */
export type Ulid<B extends string> = string & { readonly [brand]: B };

export type AuctionId = Ulid<'AuctionId'>;
export type BidderId = Ulid<'BidderId'>;
export type BidId = Ulid<'BidId'>;
export type MsgId = Ulid<'MsgId'>;
export type ConnId = Ulid<'ConnId'>;
export type EventId = Ulid<'EventId'>;
export type Jti = Ulid<'Jti'>;

export const ULID_LENGTH = 26;
export const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** Highest first character: keeps the 48-bit time prefix from overflowing. */
const MAX_FIRST_CHAR = '7';

const ULID_RE = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

export function isUlid(raw: unknown): raw is string {
  return typeof raw === 'string' && raw.length === ULID_LENGTH && ULID_RE.test(raw) && raw[0]! <= MAX_FIRST_CHAR;
}

/** Validate a raw string and brand it. Throws `bad_message` when invalid. */
export function parseId<B extends string = string>(raw: unknown): Ulid<B> {
  if (!isUlid(raw)) {
    throw new GavelError('bad_message', 'invalid id');
  }
  return raw as Ulid<B>;
}
