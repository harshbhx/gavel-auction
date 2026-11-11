import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";

export type ApiHoldsApproveResponse = {
  holdId: string;
  /** @default "HELD" */
  status?: "HELD";
  ceilingCents: number;
};

export const apiHoldsApproveResponseSchema: Schema<ApiHoldsApproveResponse> =
  s.object<ApiHoldsApproveResponse>({
    holdId: s.string(),
    status: s.defaulted(s.literal("HELD"), "HELD"),
    ceilingCents: s.int(),
  });
