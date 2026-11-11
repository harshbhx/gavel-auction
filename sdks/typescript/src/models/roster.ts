import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";
import { holdSchema, type Hold } from "./hold.js";

export type Roster = {
  /** 26 character id (Crockford base 32). */
  bidderId: string;
  /** Paddle number of the bidder. */
  paddle: number;
  /** Display name of the bidder. */
  name: string;
  /** HELD when the bidder has a hold, otherwise NONE. */
  hold: Hold;
};

export const rosterSchema: Schema<Roster> = s.object<Roster>({
  bidderId: s.string(),
  paddle: s.int(),
  name: s.string(),
  hold: holdSchema,
});
