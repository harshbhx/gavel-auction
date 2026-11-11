import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";

export type ApiHoldsRequest = {
  /** 26 character id (Crockford base 32). */
  auctionId: string;
  /** Highest amount this bidder allows, in cents. */
  ceilingCents: number;
};

export const apiHoldsRequestSchema: Schema<ApiHoldsRequest> = s.object<ApiHoldsRequest>({
  auctionId: s.string(),
  ceilingCents: s.int(),
});
