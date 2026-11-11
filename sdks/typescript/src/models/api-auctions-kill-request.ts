import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";

export type ApiAuctionsKillRequest = {
  controlId?: string;
  /** @default "STOP" */
  confirm?: "STOP";
};

export const apiAuctionsKillRequestSchema: Schema<ApiAuctionsKillRequest> = s.object<ApiAuctionsKillRequest>({
  controlId: s.optional(s.string()),
  confirm: s.defaulted(s.literal("STOP"), "STOP"),
});
