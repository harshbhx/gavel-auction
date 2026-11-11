import * as s from "../core/validation/index.js";
import type { EnumSchema } from "../core/validation/schema.js";

/** Stable code (hold, judge and operator routes). */
export const Error4 = {
  BidRejected: "bid_rejected",
} as const;
export type Error4 = (typeof Error4)[keyof typeof Error4] | (string & {});

export const error4Schema: EnumSchema<Error4> = s.enumOf<Error4>(Error4);
