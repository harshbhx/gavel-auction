import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";
import { reasonSchema, type Reason } from "./reason.js";

export type Readyz503Error = {
  /** @default "unavailable" */
  status?: "unavailable";
  reason: Reason;
};

export const readyz503ErrorSchema: Schema<Readyz503Error> = s.object<Readyz503Error>({
  status: s.defaulted(s.literal("unavailable"), "unavailable"),
  reason: reasonSchema,
});
