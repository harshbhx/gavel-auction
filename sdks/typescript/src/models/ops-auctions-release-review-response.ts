import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";

export type OpsAuctionsReleaseReviewResponse = {
  /** @default "released" */
  status?: "released";
};

export const opsAuctionsReleaseReviewResponseSchema: Schema<OpsAuctionsReleaseReviewResponse> =
  s.object<OpsAuctionsReleaseReviewResponse>({
    status: s.defaulted(s.literal("released"), "released"),
  });
