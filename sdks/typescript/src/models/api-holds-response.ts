import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";
import { holdStatusSchema, type HoldStatus } from "./hold-status.js";

export type ApiHoldsResponse = {
  holdId: string;
  status: HoldStatus;
  ceilingCents: number;
};

export const apiHoldsResponseSchema: Schema<ApiHoldsResponse> = s.object<ApiHoldsResponse>({
  holdId: s.string(),
  status: holdStatusSchema,
  ceilingCents: s.int(),
});
