import * as s from "../core/validation/index.js";
import type { EnumSchema } from "../core/validation/schema.js";

/** HELD when the bidder has a hold, otherwise NONE. */
export const Hold = {
  Held: "HELD",
  None: "NONE",
} as const;
export type Hold = (typeof Hold)[keyof typeof Hold] | (string & {});

export const holdSchema: EnumSchema<Hold> = s.enumOf<Hold>(Hold);
