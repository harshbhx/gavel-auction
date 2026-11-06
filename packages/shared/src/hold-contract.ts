import { z } from 'zod';

/** Same limit as MAX_NAME_CHARS in the wire envelope (a test keeps them equal); no import so payments stays self-contained. */
const MAX_BIDDER_NAME_CHARS = 64;

/**
 * Characters a bidder name may never hold: control characters (U+0000-U+001F, U+007F-U+009F),
 * zero-width and direction marks (U+200B-U+200F, U+2028-U+202F, U+2060-U+206F, U+FEFF, U+061C;
 * this covers the bidi overrides and isolates) and angle brackets. U+200C and U+200D are
 * allowed only between two non-space, non-invisible characters (joined emoji, Persian, Indic). The room reuses this pattern,
 * so a name that passes here is never refused later, and a name made only of invisible
 * characters cannot register as a blank or look-alike bidder.
 */
export const BIDDER_NAME_FORBIDDEN_PATTERN = new RegExp(
  // Control and invisible characters (ZWJ and ZWNJ are judged separately below) and angle brackets.
  // eslint-disable-next-line no-control-regex -- control characters are what this pattern forbids
  '[\\u0000-\\u001F\\u007F-\\u009F\\u061C\\u200B\\u200E\\u200F\\u2028-\\u202F\\u2060-\\u206F\\uFEFF<>]' +
    // ZWJ (U+200D) and ZWNJ (U+200C) hold joined emoji and some Persian and Indic names, so they
    // are allowed only between two characters that are neither space nor invisible.
    '|(?<![^\\s\\u0000-\\u001F\\u007F-\\u009F\\u061C\\u200B-\\u200F\\u2028-\\u202F\\u2060-\\u206F\\uFEFF<>])[\\u200C\\u200D]' +
    '|[\\u200C\\u200D](?![^\\s\\u0000-\\u001F\\u007F-\\u009F\\u061C\\u200B-\\u200F\\u2028-\\u202F\\u2060-\\u206F\\uFEFF<>])',
  'u',
);

export const HOLD_ERROR_CODES = [
  'ceiling_out_of_range',
  'hold_exists',
  'order_not_found',
  'order_not_approved',
  'paypal_unavailable',
  'kill_switch_engaged',
  'payments_not_sandbox',
] as const;
export type HoldErrorCode = (typeof HOLD_ERROR_CODES)[number];

/** HTTP status used for each error code. */
export const HOLD_ERROR_STATUS: Record<HoldErrorCode, number> = {
  ceiling_out_of_range: 400,
  hold_exists: 409,
  order_not_found: 404,
  order_not_approved: 409,
  paypal_unavailable: 503,
  kill_switch_engaged: 503,
  payments_not_sandbox: 503,
};

const id = z.string().min(1);

/**
 * POST /api/holds request. There is deliberately no bidderId: the server derives
 * the bidder from the authenticated session, and `.strict()` rejects a body that
 * tries to name one (R-PAY-030, R-PAY-035).
 */
export const CreateHoldRequest = z
  .object({
    auctionId: id,
    ceilingCents: z.number().int().positive(),
  })
  .strict();
export type CreateHoldRequest = z.infer<typeof CreateHoldRequest>;

/** POST /api/holds response. clientToken is opaque and UNVERIFIED (G2); approveUrl is optional. */
export const CreateHoldResponse = z
  .object({
    holdId: id,
    orderId: id,
    clientToken: z.string().min(1).optional(),
    /** PayPal's own approval page, for the redirect fallback when the popup cannot open. */
    approveUrl: z.string().min(1).optional(),
  })
  .strict();
export type CreateHoldResponse = z.infer<typeof CreateHoldResponse>;

/** POST /api/holds/{holdId}/approve request. */
export const ApproveHoldRequest = z
  .object({
    orderId: id,
    /**
     * Display name of the bidder. When present the server also registers the bidder in the
     * room once the hold is authorized (idempotent); absent, only the hold is approved.
     */
    name: z
      .string()
      .trim()
      .min(1)
      .max(MAX_BIDDER_NAME_CHARS)
      .refine((v) => !BIDDER_NAME_FORBIDDEN_PATTERN.test(v), 'name holds a forbidden character')
      .optional(),
  })
  .strict();
export type ApproveHoldRequest = z.infer<typeof ApproveHoldRequest>;

/** POST /api/holds/{holdId}/approve response. */
export const ApproveHoldResponse = z
  .object({
    holdId: id,
    status: z.literal('HELD'),
    ceilingCents: z.number().int().positive(),
  })
  .strict();
export type ApproveHoldResponse = z.infer<typeof ApproveHoldResponse>;

/** Lifecycle of one hold as the payments hold store records it (payments `HoldStatus`). */
export const HOLD_STATUSES = [
  'PENDING_APPROVAL',
  'HELD',
  'CAPTURED',
  'VOIDED',
  'EXPIRED',
  'DENIED',
  'UNKNOWN',
] as const;
export type HoldStatusName = (typeof HOLD_STATUSES)[number];

/** GET /api/holds/{holdId} response: the session bidder's own hold, nobody else's. */
export const HoldViewResponse = z
  .object({
    holdId: id,
    status: z.enum(HOLD_STATUSES),
    ceilingCents: z.number().int().positive(),
  })
  .strict();
export type HoldViewResponse = z.infer<typeof HoldViewResponse>;

/** DELETE /api/holds/{holdId} response when the unapproved hold is released (now or before). */
export const AbandonHoldResponse = z
  .object({
    holdId: id,
    released: z.literal(true),
  })
  .strict();
export type AbandonHoldResponse = z.infer<typeof AbandonHoldResponse>;

/** Error body for every non-2xx response of the hold routes. */
export const HoldErrorResponse = z
  .object({
    error: z.enum(HOLD_ERROR_CODES),
    message: z.string().optional(),
  })
  .strict();
export type HoldErrorResponse = z.infer<typeof HoldErrorResponse>;

/** Browser abandon (onCancel, onError): DELETE /api/holds/{holdId}, no body. */
export const ABANDON_HOLD_METHOD = 'DELETE';

/**
 * Ownership rule for approve and abandon (R-PAY-035): the session bidder must be
 * the hold's bidder. A route handler answers a mismatch exactly like an unknown
 * hold (404 order_not_found), so a guessed or leaked holdId reveals nothing and
 * cannot be used by another viewer.
 */
export function holdOwnedBySession(
  holdBidderId: string,
  sessionBidderId: string | undefined,
): boolean {
  return (
    sessionBidderId !== undefined && sessionBidderId !== '' && holdBidderId === sessionBidderId
  );
}
