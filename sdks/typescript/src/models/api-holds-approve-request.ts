import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";

export type ApiHoldsApproveRequest = {
  orderId: string;
  /** Display name. Control characters, invisible direction marks and angle brackets are refused. */
  name?: string;
};

export const apiHoldsApproveRequestSchema: Schema<ApiHoldsApproveRequest> = s.object<ApiHoldsApproveRequest>({
  orderId: s.string(),
  name: s.optional(s.string()),
});
