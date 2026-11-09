import { HOLD_ERROR_CODES, type HoldErrorCode } from '@gavel/shared';
import type { CopyKey } from './en';

/**
 * Error codes the server can send, mirrored from @gavel/shared (errors.ts). The unit test
 * reads that file and fails when the two lists differ.
 */
export const KNOWN_ERROR_CODES = [
  'bad_message',
  'unsupported_version',
  'not_joined',
  'unauthorized',
  'forbidden',
  'invite_used',
  'rate_limited',
  'room_full',
  'auction_full',
  'room_cap',
  'unregistered',
  'below_increment',
  'over_ceiling',
  'below_reserve',
  'closed',
  'already_leading',
  'bad_amount',
  'lot_not_open',
  'ceiling_revoked',
  'unconfirmed',
  'not_higher_than_own_max',
  'already_bid',
  'limit_exceeded',
  'auction_paused',
  'store_unavailable',
  'conflict',
  'host_fenced',
  'not_found',
  'internal',
] as const;

export type KnownErrorCode = (typeof KNOWN_ERROR_CODES)[number];

/** One table, exhaustive over the code union: adding a code without copy fails to compile (R-WEB-027). */
export const errorCopyTable: Readonly<Record<KnownErrorCode, CopyKey>> = {
  bad_message: 'generic.error',
  unsupported_version: 'generic.error',
  not_joined: 'generic.error',
  unauthorized: 'err.tokenMissing',
  forbidden: 'err.tokenMissing',
  invite_used: 'err.tokenMissing',
  rate_limited: 'bid.rej.rate_limited',
  room_full: 'generic.error',
  auction_full: 'generic.error',
  room_cap: 'generic.error',
  unregistered: 'bid.rej.unregistered',
  below_increment: 'bid.rej.below_increment',
  over_ceiling: 'bid.rej.over_ceiling',
  below_reserve: 'bid.rej.below_reserve',
  closed: 'bid.rej.closed',
  already_leading: 'bid.rej.already_leading',
  bad_amount: 'bid.rej.bad_amount',
  lot_not_open: 'bid.rej.closed',
  ceiling_revoked: 'bid.rej.ceiling_revoked',
  unconfirmed: 'bid.rej.unconfirmed',
  not_higher_than_own_max: 'bid.rej.not_higher_than_own_max',
  already_bid: 'bid.rej.generic',
  limit_exceeded: 'bid.rej.limit_exceeded',
  auction_paused: 'bid.paused',
  store_unavailable: 'generic.error',
  conflict: 'generic.error',
  host_fenced: 'generic.error',
  not_found: 'err.notFound',
  internal: 'generic.error',
};

/** Payments error codes (HoldErrorResponse), one copy key each; exhaustive over the shared list. */
export const holdErrorCopyTable: Readonly<Record<HoldErrorCode, CopyKey>> = {
  ceiling_out_of_range: 'err.pay.ceilingOutOfRange',
  hold_exists: 'err.pay.holdExists',
  raise_limit_reached: 'err.pay.raiseLimitReached',
  raise_too_small: 'err.pay.raiseTooSmall',
  order_not_found: 'err.pay.orderNotFound',
  order_not_approved: 'err.pay.orderNotApproved',
  paypal_unavailable: 'err.pay.unavailable',
  kill_switch_engaged: 'err.pay.unavailable',
  payments_not_sandbox: 'err.pay.notSandbox',
};

export function isHoldErrorCode(code: unknown): code is HoldErrorCode {
  return typeof code === 'string' && (HOLD_ERROR_CODES as readonly string[]).includes(code);
}

function isKnown(code: string): code is KnownErrorCode {
  return Object.prototype.hasOwnProperty.call(errorCopyTable, code);
}

/**
 * Copy key for a code, plus the raw code for the "Details" disclosure.
 * An unknown code maps to the generic bid message and keeps its raw value.
 */
export function errorCopy(code: string): { key: CopyKey; raw: string } {
  if (isHoldErrorCode(code)) return { key: holdErrorCopyTable[code], raw: code };
  return { key: isKnown(code) ? errorCopyTable[code] : 'bid.rej.generic', raw: code };
}
