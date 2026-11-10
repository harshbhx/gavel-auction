import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";

export type OpsAuctionsVoidAllResponse = {
  /** @default "done" */
  status?: "done";
  /** Hold id to the outcome the payments package recorded. */
  holds: Record<string, string>;
};

export const opsAuctionsVoidAllResponseSchema: Schema<OpsAuctionsVoidAllResponse> =
  s.object<OpsAuctionsVoidAllResponse>({
    status: s.defaulted(s.literal("done"), "done"),
    holds: s.record(s.string(), s.string()),
  });
