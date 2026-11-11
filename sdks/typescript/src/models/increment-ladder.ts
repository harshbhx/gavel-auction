import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";

export type IncrementLadder = {
  /** Price in cents from which this increment applies. */
  fromCents: number;
  /** Smallest raise in cents at this price tier. */
  incrementCents: number;
};

export const incrementLadderSchema: Schema<IncrementLadder> = s.object<IncrementLadder>({
  fromCents: s.int(),
  incrementCents: s.int(),
});
