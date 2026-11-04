import { z } from 'zod';

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

/** POST /api/holds request. */
export const CreateHoldRequest = z
  .object({
    auctionId: id,
    bidderId: id,
    ceilingCents: z.number().int().positive(),
  })
  .strict();
export type CreateHoldRequest = z.infer<typeof CreateHoldRequest>;

/** POST /api/holds response. clientToken is opaque and UNVERIFIED (G2). */
export const CreateHoldResponse = z
  .object({
    holdId: id,
    orderId: id,
    clientToken: z.string().min(1).optional(),
  })
  .strict();
export type CreateHoldResponse = z.infer<typeof CreateHoldResponse>;

/** POST /api/holds/{holdId}/approve request. */
export const ApproveHoldRequest = z.object({ orderId: id }).strict();
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
