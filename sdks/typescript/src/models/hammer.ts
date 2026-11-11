import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";

/** Result of the lot, present once it was hammered. */
export type Hammer = {
  /** Bidder id of the winner, or null when the lot did not sell. */
  winnerId: string | null;
  /** Money in integer US cents. There are no decimals anywhere in the API. */
  price: number;
};

export const hammerSchema: Schema<Hammer> = s.object<Hammer>({
  winnerId: s.nullable(s.string()),
  price: s.int(),
});
