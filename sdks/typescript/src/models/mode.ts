import * as s from "../core/validation/index.js";
import type { EnumSchema } from "../core/validation/schema.js";

/** Bidding mode. Defaults to english. */
export const Mode = {
  English: "english",
  Proxy: "proxy",
  SecondPrice: "second_price",
} as const;
export type Mode = (typeof Mode)[keyof typeof Mode] | (string & {});

export const modeSchema: EnumSchema<Mode> = s.enumOf<Mode>(Mode);
