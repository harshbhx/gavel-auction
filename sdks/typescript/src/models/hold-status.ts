import * as s from "../core/validation/index.js";
import type { EnumSchema } from "../core/validation/schema.js";

export const HoldStatus = {
  PendingApproval: "PENDING_APPROVAL",
  Held: "HELD",
  Captured: "CAPTURED",
  Voided: "VOIDED",
  Expired: "EXPIRED",
  Denied: "DENIED",
  Unknown: "UNKNOWN",
} as const;
export type HoldStatus = (typeof HoldStatus)[keyof typeof HoldStatus] | (string & {});

export const holdStatusSchema: EnumSchema<HoldStatus> = s.enumOf<HoldStatus>(HoldStatus);
