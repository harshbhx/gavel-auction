import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";

/** Fundraiser goal, present only when one was set. */
export type Fundraiser = {
  /** Goal in cents. */
  goalCents: number;
};

export const fundraiserSchema: Schema<Fundraiser> = s.object<Fundraiser>({
  goalCents: s.int(),
});
