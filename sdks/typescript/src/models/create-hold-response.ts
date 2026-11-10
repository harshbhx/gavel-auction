import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";

export type CreateHoldResponse = {
  /** Id of the hold on this host. */
  holdId: string;
  /** PayPal sandbox order id for the hold. */
  orderId: string;
  /** PayPal's own approval page, for when the popup cannot open. */
  approveUrl?: string;
};

export const createHoldResponseSchema: Schema<CreateHoldResponse> = s.object<CreateHoldResponse>({
  holdId: s.string(),
  orderId: s.string(),
  approveUrl: s.optional(s.string()),
});
