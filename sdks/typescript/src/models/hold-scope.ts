import * as s from "../core/validation/index.js";
import type { EnumSchema } from "../core/validation/schema.js";

/** Whether one hold covers the whole event or a single lot. The engine default is event. */
export const HoldScope = {
  Event: "event",
  Lot: "lot",
} as const;
export type HoldScope = (typeof HoldScope)[keyof typeof HoldScope] | (string & {});

export const holdScopeSchema: EnumSchema<HoldScope> = s.enumOf<HoldScope>(HoldScope);
