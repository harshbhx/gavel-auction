import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";

export type ApiHoldsResponse1 = {
  holdId: string;
  /** @default "True" */
  released?: "True";
};

export const apiHoldsResponse1Schema: Schema<ApiHoldsResponse1> = s.object<ApiHoldsResponse1>({
  holdId: s.string(),
  released: s.defaulted(s.literal("True"), "True"),
});
