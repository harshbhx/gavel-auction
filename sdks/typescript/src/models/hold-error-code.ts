import * as s from "../core/validation/index.js";
import type { EnumSchema } from "../core/validation/schema.js";

/**
 * 400 ceiling_out_of_range; 404 order_not_found; 409 hold_exists, order_not_approved; 503
 * paypal_unavailable, kill_switch_engaged, payments_not_sandbox.
 */
export const HoldErrorCode = {
  CeilingOutOfRange: "ceiling_out_of_range",
  HoldExists: "hold_exists",
  OrderNotFound: "order_not_found",
  OrderNotApproved: "order_not_approved",
  PaypalUnavailable: "paypal_unavailable",
  KillSwitchEngaged: "kill_switch_engaged",
  PaymentsNotSandbox: "payments_not_sandbox",
} as const;
export type HoldErrorCode = (typeof HoldErrorCode)[keyof typeof HoldErrorCode] | (string & {});

export const holdErrorCodeSchema: EnumSchema<HoldErrorCode> = s.enumOf<HoldErrorCode>(HoldErrorCode);
