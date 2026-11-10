import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";
import { reasonSchema, type Reason } from "./reason.js";

export type Readyz503Error1 = {
  /** @default "unavailable" */
  status?: "unavailable";
  reason: Reason;
};

export const readyz503Error1Schema: Schema<Readyz503Error1> = s.object<Readyz503Error1>({
  status: s.defaulted(s.literal("unavailable"), "unavailable"),
  reason: reasonSchema,
});
